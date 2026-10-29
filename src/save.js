import { CFG, G, PIECE_ID, setG, setPieceId } from './state.js';

/* =====================================================================
   저장: 중간 저장/이어하기 · 전적 · 증강 수집 (localStorage)
   ===================================================================== */
/* ----- 중간 저장 / 이어하기 -----
   차례가 시작되기 직전(이전 차례가 끝난 시점)의 상태를 저장한다. 차례 도중에 앱이 닫히면
   그 차례의 처음부터 이어진다. Set 은 {__set:[...]} 로 바꿔 저장한다. */
export const SAVE_KEY = 'augyut-save-v1';
export let lastSnap = null;
export function serializeGame() {
  const g = { ...G, T: null, draft: null, alk: null, anim: null, fx: [], mask: null };
  return JSON.stringify({ v: 1, cfg: { ...CFG, slots: CFG.slots.slice() }, pieceId: PIECE_ID, G: g },
    (k, v) => (v instanceof Set ? { __set: [...v] } : v));
}
export function parseSave(str) {
  try {
    const snap = JSON.parse(str, (k, v) => (v && typeof v === 'object' && !Array.isArray(v) && Array.isArray(v.__set) && Object.keys(v).length === 1 ? new Set(v.__set) : v));
    if (!snap || snap.v !== 1 || !snap.G || !Array.isArray(snap.G.players) || snap.G.over) return null;
    return snap;
  } catch (e) { return null; }
}
export function readSave() { try { const s = localStorage.getItem(SAVE_KEY); return s ? parseSave(s) : null; } catch (e) { return null; } }
export function writeSave(str) { if (!str) return; try { localStorage.setItem(SAVE_KEY, str); } catch (e) { /* 저장 공간이 없어도 게임은 계속 */ } }
export function clearSave() { lastSnap = null; try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* 무시 */ } }
export function checkpoint() {
  if (!G || G.over) return;
  try { lastSnap = serializeGame(); } catch (e) { lastSnap = null; return; }
  writeSave(lastSnap);
}
export function flushSave() { if (G && !G.over && lastSnap) writeSave(lastSnap); }
export function restoreSnap(snap) {
  Object.assign(CFG, snap.cfg, { slots: snap.cfg.slots.slice() });
  setPieceId(snap.pieceId);
  setG(snap.G);
  G.T = null; G.draft = null; G.alk = null; G.anim = null; G.fx = []; G.mask = null;
  if (!G.pendingWins) G.pendingWins = [];
  if (!(G.rankTaken instanceof Set)) G.rankTaken = new Set(G.rankTaken || []);
}

/* ----- 전적 · 증강 수집 ----- */
export const REC_KEY = 'augyut-records-v1';
export function loadRecords() {
  let r = null;
  try { r = JSON.parse(localStorage.getItem(REC_KEY) || 'null'); } catch (e) { r = null; }
  return { games: 0, humanGames: 0, humanWins: 0, seen: [], got: [], ...(r || {}) };
}
export function saveRecords(r) { try { localStorage.setItem(REC_KEY, JSON.stringify(r)); } catch (e) { /* 저장 실패 무시 */ } }
export function markSeen(ids) {
  const r = loadRecords(), set = new Set(r.seen);
  let changed = false;
  for (const id of ids) if (!set.has(id)) { set.add(id); changed = true; }
  if (changed) { r.seen = [...set]; saveRecords(r); }
}
export function markGot(id) {
  const r = loadRecords();
  if (!r.got.includes(id)) { r.got.push(id); if (!r.seen.includes(id)) r.seen.push(id); saveRecords(r); }
}
export function recordGameEnd(winners) {
  const r = loadRecords();
  r.games++;
  if (G.players.some(p => !p.ai)) {
    r.humanGames++;
    if (winners.some(p => !p.ai)) r.humanWins++;
  }
  saveRecords(r);
}
