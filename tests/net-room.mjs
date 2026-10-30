// Claude room 전송 시험(모의 room): 방 모으기·시작·입력 복제, 전달이 가끔 빠져도 수렴, presence 4KiB 한도 지키는지.
// 사용: node tests/net-room.mjs
import { RoomCore, makeCode } from '../src/net/room.js';
import { ClaudeRoomTransport, chooseTransport, MqttTransport, LocalTransport } from '../src/net/transports.js';
import { MockRoomHub } from './lib/mockroom.mjs';

const fails = [];
const check = (c, m, x) => { if (!c) fails.push({ m, ...x }); return c; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const until = async (f, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { if (f()) return true; await sleep(30); } return false; };
const randHex = n => Array.from({ length: n }, () => Math.floor(Math.random() * 256).toString(16).padStart(2, '0')).join('');

const hub = new MockRoomHub();
hub.drop = 0.2;                                                            // presence 갱신이 20% 빠지는 환경
function peer(name, sid, code) {
  const client = hub.newClient(); const events = [];
  const tx = new ClaudeRoomTransport({ claude: client, code });
  const core = new RoomCore({ sid, nick: name, randHex, randInt: n => Math.floor(Math.random() * n), publish: st => tx.set(st), onEvent: (type, data) => events.push({ type, data }) });
  const timer = setInterval(() => core.tick(), 200);
  return { name, tx, core, events, timer, open: () => tx.open({ onPeers: l => core.receive(l), onStatus: () => {} }), close() { clearInterval(timer); core.leave(); tx.close(); } };
}
const code = makeCode(n => Math.floor(Math.random() * n));
const ps = [peer('방장', 'HostAAAA', code), peer('손님1', 'GuestBBB', code), peer('손님2', 'GuestCCC', code), peer('손님3', 'GuestDDD', code)];
await Promise.all(ps.map(p => p.open()));
ps[0].core.create(code, { n: 4, hu: 4, ch: 1, df: 'hard', ef: 0 });
ps.slice(1).forEach(p => p.core.join(code));
check(await until(() => ps[0].core.ro.length === 4 && ps.every(p => p.core.phase === 'lobby')), '로비', { ro: ps[0].core.ro.length });
ps[0].core.start();
check(await until(() => ps.every(p => p.events.some(e => e.type === 'start')), 40000), '시드 합의', { ev: ps.map(p => p.events.map(e => e.type).join()) });
check(new Set(ps.map(p => p.events.find(e => e.type === 'start')?.data.sd)).size === 1, '시드 일치', {});
for (let i = 0; i < 120; i++) { ps.forEach((p, j) => { if ((i + j) % 3 === 0) p.core.store.propose(0, i, i % 2 ? 't' : 'm0.' + i); }); await sleep(30); }
const lens = () => ps.map(p => p.core.streams.slice(0, 4).map(s => s.length).join('/'));
const ref = () => JSON.stringify(ps[0].core.streams.slice(0, 4));
check(await until(() => ps.every(p => JSON.stringify(p.core.streams.slice(0, 4)) === ref()) && ps[0].core.streams.slice(0, 4).every(s => s.length > 30), 40000), '입력 복제(전달 20% 유실)', { lens: lens() });
check(hub.violations.length === 0, 'presence 4KiB 한도 위반 없음', { v: hub.violations.slice(0, 3) });
// 첫 번째 사람 새로고침(새 peer 라벨, 같은 sid, 저장된 기록으로 복구)
const snap = ps[1].core.snapshot();
ps[1].close(); await sleep(200);
const back = peer('손님1', 'GuestBBB', code); ps[1] = back;
await back.open(); back.core.restore(snap); back.core.join; 
for (let i = 120; i < 130; i++) { back.core.store.propose(0, i, 't'); await sleep(40); }
check(await until(() => ps.every(p => JSON.stringify(p.core.streams.slice(0, 4)) === JSON.stringify(ps[0].core.streams.slice(0, 4))) && ps[0].core.streams[1].length >= 10, 40000), '새로고침 뒤 복구·이어서 입력', { lens: lens() });
check(await until(() => ps[0].core.isLive('GuestBBB')), '복귀자 접속 상태', {});

// 선택 규칙
check(chooseTransport({ code: 'ABCD', sid: 'x', hash: '#local' }) instanceof LocalTransport, '#local → 탭 전송', {});
check(chooseTransport({ code: 'ABCD', sid: 'x', hash: '', win: { claude: { use() {} } } }) instanceof ClaudeRoomTransport, 'claude 있음 → room', {});
check(chooseTransport({ code: 'ABCD', sid: 'x', hash: '', win: {} }) instanceof MqttTransport, '그 밖 → MQTT', {});
// 로그인 안 한 보기
const t = new ClaudeRoomTransport({ claude: hub.newClient({ signedIn: false }), code });
let err = null; try { await t.open({ onPeers() {}, onStatus() {} }); } catch (e) { err = e; }
check(err && err.code === 'noroom', '로그인 안 하면 room 이 null → noroom 오류', { err: err && err.code });

ps.forEach(p => p.close());
console.log(`Claude room(모의): 4명 로비·시드·입력 복제 · presence 최대 ${hub.maxBytes}바이트`);
if (fails.length) { console.log('실패', JSON.stringify(fails, null, 1)); process.exit(1); }
console.log('Claude room 전송 통과');
process.exit(0);
