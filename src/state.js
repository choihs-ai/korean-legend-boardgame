import { ABORT } from './util.js';
import { AI } from './ai.js';

/* =====================================================================
   공유 상태: 설정, 현재 판(G), 흐름 세대(GEN), 연출 건너뛰기, 화면 어댑터(io)
   다른 모듈은 값을 읽기만 하고, 바꿀 때는 아래 setter 를 쓴다.
   ===================================================================== */
export const CFG = { n: 4, slots: ['human', 'ai', 'ai', 'ai'], chaos: false, endOnFirst: false, fast: false, difficulty: 'normal', gather: true };
export let G = null;
export function setG(v) { G = v; }
export let GEN = 0; // 새 게임을 시작하면 증가 → 이전 게임의 대기 중인 흐름은 중단(ABORT)
export function bumpGen() { return ++GEN; }
export let SKIP = false; // AI 연출 건너뛰기: 사람이 다시 입력해야 할 때까지 대기·애니메이션을 생략
export function setSkip(v) { SKIP = !!v; }
export let INSTANT = false; // Node 테스트: 대기 없이 즉시 진행
export function setInstant(v) { INSTANT = !!v; }
export let PIECE_ID = 1;
export function nextPieceId() { return PIECE_ID++; }
export function setPieceId(v) { PIECE_ID = v; }
// 규칙 코드가 화면·소리를 직접 부르지 않도록 하는 어댑터. 브라우저에서는 main.js 가,
// Node 테스트에서는 tests/lib/headless.mjs 가 채운다.
export const io = { ui: null, r: null, sfx: null, animateMove: () => Promise.resolve() };
