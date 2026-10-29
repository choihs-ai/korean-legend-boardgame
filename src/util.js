import { GEN, INSTANT, SKIP } from './state.js';

/* =====================================================================
   1. 유틸
   ===================================================================== */
export const $ = (s, r = document) => r.querySelector(s);
export const rnd = n => Math.floor(Math.random() * n);
export const pick = a => a[rnd(a.length)];
export const shuffle = a => { const b = a.slice(); for (let i = b.length - 1; i > 0; i--) { const j = rnd(i + 1); [b[i], b[j]] = [b[j], b[i]]; } return b; };
export const ABORT = new Error('게임 중단');
export const defer = typeof setImmediate === 'function' ? f => setImmediate(f) : f => setTimeout(f, 0);
// 기다리기. 새 게임이 시작되면(GEN 변경) 이전 흐름은 ABORT 로 끊는다. Node 테스트(INSTANT)에서는 바로 넘어간다.
export const sleep = ms => {
  const g = GEN;
  return new Promise((res, rej) => {
    const done = () => (g === GEN ? res() : rej(ABORT));
    if (INSTANT) defer(done); else setTimeout(done, SKIP ? 0 : ms);
  });
};
export const noEmoji = s => String(s).replace(/[\p{Extended_Pictographic}\uFE0F\u200D]/gu, '').replace(/\s{2,}/g, ' ').trim();
export const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const HOME = -1, DONE = 99;
export const DRAFT_ROUNDS = [1, 4, 8];      // 증강 선택 라운드 (시작 / 중간 / 마무리)
export const WIN_FROM_ROUND = 3;           // 특수 승리는 이 라운드부터 발동
export const KIM_TURNS = 5;                // 김첨지 완주 제한 차례
export const RES_NAME = { '-1': '빽도', 1: '도', 2: '개', 3: '걸', 4: '윷', 5: '모', 6: '특대모' };
export const resName = v => RES_NAME[v] ?? String(v);
export const PCOL = ['#c4412e', '#2f64a8', '#3d8a5c', '#d6a21f'];
export const PCNAME = ['빨강', '파랑', '초록', '노랑'];
export const TYPE_NAME = { normal: '일반말', dokkaebi: '도깨비', vanguard: '선봉장', cannon: '포', pawn: '폰', kim: '김첨지', queen: '중전마마', cultist: '광신도', marathon: '마라토너' };
export const TYPE_ICON = { normal: '', dokkaebi: '鬼', vanguard: '旗', cannon: '包', pawn: '♟', kim: '첨', queen: '后', cultist: '巫', marathon: '走' };
