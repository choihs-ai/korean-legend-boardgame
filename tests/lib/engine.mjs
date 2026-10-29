// Node 테스트 공용: 규칙 모듈을 DOM 없이 불러와 시드 고정으로 한 판씩 돌린다.
import { installHeadless } from './headless.mjs';
import * as state from '../../src/state.js';
import * as rules from '../../src/rules.js';
import * as save from '../../src/save.js';

export { state, rules, save };

// startGame 은 예외를 console.error 로 보고하므로 그것을 모은다
export const errors = [];
console.error = (...a) => errors.push(a.map(x => (x && x.stack) || String(x)).join(' '));

// localStorage 대역 (Map 을 그대로 저장소로 쓴다)
export function useStorage(map = new Map()) {
  globalThis.localStorage = {
    getItem: k => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: k => { map.delete(k); },
  };
  return map;
}
useStorage();
installHeadless();

export function mulberry32(s) {
  let a = s >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function seed(n) { Math.random = mulberry32(n); }

// 시간 안에 끝나면 'done', 아니면 진행 중인 판을 중단하고 'timeout'
export async function race(promise, ms) {
  let timer;
  const timeout = new Promise(res => { timer = setTimeout(() => res('timeout'), ms); });
  const r = await Promise.race([promise.then(() => 'done'), timeout]);
  clearTimeout(timer);
  if (r === 'timeout') state.bumpGen();
  return r;
}

export async function runOneGame(cfg, { seed: s = 1, timeoutMs = 30000 } = {}) {
  seed(s);
  errors.length = 0;
  Object.assign(state.CFG, { endOnFirst: false, fast: false, difficulty: 'normal', gather: true }, cfg);
  return race(rules.startGame(), timeoutMs);
}

export function summarize(G) {
  const winner = G.planWinner || G.players.find(p => p.rank === 1 && !p.elim) || null;
  return { over: G.over, round: G.round, winner: winner ? winner.name : null, ranks: G.players.map(p => [p.name, p.rank, p.outReason]) };
}
