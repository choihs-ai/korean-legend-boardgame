// 네트워크 통합 시험: 참가자마다 별도 스레드(실제 엔진 + 방 프로토콜 + 세션)로 돌리고, 가짜 중계가 메시지를 늦추거나 빠뜨린다.
//  1) 유실·지연 속에서 한 판 끝까지 → 모두 같은 판   2) 내 입력이 늦게 전해지는 사이 다른 사람이 내 자리를 AI 로 바꿈 → 되감기로 수렴
//  3) 참가자가 갑자기 사라짐 → 남은 사람이 AI 로 대체   4) 참가자가 저장 기록으로 돌아옴
// 사용: node tests/net-play.mjs [판 수=6]
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const WORKER = path.join(here, 'lib', 'peer-worker.mjs');
const SEEDS = Number(process.argv[2] || 6);
const fails = [];
const check = (c, m, x) => { if (!c) fails.push({ m, ...x }); return c; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const rnd = (() => { let a = 12345; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })();

class Net {
  constructor({ loss = 0.1, min = 10, max = 150 } = {}) { Object.assign(this, { loss, min, max }); this.peers = []; this.hold = new Map(); }
  add(name, extra = {}, local = {}) {
    const sid = extra.sid || 'Peer' + 'ABCDEFGH'[this.peers.length] + 'xxx';
    const p = { name, sid, w: null, view: new Map(), events: [], saved: null, dead: false, extra };
    p.w = new Worker(WORKER, { workerData: { nick: name, sid, local, autoTakeoverMs: extra.autoTakeoverMs || 0 } });
    p.w.on('message', m => this.onMsg(p, m));
    p.w.on('error', e => { p.events.push({ t: 'crash', e: String(e && e.stack || e) }); });
    this.peers.push(p);
    return p;
  }
  onMsg(p, m) {
    if (m.t === 'set') this.fanout(p, m.state);
    else if (m.t === 'bye') this.forget(p);
    else if (m.t === 'save') p.saved = m.json;
    else p.events.push(m);
  }
  fanout(from, state) {
    for (const to of this.peers) {
      if (to === from || to.dead || from.dead) continue;
      if (rnd() < this.loss) continue;
      const d = this.min + rnd() * (this.max - this.min) + (this.hold.get(from.name) || 0);
      setTimeout(() => { if (to.dead || from.dead) return; to.view.set(from.sid, state); this.push(to); }, d);
    }
  }
  push(to) { to.w.postMessage({ t: 'peers', list: [...to.view.entries()].map(([id, state]) => ({ id, state })) }); }
  forget(p) { for (const o of this.peers) if (o !== p && !o.dead) { o.view.delete(p.sid); this.push(o); } }
  kill(p) { p.dead = true; p.w.terminate(); this.forget(p); }
  stop() { for (const p of this.peers) { p.dead = true; p.w.terminate(); } }
}
const until = async (f, ms = 60000) => { const t = Date.now(); while (Date.now() - t < ms) { if (f()) return true; await sleep(40); } return false; };
const ev = (p, t) => p.events.filter(e => e.t === t);

async function room(net, humans, { ai = 0, chaos = false, df = 'hard', takeoverMs = 0 } = {}) {
  const ps = [net.add('호스트', { autoTakeoverMs: takeoverMs })];
  ps[0].w.postMessage({ t: 'create', cfg: { n: humans + ai, hu: humans, ch: chaos ? 1 : 0, df, ef: 0 } });
  await until(() => ev(ps[0], 'created').length, 10000);
  const code = ev(ps[0], 'created')[0].code;
  for (let i = 1; i < humans; i++) { const g = net.add('손님' + i, { autoTakeoverMs: takeoverMs }); g.w.postMessage({ t: 'join', code }); ps.push(g); }
  const lobbyOk = await until(() => ps.every(p => ev(p, 'lobby').some(e => e.view.members && e.view.members.length === humans)), 30000);
  return { ps, code, lobbyOk };
}
const allOver = (ps, ms = 90000) => until(() => ps.every(p => ev(p, 'over').length), ms);
const lastOver = p => ev(p, 'over').slice(-1)[0];

// 1) 평소 진행
for (let i = 0; i < SEEDS; i++) {
  const net = new Net({ loss: 0.05 + (i % 3) * 0.1, max: 100 + (i % 3) * 120 });
  const humans = 2 + (i % 3), { ps, lobbyOk } = await room(net, humans, { ai: humans < 4 && i % 2 ? 1 : 0, chaos: i % 2 === 1 });
  check(lobbyOk, `평소 ${i}: 대기실`, {});
  ps[0].w.postMessage({ t: 'start' });
  const done = await allOver(ps);
  check(done, `평소 ${i}: 한 판 끝까지`, { overs: ps.map(p => ev(p, 'over').length), errs: ps.flatMap(p => p.events.filter(e => e.t === 'error' || e.t === 'crash')).slice(0, 2) });
  if (done) { const hs = ps.map(p => lastOver(p).hash); check(new Set(hs).size === 1, `평소 ${i}: 모두 같은 판`, { hs, rounds: ps.map(p => lastOver(p).round) }); }
  console.log(`  평소 ${i}: 사람 ${humans}명, ${done ? lastOver(ps[0]).round + '라운드' : '미완'}, 일치=${done && new Set(ps.map(p => lastOver(p).hash)).size === 1}`);
  net.stop();
}

// 2) 내 입력이 늦게 전해지는 사이 내 자리가 AI 로 바뀜 → 되감기
{
  const net = new Net({ loss: 0.02 });
  const { ps } = await room(net, 3, { ai: 1 });
  net.hold.set(ps[0].name, 6000);                          // 방장의 소식이 6초 늦게 감 (방장은 곧바로 자기 입력을 진행)
  ps[0].w.postMessage({ t: 'start' });
  await until(() => ps.every(p => ev(p, 'start').length), 30000);
  await sleep(1500);                                       // 다른 사람들은 방장의 첫 입력을 기다리며 멈춰 있음
  ps[1].w.postMessage({ t: 'takeover', seat: 0 });         // 손님1 이 방장 자리를 AI 로 바꿈
  const done = await allOver(ps, 120000);
  check(done, '되감기: 끝까지', { overs: ps.map(p => ev(p, 'over').length), errs: ps.flatMap(p => p.events.filter(e => e.t === 'error' || e.t === 'crash')).slice(0, 2) });
  if (done) {
    const hs = ps.map(p => lastOver(p).hash);
    check(new Set(hs).size === 1, '되감기: 모두 같은 판', { hs });
    check(ps[0].events.some(e => e.t === 'rebuild'), '되감기: 방장 기기가 되감기를 했음', { ev: ps[0].events.map(e => e.t).join() });
    console.log(`  되감기: ${lastOver(ps[0]).round}라운드, 방장 기기 되감기 ${ev(ps[0], 'rebuild').length}번, 일치=${new Set(hs).size === 1}`);
  }
  net.stop();
}

// 3) 갑자기 사라짐 → 남은 사람이 AI 로 대체
{
  const net = new Net({ loss: 0.05 });
  const { ps } = await room(net, 3, { takeoverMs: 600 });
  ps.forEach(p => p.w.postMessage({ t: 'gate', k: 30 }));
  ps[0].w.postMessage({ t: 'start' });
  await until(() => ps.every(p => ev(p, 'start').length), 30000);
  await sleep(2500);
  net.kill(ps[2]);
  ps.slice(0, 2).forEach(p => p.w.postMessage({ t: 'release' }));
  const alive = ps.slice(0, 2);
  const done = await allOver(alive, 120000);
  check(done, '사라짐: 남은 사람이 끝까지', { overs: alive.map(p => ev(p, 'over').length) });
  if (done) { const hs = alive.map(p => lastOver(p).hash); check(new Set(hs).size === 1, '사라짐: 같은 판', { hs }); check(/AI가 대신 둡니다/.test(lastOver(alive[0]).log), '사라짐: AI 대체 기록', {}); console.log(`  사라짐: ${lastOver(alive[0]).round}라운드, 일치=${new Set(hs).size === 1}`); }
  net.stop();
}

// 4) 저장 기록으로 돌아옴
{
  const net = new Net({ loss: 0.05 });
  const { ps } = await room(net, 3);
  ps.forEach(p => p.w.postMessage({ t: 'gate', k: 30 }));
  ps[0].w.postMessage({ t: 'start' });
  await until(() => ps.every(p => ev(p, 'start').length), 30000);
  await sleep(2500);
  const victim = ps[1];
  const savedJson = victim.saved;
  check(!!savedJson, '복귀: 저장 기록이 있음', {});
  net.kill(victim);
  await sleep(300);
  const back = net.add(victim.name, { sid: victim.sid }, { 'augyut-online-v1': savedJson });
  back.w.postMessage({ t: 'gate', k: 30 });
  back.w.postMessage({ t: 'resume' });
  await until(() => ev(back, 'resumed').length, 15000);
  check(ev(back, 'resumed').slice(-1)[0]?.ok === true, '복귀: 이어하기 성공', { ev: back.events.map(e => e.t).join() });
  await sleep(2500);
  const group = [ps[0], back, ps[2]];
  group.forEach(p => p.w.postMessage({ t: 'release' }));
  const done = await allOver(group, 120000);
  check(done, '복귀: 끝까지', { overs: group.map(p => ev(p, 'over').length) });
  if (done) { const hs = group.map(p => lastOver(p).hash); check(new Set(hs).size === 1, '복귀: 같은 판', { hs }); console.log(`  복귀: ${lastOver(group[0]).round}라운드, 일치=${new Set(hs).size === 1}`); }
  net.stop();
}

if (fails.length) { console.log('실패', JSON.stringify(fails, null, 1)); process.exit(1); }
console.log('네트워크 통합 시험 통과');
process.exit(0);
