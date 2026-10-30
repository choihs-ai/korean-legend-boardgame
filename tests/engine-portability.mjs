// 엔진 이식성 시험: 온라인 대전은 기기마다 다른 자바스크립트 엔진(iPhone 사파리 = JavaScriptCore, 갤럭시 크롬 = V8)에서
// 같은 판이 나와야 한다. 여기서는 실제 다른 엔진 대신, 엔진마다 달라질 수 있는 두 가지를 일부러 바꿔서 결과가 같은지 본다.
//  1) 정렬 알고리즘: 비교 함수를 부르는 횟수·순서가 달라지는 안정 정렬로 바꿔 끼움 (비교 함수 안에서 난수를 쓰면 여기서 걸린다)
//  2) 삼각함수: sin/cos/atan2 가 마지막 비트만 다르게 나오는 상황
// 사용: node tests/engine-portability.mjs [판 수=60]
import { state, runOneGame, seed } from './lib/engine.mjs';
import { hashState } from '../src/save.js';
import { ALK, quantizeShot } from '../src/alkkagi.js';
import { sha256 } from '../src/net/sha256.js';

const N = Number(process.argv[2] || 60);
const nativeSort = Array.prototype.sort;
const M = { cos: Math.cos, sin: Math.sin, atan2: Math.atan2 };

// 안정 정렬이지만 비교 순서가 V8 의 것과 다른 구현(제자리 삽입 정렬을 뒤에서부터)
function altSort(cmp) {
  const a = this, n = a.length;
  const f = cmp || ((x, y) => (String(x) < String(y) ? -1 : String(x) > String(y) ? 1 : 0));
  for (let i = n - 2; i >= 0; i--) {
    const v = a[i]; let j = i + 1;
    while (j < n && f(v, a[j]) > 0) { a[j - 1] = a[j]; j++; }
    a[j - 1] = v;
  }
  return a;
}
const perturb = () => { Math.cos = x => M.cos(x) * (1 + 3e-16); Math.sin = x => M.sin(x) * (1 - 3e-16); Math.atan2 = (y, x) => M.atan2(y, x) + 2e-16; };
const restore = () => { Object.assign(Math, M); Array.prototype.sort = nativeSort; };

const fails = [];
let ok = 0;
for (let i = 0; i < N; i++) {
  const cfg = { n: 4, slots: ['ai', 'ai', 'ai', 'ai'], chaos: i % 2 === 1, difficulty: ['easy', 'normal', 'hard'][i % 3] };
  restore();
  await runOneGame(cfg, { seed: 7000 + i });
  const a = hashState(), logA = state.G.log.join('\n');
  Array.prototype.sort = altSort; perturb();
  await runOneGame(cfg, { seed: 7000 + i });
  const b = hashState(), logB = state.G.log.join('\n');
  restore();
  if (a === b && logA === logB) ok++; else fails.push({ i, a, b });
}
console.log(`다른 정렬·삼각함수 오차에서도 같은 판: ${ok}/${N}`);

// 알까기 AI 조준: 삼각함수 오차가 있어도 반올림한 입력은 같아야 한다
let aimOk = 0, aimN = 400;
const { G, CFG } = state;
for (let t = 0; t < aimN; t++) {
  // 임의 배치의 알 몇 개
  let s = 91 + t; const r = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  const discs = Array.from({ length: 2 + Math.floor(r() * 6) }, (_, i) => ({ x: r(), y: r(), vx: 0, vy: 0, r: 0.045, m: 1, owner: i % 3, pieces: [{ pos: 5, shield: 0 }], out: false, fall: 0 }));
  state.setG({ players: [0, 1, 2].map(i => ({ id: i, augs: [], ai: true, pieces: [] })), round: 3 });
  const p = state.G.players[0];
  restore(); seed(t); const q1 = quantizeShot(ALK.shotAI(p, discs));
  perturb(); seed(t); const q2 = quantizeShot(ALK.shotAI(p, discs)); restore();
  if (q1.vx === q2.vx && q1.vy === q2.vy && q1.d === q2.d) aimOk++;
}
console.log(`알까기 AI 조준(반올림 후) 일치: ${aimOk}/${aimN}`);
if (ok !== N || aimOk < aimN) { console.log(JSON.stringify(fails.slice(0, 5))); process.exit(1); }
console.log('이식성 시험 통과');
