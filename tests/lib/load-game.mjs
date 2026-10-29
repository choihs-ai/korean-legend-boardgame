// index.html 의 게임 스크립트를 DOM 없이 Node VM 에서 실행한다.
// 화면 관련 객체는 무엇이든 받아 주는 가짜 객체로 대신하고, 연출(애니메이션·대기)은 즉시 끝낸다.
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function makeFake() {
  const target = function () {};
  const proxy = new Proxy(target, {
    get(t, k) {
      if (k === Symbol.iterator) return function* () {};
      if (k === Symbol.toPrimitive) return () => 0;
      if (k === 'then') return undefined;
      if (k === 'length') return 0;
      return proxy;
    },
    set() { return true; },
    apply() { return proxy; },
    construct() { return proxy; },
  });
  return proxy;
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PATCH = `
animateMove = () => Promise.resolve();
R.animRotate = async () => {};
R.animFold = async () => {};
R.wait = async (pred) => {
  for (let i = 0; i < 50000; i++) {
    if (pred(performance.now())) return;
    if (G && G.alk && G.alk.phase === 'sim') {
      ALK.step(0.01);
      const moving = G.alk.discs.some(d => !d.out && Math.hypot(d.vx, d.vy) > 0.01);
      if (!moving) { G.alk.discs.forEach(d => { d.fall = 1; }); G.alk.phase = 'done'; }
    }
  }
};
UI.showThrow = async () => {};
UI.flyStick = async () => {};
globalThis.__api = {
  get G() { return G; },
  get CFG() { return CFG; },
  get lastSnap() { return lastSnap; },
  startGame, resumeGame, serializeGame, parseSave, restoreSnap, gameLoop, checkpoint,
  abort() { GEN++; },
  AUGS, AUG_BY, P, has,
};
`;

export function loadGame({ seed = 1, storage } = {}) {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const m = html.match(/<script>([\s\S]*)<\/script>/);
  if (!m) throw new Error('index.html 에서 게임 스크립트를 찾지 못했습니다');
  const store = storage || new Map();
  const errors = [];
  const fake = makeFake();
  const sandbox = {
    console: { log() {}, info() {}, warn() {}, error: (...a) => errors.push(a.map(x => (x && x.stack) || String(x)).join(' ')) },
    document: fake,
    navigator: {},
    location: { protocol: 'file:', href: 'file:///index.html' },
    localStorage: {
      getItem: k => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => { store.set(k, String(v)); },
      removeItem: k => { store.delete(k); },
    },
    setTimeout: (f, ms, ...a) => setImmediate(f, ...a),
    clearTimeout: () => {},
    requestAnimationFrame: () => 0,
    performance,
    ResizeObserver: class { observe() {} },
    devicePixelRatio: 1,
    addEventListener() {},
    removeEventListener() {},
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  const ctx = vm.createContext(sandbox);
  const rng = mulberry32(seed);
  vm.runInContext(`Math.random = ${'__rng'};`.replace('__rng', '(() => __rngfn())'), Object.assign(ctx, { __rngfn: rng }));
  vm.runInContext(m[1] + '\n' + PATCH, ctx, { filename: 'index.html' });
  return { api: ctx.__api, errors, store, ctx, reseed(s) { const r = mulberry32(s); ctx.__rngfn = r; } };
}

// 한 판을 끝까지 돌린다. 시간 초과면 hang 으로 보고한다.
export async function runOneGame(game, cfg, { timeoutMs = 30000 } = {}) {
  const { api } = game;
  Object.assign(api.CFG, cfg);
  let timer;
  const done = api.startGame().then(() => 'done');
  const timeout = new Promise(res => { timer = setTimeout(() => res('timeout'), timeoutMs); });
  const r = await Promise.race([done, timeout]);
  clearTimeout(timer);
  if (r === 'timeout') api.abort();
  return r;
}

export function summarize(G) {
  const winner = G.planWinner || G.players.find(p => p.rank === 1 && !p.elim) || null;
  return {
    over: G.over,
    round: G.round,
    winner: winner ? winner.name : null,
    ranks: G.players.map(p => [p.name, p.rank, p.outReason]),
  };
}
