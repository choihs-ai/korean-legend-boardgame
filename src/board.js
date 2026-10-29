/* =====================================================================
   3. 29칸 윷판 그래프
   0: 출발·도착(우하단) / 1~4 우변 / 5 우상단 / 6~9 윗변 / 10 좌상단 / 11~14 좌변
   15 좌하단 / 16~19 아랫변 / 20·21: 5→22 / 22 중앙(방) / 23·24: 10→22 / 25·26: 22→15 / 27·28: 22→0
   ===================================================================== */
export const XY = (() => {
  const p = {};
  const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  p[0] = [1, 1];
  for (let k = 1; k <= 4; k++) p[k] = [1, 1 - k / 5];
  p[5] = [1, 0];
  for (let k = 1; k <= 4; k++) p[5 + k] = [1 - k / 5, 0];
  p[10] = [0, 0];
  for (let k = 1; k <= 4; k++) p[10 + k] = [0, k / 5];
  p[15] = [0, 1];
  for (let k = 1; k <= 4; k++) p[15 + k] = [k / 5, 1];
  p[22] = [0.5, 0.5];
  p[20] = lerp(p[5], p[22], 1 / 3); p[21] = lerp(p[5], p[22], 2 / 3);
  p[23] = lerp(p[10], p[22], 1 / 3); p[24] = lerp(p[10], p[22], 2 / 3);
  p[25] = lerp(p[22], p[15], 1 / 3); p[26] = lerp(p[22], p[15], 2 / 3);
  p[27] = lerp(p[22], p[0], 1 / 3); p[28] = lerp(p[22], p[0], 2 / 3);
  return p;
})();
export const NODES = [...Array(29).keys()];
export const CORNERS = [0, 5, 10, 15, 22];
export const LINES = [[0, 1, 2, 3, 4, 5], [5, 6, 7, 8, 9, 10], [10, 11, 12, 13, 14, 15], [15, 16, 17, 18, 19, 0], [5, 20, 21, 22, 25, 26, 15], [10, 23, 24, 22, 27, 28, 0]];
export const DIAG = [20, 21, 22, 23, 24, 25, 26, 27, 28];
export const ADJ = (() => { const a = {}; NODES.forEach(n => a[n] = new Set()); LINES.forEach(L => { for (let i = 0; i + 1 < L.length; i++) { a[L[i]].add(L[i + 1]); a[L[i + 1]].add(L[i]); } }); return a; })();
export const nodeAt = (x, y) => NODES.find(n => Math.abs(XY[n][0] - x) < 1e-6 && Math.abs(XY[n][1] - y) < 1e-6);
// 시계방향 90° 회전: 화면좌표 (x,y) → (1-y, x)
export const ROT = (() => { const r = {}; NODES.forEach(n => { const [x, y] = XY[n]; r[n] = nodeAt(1 - y, x); }); return r; })();

export const FWD_MAP = { 20: 21, 21: 22, 23: 24, 24: 22, 25: 26, 26: 15, 27: 28, 28: 0 };
export const REV_MAP = { 26: 25, 25: 22, 21: 20, 20: 5, 23: 24, 24: 22, 27: 28, 28: 0 };
export const FWD_PREV = { 20: 5, 21: 20, 22: 21, 23: 10, 24: 23, 25: 22, 26: 25, 27: 22, 28: 27 };
export const REV_PREV = { 26: 15, 25: 26, 22: 25, 21: 22, 20: 21, 23: 10, 24: 23, 27: 22, 28: 27 };

// 한 칸 전진. start=이번 이동의 첫 걸음인지(모서리에서 지름길 진입), rev=천마군림보(역방향)
export function nextNode(n, prev, start, rev) {
  if (!rev) {
    if (start && n === 5) return 20;
    if (start && n === 10) return 23;
    if (n === 22) return (!start && prev === 21) ? 25 : 27;
    if (FWD_MAP[n] !== undefined) return FWD_MAP[n];
    return n === 19 ? 0 : n + 1;
  }
  if (start && n === 15) return 26;
  if (start && n === 10) return 23;
  if (n === 22) return (!start && prev === 25) ? 21 : 27;
  if (REV_MAP[n] !== undefined) return REV_MAP[n];
  if (n === 0) return 19;
  return n - 1;
}
export function defaultPrev(n, rev) {
  if (!rev) { if (FWD_PREV[n] !== undefined) return FWD_PREV[n]; return n === 0 ? 19 : n - 1; }
  if (REV_PREV[n] !== undefined) return REV_PREV[n];
  if (n === 19) return 0;
  if (n === 0) return 1;
  return n + 1;
}
