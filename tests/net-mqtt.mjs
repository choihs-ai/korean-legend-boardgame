// MQTT 전송 시험: 실제 MQTT 브로커(aedes, 로컬)를 여러 개 띄우고 우리 클라이언트로 방 만들기·시작·입력 복제·브로커 장애를 확인한다.
// 준비: cd tests/broker && npm install   사용: node tests/net-mqtt.mjs
import http from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const req = createRequire(path.join(here, 'broker', 'package.json'));
let Aedes, WebSocketServer, createWebSocketStream;
try { Aedes = req('aedes'); ({ WebSocketServer, createWebSocketStream } = req('ws')); }
catch (e) { console.log('SKIP: tests/broker 에서 npm install 을 먼저 실행하세요 (aedes, ws 필요)'); process.exit(0); }
import { RoomCore, makeCode } from '../src/net/room.js';
import { MqttTransport } from '../src/net/transports.js';

const fails = [];
const check = (c, m, x) => { if (!c) fails.push({ m, ...x }); return c; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const until = async (f, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { if (f()) return true; await sleep(50); } return false; };

async function startBroker() {
  const aedes = Aedes();
  const server = http.createServer();
  const wss = new WebSocketServer({ server, handleProtocols: () => 'mqtt' });
  wss.on('connection', ws => aedes.handle(createWebSocketStream(ws)));
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const sockets = new Set(); server.on('connection', s => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
  return { port, url: `ws://127.0.0.1:${port}/mqtt`, aedes, async stop() { for (const c of wss.clients) c.terminate(); for (const s of sockets) s.destroy(); wss.close(); server.close(); aedes.close(); } };
}

const brokers = [await startBroker(), await startBroker(), await startBroker()];
const urls = brokers.map(b => b.url);
const randHex = n => Array.from({ length: n }, () => Math.floor(Math.random() * 256).toString(16).padStart(2, '0')).join('');
function makePeer(name, code, sid) {
  const events = [];
  const tx = new MqttTransport({ code, sid, brokers: urls });
  const core = new RoomCore({
    sid, nick: name, randHex, randInt: n => Math.floor(Math.random() * n),
    publish: st => tx.set(st), onEvent: (type, data) => events.push({ type, data }),
  });
  const timer = setInterval(() => core.tick(), 250);
  return { name, tx, core, events, timer, async open() { await tx.open({ onPeers: l => core.receive(l), onStatus: () => {} }); }, close() { clearInterval(timer); core.leave(); tx.close(); } };
}

const code = makeCode(n => Math.floor(Math.random() * n));
const host = makePeer('방장', code, 'HostAAAA'), g1 = makePeer('손님1', code, 'GuestBBB'), g2 = makePeer('손님2', code, 'GuestCCC');
const all = [host, g1, g2];
await Promise.all(all.map(p => p.open()));
host.core.create(code, { n: 4, hu: 3, ch: 0, df: 'normal', ef: 0 });
g1.core.join(code); g2.core.join(code);
check(await until(() => host.core.ro.length === 3 && g1.core.phase === 'lobby' && g2.core.phase === 'lobby'), '로비 모임', { ro: host.core.ro.length });

// 4번째 사람은 정원 초과로 거절
const g3 = makePeer('손님3', code, 'GuestDDD'); await g3.open(); g3.core.join(code);
check(await until(() => g3.events.some(e => e.type === 'error' && e.data.code === 'full')), '정원 초과 거절', { ev: g3.events.map(e => e.type) });
g3.close();

host.core.start();
check(await until(() => all.every(p => p.events.some(e => e.type === 'start')), 30000), '시드 합의', { ev: all.map(p => p.events.map(e => e.type).join()) });
const seeds = new Set(all.map(p => p.events.find(e => e.type === 'start')?.data.sd));
check(seeds.size === 1, '시드 일치', {});

// 입력 복제 (브로커 하나를 중간에 끊어도 계속됨)
const idx = p => p.core.myIdx;
for (let i = 0; i < 15; i++) { all.forEach(p => p.core.store.propose(0, i, 't')); await sleep(60); }
await brokers[0].stop();
for (let i = 15; i < 30; i++) { all.forEach(p => p.core.store.propose(0, i, 'm1.' + i)); await sleep(60); }
await brokers[1].stop();
for (let i = 30; i < 40; i++) { all.forEach(p => p.core.store.propose(0, i, 'a' + i)); await sleep(60); }
const same = () => { const ref = JSON.stringify(host.core.streams.slice(0, 3)); return all.every(p => JSON.stringify(p.core.streams.slice(0, 3)) === ref) && host.core.streams.slice(0, 3).every(s => s.length === 40); };
check(await until(same, 30000), '브로커 2대가 죽어도 입력 복제', { lens: all.map(p => p.core.streams.map(s => s.length).join('/')) });

// 비정상 종료한 참가자는 유언으로 사라짐 → 남은 사람들이 끊김을 알아챔
g2.tx.conns.forEach(c => { try { c.ws.terminate ? c.ws.terminate() : c.ws.close(); } catch (e) { /* 무시 */ } c.closed = true; });
clearInterval(g2.timer);
check(await until(() => !host.core.isLive('GuestCCC') || host.core.peers.get('GuestCCC')?.gone, 20000), '비정상 종료 감지', {});

all.forEach(p => p.close());
await sleep(300);
await brokers[2].stop();
console.log(`MQTT 전송: 브로커 3대 중 2대 종료 후에도 방 모으기·시드 합의·입력 복제 확인`);
if (fails.length) { console.log('실패', JSON.stringify(fails, null, 1)); process.exit(1); }
console.log('MQTT 전송 통과');
process.exit(0);
