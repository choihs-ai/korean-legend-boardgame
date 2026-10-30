// 네트워크 통합 시험용 참가자 한 명: 별도 스레드에서 실제 엔진 + Session + RoomCore 를 돌리고,
// 전송 계층만 부모(가짜 중계)와 메시지로 주고받는다.
import { parentPort, workerData } from 'node:worker_threads';
import './engine.mjs';
import { headlessUI, headlessR } from './headless.mjs';
import { Session, SAVE_KEY } from '../../src/net/session.js';
import { hashState } from '../../src/save.js';
import { G } from '../../src/state.js';

const noop = () => {};
class PortTransport {
  constructor() { this.name = 'port'; }
  async open(h) { parentPort.on('message', m => { if (m.t === 'peers') h.onPeers(m.list); }); h.onStatus({ connected: 1, total: 1 }); }
  set(state) { parentPort.postMessage({ t: 'set', state }); }
  close() { parentPort.postMessage({ t: 'bye' }); }
}
const mem = init => { const m = new Map(Object.entries(init || {})); return { get: k => (m.has(k) ? m.get(k) : null), set: (k, v) => { m.set(k, v); if (k.startsWith(SAVE_KEY)) parentPort.postMessage({ t: 'save', json: v }); }, del: k => { m.delete(k); } }; };
const env = { local: mem(workerData.local), session: mem({}), hash: () => '', win: {} };

let gateAt = Infinity, gateOpen = null, frozen = false;
const sess = new Session({
  ui: headlessUI, r: headlessR, sfx: { play: noop, init: noop }, animateMove: () => Promise.resolve(), env,
  auto: true, alwaysInstant: true, makeTransport: () => new PortTransport(), autoTakeoverMs: workerData.autoTakeoverMs || 0, sidOverride: workerData.sid, peerGraceMs: 1500,
  on: {
    lobby: v => parentPort.postMessage({ t: 'lobby', view: v }),
    error: e => parentPort.postMessage({ t: 'error', code: e.code }),
    start: i => { if (frozen && sess.bridge) sess.bridge.limitFor = () => 0; parentPort.postMessage({ t: 'start', seat: sess.core.myIdx, sd: i.sd }); },
    over: () => parentPort.postMessage({ t: 'over', hash: hashState(), log: G.log.join('\n'), round: G.round, rebuilds: sess.bridge ? sess.bridge.rebuilds : 0, seat: sess.core ? sess.core.myIdx : -1 }),
    rebuild: () => parentPort.postMessage({ t: 'rebuild' }),
  },
});
sess.nick = workerData.nick;
sess.gate = k => (k >= gateAt && !gateOpen ? new Promise(r => { sess.release = () => { gateOpen = true; r(); }; }) : undefined);
// 한 번 멈춘 뒤에는 모두 같은 약속(promise)을 기다리도록
let gp = null;
sess.gate = k => { if (k < gateAt || gateOpen) return undefined; return gp || (gp = new Promise(r => { sess.release = () => { gateOpen = true; r(); }; })); };

parentPort.on('message', async m => {
  if (m.t === 'create') { const code = await sess.create(m.cfg); parentPort.postMessage({ t: 'created', code }); }
  else if (m.t === 'join') await sess.join(m.code);
  else if (m.t === 'resume') { const ok = await sess.resume(); parentPort.postMessage({ t: 'resumed', ok }); }
  else if (m.t === 'start') sess.start();
  else if (m.t === 'gate') gateAt = m.k;
  else if (m.t === 'frozen') { frozen = true; gateAt = 12; }
  else if (m.t === 'release') { gateOpen = true; if (sess.release) sess.release(); }
  else if (m.t === 'takeover') sess.takeover(m.seat);
  else if (m.t === 'leave') { await sess.leave(); parentPort.postMessage({ t: 'left' }); }
  else if (m.t === 'status') parentPort.postMessage({ t: 'status', k: sess.bridge ? sess.bridge.k : -1, pending: sess.bridge && sess.bridge.pending, over: sess.over, running: sess.bridge && sess.bridge.running });
});
