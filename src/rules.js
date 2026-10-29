import { bumpGen, CFG, G, io, nextPieceId, setG, setPieceId, setSkip } from './state.js';
import { ABORT, DONE, DRAFT_ROUNDS, esc, HOME, KIM_TURNS, noEmoji, PCNAME, PCOL, pick, resName, shuffle, sleep, TYPE_NAME, WIN_FROM_ROUND } from './util.js';
import { ADJ, defaultPrev, DIAG, LINES, nextNode, nodeAt, NODES, ROT, XY } from './board.js';
import { AUG_BY, AUGS, CAT_NAME, KIND_NAME } from './augs.js';
import { checkpoint, clearSave, markGot, markSeen, readSave, recordGameEnd, restoreSnap, serializeGame } from './save.js';
import { AI } from './ai.js';
import { ALK } from './alkkagi.js';

/* =====================================================================
   5. 게임 상태
   ===================================================================== */

export function makePiece(owner, type = 'normal') {
  return { id: nextPieceId(), owner, type, pos: HOME, trail: [], shield: 0, boundUntil: 0, lives: 0, domain: false };
}
export function makePlayer(i, ai) {
  return {
    id: i, name: `P${i + 1}`, cname: PCNAME[i], color: PCOL[i], ai,
    pieces: [0, 1, 2, 3].map(() => makePiece(i)), augs: [],
    out: false, elim: false, rank: null, outReason: '', skip: 0, reverse: false,
    st: { seen: {}, dogs: 0, dogCoins: 0, kills: 0, cow: 0, geol: 0, fish: 0, fishPending: 0, ritual: 0, nofriend: {}, hp: 3, queenThrows: 0, kimTurns: 0, domainTurns: 0, turns: 0, throws: 0 },
    host: null, ally: null, delivery: null, plan: null, badge: '', lastDone: null, aloneArmed: false, domainPiece: null
  };
}
export function newGame() {
  setPieceId(1);
  setG({
    players: [], n: CFG.n, chaos: CFG.chaos, endOnFirst: CFG.endOnFirst, round: 1, turnIdx: 0, over: false, needDraft: true,
    alias: {}, folds: [], rotations: 0, poops: [], traps: [], garlics: [], targets: [], fog: null, mask: null,
    chosenRule: false, echo: null, echoSecond: false, murder: false, duel: null, rankTaken: new Set(), pendingWins: [], gather: CFG.gather, moments: [],
    log: [], T: null, draft: null, alk: null, anim: null, fx: [], planWinner: null
  });
  for (let i = 0; i < CFG.n; i++) G.players.push(makePlayer(i, CFG.slots[i] === 'ai'));
}

/* ----- 조회 도우미 ----- */
export const P = i => G.players[i];
export const canon = n => (G.alias[n] ?? n);
export const isExit = n => n !== HOME && n !== DONE && canon(n) === canon(0);
export const onBoard = pc => pc.pos !== HOME && pc.pos !== DONE;
export const canonNodes = () => NODES.filter(n => canon(n) === n);
export function aug(p, id) { return p.augs.find(a => a.id === id && !a.disabled && !(a.catUntil && G.round < a.catUntil)) || null; }
export const has = (p, id) => !!aug(p, id);
export const hasCat = p => p.augs.some(a => !a.disabled && (a.id === 'cat' || (a.catUntil && G.round < a.catUntil)));
export const live = () => G.players.filter(p => !p.out);
export const others = p => live().filter(q => q.id !== p.id);
export const boardPieces = () => G.players.flatMap(p => p.pieces.filter(onBoard));
export const piecesAt = n => boardPieces().filter(pc => canon(pc.pos) === canon(n));
export const isBound = pc => pc.domain || pc.boundUntil > G.round;
export const needPieces = p => p.pieces.filter(pc => pc.type !== 'queen');
export const doneCount = p => p.pieces.filter(pc => pc.pos === DONE).length;
export function stackOf(pc) {
  if (!onBoard(pc) || pc.type === 'pawn') return [pc];
  return P(pc.owner).pieces.filter(x => onBoard(x) && x.type !== 'pawn' && canon(x.pos) === canon(pc.pos));
}
export function myStacks(p) {
  const seen = new Set(), out = [];
  for (const pc of p.pieces) {
    if (!onBoard(pc) || seen.has(pc.id)) continue;
    const s = stackOf(pc); s.forEach(x => seen.add(x.id)); out.push(s);
  }
  return out;
}
export const allGroups = () => G.players.flatMap(p => myStacks(p));
export const stackBound = s => s.some(isBound);
export function stepsToFinish(pos, trail, rev) {
  if (pos === DONE) return 0;
  if (pos !== HOME && isExit(pos)) return 1;
  let cur = pos, prev = trail && trail.length ? trail[trail.length - 1] : null, start = true;
  for (let n = 1; n < 60; n++) {
    const nx = cur === HOME ? (rev ? 19 : 1) : nextNode(cur, prev, start, rev);
    prev = cur; cur = nx; start = false;
    if (isExit(nx)) return n;
  }
  return 60;
}
export function progress(p) {
  let s = doneCount(p) * 100;
  for (const pc of needPieces(p)) if (pc.pos !== DONE) s -= stepsToFinish(pc.pos, pc.trail, p.reverse);
  return s;
}
export function say(msg, toast) {
  if (!G) return;
  msg = noEmoji(msg);
  G.log.push(`[${G.round}R] ${msg}`);
  if (G.log.length > 400) G.log.shift();
  io.ui.ticker(msg);
  if (toast) io.ui.toast(msg, typeof toast === 'string' ? toast : null);
}
export function render() { if (G) { io.ui.refresh(); io.r.dirty = true; } }

/* =====================================================================
   6. 순위 · 탈락 · 승리
   ===================================================================== */
export function freeRanks() { const r = []; for (let i = 1; i <= G.n; i++) if (!G.rankTaken.has(i)) r.push(i); return r; }
export const bestFree = () => freeRanks()[0] ?? G.n;
export const worstFree = () => { const f = freeRanks(); return f.length ? f[f.length - 1] : G.n; };
export function setRank(p, r, reason) {
  p.out = true; p.rank = r; p.outReason = reason; G.rankTaken.add(r);
  for (const pc of p.pieces) if (onBoard(pc)) { pc.pos = HOME; pc.trail = []; pc.domain = false; }
  if (G.T && G.T.pid === p.id) G.T.endNow = true;
}
export function checkContention() {
  const l = live();
  if (l.length <= 1) {
    if (l.length === 1) {
      // 남은 한 명이 꼴찌 자리를 받으면 '최하위', 다른 사람이 모두 탈락해 위 순위를 받으면 '마지막 생존'
      const r = bestFree(), last = G.players.every(q => q === l[0] || (q.rank ?? 0) < r);
      setRank(l[0], r, last ? '최하위' : '마지막 생존');
      say(`${l[0].name} ${l[0].rank}위 확정`);
    }
    G.over = true;
  }
}
export async function award(p, reason) {
  const r = bestFree();
  setRank(p, r, reason);
  say(`🏅 ${p.name} ${r}위! (${reason})`, p.color);
  if (r === 1) {
    for (const q of G.players) {
      if (q.out) continue;
      if (q.host === p.id) { const slot = bestFree(); setRank(q, 1, `거머리: ${p.name}와 함께 승리`); G.rankTaken.add(slot); say(`${q.name}도 거머리로 함께 승리!`, q.color); }
      else if (p.ally === q.id) { const slot = bestFree(); setRank(q, 1, `네크로맨서: ${p.name}와 함께 승리`); G.rankTaken.add(slot); say(`${q.name}도 네크로맨서 동맹으로 함께 승리!`, q.color); }
    }
    if (G.endOnFirst) G.over = true;
  }
  checkContention();
  render();
}
export async function eliminate(p, why) {
  if (!p || p.out) return;
  p.elim = true;
  setRank(p, worstFree(), '탈락: ' + why);
  moment(40, `${G.round}라운드, ${p.name} 탈락 — ${why}`);
  io.sfx.play('bad');
  say(`💀 ${p.name} 탈락 — ${why}`, '#c33');
  io.ui.flash(`${p.name} 탈락`, p.color);
  if (G.duel && (G.duel.caster === p.id || G.duel.target === p.id)) G.duel = null;
  for (const q of G.players) if (!q.out && q.host === p.id) await eliminate(q, `거머리: ${p.name}와 동반 탈락`);
  checkContention();
  render();
}
export async function tryCancel(p, why, augId, isFinish) {
  const q = G.players.find(x => x.id !== p.id && !x.out && has(x, 'cancel') && !aug(x, 'cancel').used);
  if (!q) return false;
  aug(q, 'cancel').used = true;
  io.sfx.play('cancel');
  io.ui.flash('취~소!', q.color);
  say(`✋ ${q.name}: 취~소! ${p.name}의 승리(${why})가 취소되었습니다`, q.color);
  moment(90, `${G.round}라운드, ${q.name}의 취~소! ${p.name}의 승리(${why})가 무효`);
  if (isFinish) {
    const pc = p.pieces.find(x => x.id === p.lastDone && x.pos === DONE) || p.pieces.find(x => x.pos === DONE && x.type !== 'queen');
    if (pc) { pc.pos = HOME; pc.trail = []; }
  }
  if (augId) { const a = p.augs.find(x => x.id === augId && !x.disabled); if (a) a.disabled = true; }
  render();
  await sleep(900);
  return true;
}
export async function specialWin(p, why, augId) {
  if (!G || G.over || p.out) return false;
  if (G.round < WIN_FROM_ROUND) {
    // 조건은 기록해 두고 3라운드가 되면 발동
    if (!G.pendingWins.some(w => w.pid === p.id && w.augId === augId)) {
      G.pendingWins.push({ pid: p.id, why, augId });
      say(`${p.name}: ${why} 달성 — ${WIN_FROM_ROUND}라운드부터 승리가 발동합니다`, p.color);
    }
    return false;
  }
  if (await tryCancel(p, why, augId, false)) return false;
  io.sfx.play('win');
  io.ui.flash(`${p.name} 승리!`, p.color);
  moment(100, `${G.round}라운드, ${p.name}의 특수 승리 — ${why}`);
  await award(p, '특수 승리: ' + why);
  await sleep(700);
  return true;
}
export async function onFinish(p, pcs) {
  // 김첨지는 내 다른 말보다 먼저(또는 함께) 완주해야 한다
  if (!pcs.some(x => x.type === 'kim') && p.pieces.some(x => x.type === 'kim' && x.pos !== DONE)) p.st.kimSpoiled = true;
  for (const pc of pcs) { pc.pos = DONE; pc.trail = []; pc.shield = 0; pc.boundUntil = 0; p.lastDone = pc.id; }
  io.sfx.play('finish');
  say(`${p.name} 말 ${pcs.length}개 완주! (${doneCount(p)}/${needPieces(p).length})`);
  for (const pc of pcs) io.r.fxText(0, '완주!', p.color);
  const queen = p.pieces.find(x => x.type === 'queen' && onBoard(x));
  if (queen) { queen.lives += pcs.length; say(`중전마마 목숨 +${pcs.length} (${queen.lives})`); }
  if (G.duel && G.duel.target === p.id) {
    const c = P(G.duel.caster); G.duel = null;
    say(`승부다!: ${p.name}이(가) 완주에 성공 → 도전자 ${c.name} 탈락`, true);
    await eliminate(c, '승부다! 패배');
    if (G.over || p.out) return;
  }
  if (pcs.some(x => x.type === 'kim') && has(p, 'kim') && p.st.kimTurns <= KIM_TURNS && !p.st.kimSpoiled) { if (await specialWin(p, `김첨지 ${p.st.kimTurns}차례 만에 완주`, 'kim')) return; }
  if (pcs.some(x => x.type === 'marathon') && has(p, 'marathon')) { if (await specialWin(p, '마라토너 완주', 'marathon')) return; }
  if (p.out || G.over) return;
  if (needPieces(p).every(x => x.pos === DONE)) {
    if (bestFree() === 1 && await tryCancel(p, '모든 말 완주', null, true)) return;
    await award(p, '모든 말 완주');
  }
}
export async function revive(t, by) {
  G.rankTaken.delete(t.rank);
  t.rank = null; t.out = false; t.elim = false; t.outReason = ''; t.skip = 0; t.host = null; t.ally = by.id;
  t.pieces = [makePiece(t.id), makePiece(t.id)];
  t.st.hp = 3;
  io.sfx.play('magic');
  io.ui.flash(`${t.name} 부활!`, t.color);
  say(`☠→✨ ${by.name}의 네크로맨서: ${t.name} 말 2개로 부활 (승리 동맹)`, t.color);
  render();
}

/* =====================================================================
   7. 죽음(잡기) 엔진 — 보호막 · 평화 협정 · 프랜드 실드 · 중전마마 목숨
   ===================================================================== */
export function sendHome(pc) { pc.pos = HOME; pc.trail = []; pc.shield = 0; pc.boundUntil = 0; pc.domain = false; }
export async function killPieces(victims, killer, cause) {
  const groups = new Map();
  for (const v of victims) {
    if (!onBoard(v)) continue;
    const k = v.owner + ':' + canon(v.pos) + (v.type === 'pawn' ? ':p' + v.id : '');
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(v);
  }
  const res = { killed: [], shielded: false, immune: false };
  const elim = [];
  for (const grp of groups.values()) {
    const owner = P(grp[0].owner);
    const node = grp[0].pos;
    if (killer && killer.id !== owner.id && (has(owner, 'peace') || has(killer, 'peace'))) {
      res.immune = true; io.r.fxText(node, '평화 협정', '#9fe3d0'); continue;
    }
    if (grp.some(x => x.shield > 0)) {
      grp.forEach(x => { if (x.shield > 0) x.shield--; });
      res.shielded = true; io.sfx.play('shield'); io.r.fxRing(node, '#ffd65a');
      say(`🛡 ${owner.name}의 보호막이 죽음을 막았습니다`);
      continue;
    }
    let dying = grp.slice();
    for (const q of grp) if (q.type === 'queen' && q.lives > 1) { q.lives--; dying = dying.filter(x => x !== q); say(`👑 중전마마 목숨 -1 (남은 목숨 ${q.lives})`); io.r.fxRing(node, '#ffb3d1'); }
    if (dying.length > 1 && has(owner, 'friendshield')) {
      const one = dying.find(x => x.type === 'normal') || dying[0];
      dying = [one]; say(`🤝 ${owner.name}의 프랜드 실드: 1개만 죽습니다`);
    }
    if (!dying.length) continue;
    for (const pc of dying) {
      if (pc.type === 'queen') elim.push([owner, '중전마마 사망']);
      if (pc.domain) elim.push([owner, '영역 전개 실패']);
      sendHome(pc);
      res.killed.push(pc);
    }
    io.r.fxBoom(node, owner.color);
  }
  if (res.killed.length) { io.sfx.play('capture'); await afterKills(res.killed, killer, cause); }
  for (const [o, why] of elim) await eliminate(o, why);
  render();
  return res;
}
export const CAUSE_NAME = { capture: '잡기', triple: '3단 합체 필살기', redbutton: '크고 빨간 버튼', sniper: '명사수', notme: '나만 아니면 돼~', baduk: '바둑', alkkagi: '알까기', trap: '함정', fold: '게임 접어라', place: '배치' };
// 결과 화면의 '결정적 순간' 후보. score 가 큰 것부터 보여 준다.
export function moment(score, text) { if (G.moments) G.moments.push({ score, round: G.round, text }); }
export async function afterKills(killed, killer, cause) {
  const curPid = G.T ? G.T.pid : -1;
  const byOwner = {};
  killed.forEach(pc => byOwner[pc.owner] = (byOwner[pc.owner] || 0) + 1);
  for (const [oid, n] of Object.entries(byOwner)) P(+oid).st.lost = (P(+oid).st.lost || 0) + n;
  if (killer) {
    const enemy = killed.filter(pc => pc.owner !== killer.id);
    killer.st.capt = (killer.st.capt || 0) + enemy.length;
    if (enemy.length >= 2) {
      const vs = [...new Set(enemy.map(pc => P(pc.owner).name))].join('·');
      moment(enemy.length * 10, `${G.round}라운드, ${killer.name}이(가) ${CAUSE_NAME[cause] || cause}로 ${vs}의 말 ${enemy.length}개를 한 번에 잡음`);
    }
  }
  for (const f of G.players) {
    if (f.out || !has(f, 'fisher') || f.id === curPid) continue;
    const n = killed.filter(pc => pc.owner !== f.id).length;
    if (!n) continue;
    f.st.fish += n;
    while (f.st.fish >= 2) { f.st.fish -= 2; f.st.fishPending++; say(`🎣 ${f.name} 어부지리: 다음 차례에 개 획득`); }
  }
  if (!killer) return;
  const enemyKills = killed.filter(pc => pc.owner !== killer.id).length;
  if (enemyKills && has(killer, 'coup') && !killer.out) {
    killer.st.kills += enemyKills;
    say(`⚔ 무신정변 ${killer.st.kills}/4`);
    if (killer.st.kills >= 4) await specialWin(killer, '무신정변: 적 말 4개 처치', 'coup');
  }
  if (G.murder && has(killer, 'murder')) {
    for (const [oid, n] of Object.entries(byOwner)) {
      const v = P(+oid);
      if (v.id === killer.id || v.out) continue;
      v.st.hp -= n;
      say(`🩸 ${v.name} 체력 -${n} (남은 체력 ${Math.max(0, v.st.hp)})`);
      if (v.st.hp <= 0) await eliminate(v, '체력 0 ("살인")');
    }
  }
  for (const oid of Object.keys(byOwner)) {
    const v = P(+oid);
    if (v.id === killer.id || v.out || !has(v, 'nofriend')) continue;
    v.st.nofriend[killer.id] = true;
    const need = G.players.filter(q => q.id !== v.id && !q.out);
    say(`🥲 나만 친구 없어: ${need.filter(q => v.st.nofriend[q.id]).length}/${need.length}`);
    if (need.length && need.every(q => v.st.nofriend[q.id])) await specialWin(v, '나만 친구 없어: 모두에게 잡힘', 'nofriend');
  }
}

/* =====================================================================
   8. 이동 엔진
   ===================================================================== */
export const poopBlocks = (n, owner) => G.poops.some(pp => canon(pp.node) === canon(n) && pp.owner !== owner.id);
// 경로 계산. steps<0 이면 빽도(지나온 길 역행)
export function computePath(pc, steps, owner, stack) {
  stack = stack || [pc];
  const rev = !!owner.reverse;
  const queenOnly = stack.every(x => x.type === 'queen');
  let cur = pc.pos;
  const trail = pc.trail.slice();
  const path = [];
  let finished = false, poop = null;
  if (steps > 0) {
    let prev = trail.length ? trail[trail.length - 1] : null, start = true;
    for (let i = 0; i < steps; i++) {
      if (cur !== HOME && isExit(cur) && !queenOnly) { finished = true; break; }
      const nx = cur === HOME ? (rev ? 19 : 1) : nextNode(cur, prev, start, rev);
      if (cur !== HOME) trail.push(cur);
      path.push(nx); prev = cur; cur = nx; start = false;
      if (isExit(nx) && !queenOnly) { finished = true; break; }
      if (i < steps - 1 && poopBlocks(nx, owner)) { poop = nx; break; }
    }
  } else if (steps < 0) {
    if (cur === HOME) return { path, finished, trail, poop, invalid: true };
    for (let i = 0; i < -steps; i++) {
      const nx = trail.length ? trail.pop() : defaultPrev(cur, rev);
      path.push(nx); cur = nx;
      if (i < -steps - 1 && poopBlocks(nx, owner)) { poop = nx; break; }
    }
  }
  return { path, finished, trail, poop };
}
export function vanguardOn(p) { return p.pieces.some(pc => pc.type === 'vanguard' && onBoard(pc)); }
export function modValue(p, v) {
  let a = v;
  if (a > 0 && vanguardOn(p)) a += 1;
  if (G.T && G.T.pid === p.id && G.T.lastDance) a *= 2;
  return a;
}
export function movableLeads(p, v) {
  const out = [], seen = new Set();
  for (const pc of p.pieces) {
    if (pc.pos === DONE || pc.type === 'pawn' || seen.has(pc.id)) continue;
    if (pc.pos === HOME) { if (v > 0) out.push(pc); continue; }
    const s = stackOf(pc); s.forEach(x => seen.add(x.id));
    if (stackBound(s)) continue;
    const r = computePath(pc, modValue(p, v), p, s);
    if (r.path.length || r.finished) out.push(pc);
  }
  return out;
}
export async function moveStack(p, lead, amount, opt = {}) {
  const stack = lead.pos === HOME ? [lead] : stackOf(lead);
  const r = computePath(lead, amount, p, stack);
  if (!r.path.length && !r.finished) return { moved: false };
  return executeMove(p, stack, lead.pos, r, { backdo: amount < 0, ...opt });
}
// 경로 r={path, trail, finished, poop}를 실제로 적용
export async function executeMove(p, stack, from, r, opt = {}) {
  await io.animateMove(stack, from, r.path, p);
  if (G.over) return { moved: true };
  await collectGarlic(p, r.path);
  if (G.over || p.out) return { moved: true };
  if (r.finished) {
    const fin = stack.filter(x => x.type !== 'queen');
    const end = r.path.length ? r.path[r.path.length - 1] : from;
    stack.filter(x => x.type === 'queen').forEach(q => { q.pos = end; q.trail = r.trail.slice(); });
    if (fin.length) await onFinish(p, fin);
    render();
    return { moved: true, finished: true };
  }
  const dest = r.path[r.path.length - 1];
  stack.forEach(x => { x.pos = dest; x.trail = r.trail.slice(); });
  io.sfx.play('land');
  if (r.poop) {
    G.poops = G.poops.filter(pp => canon(pp.node) !== canon(dest));
    say(`💩 ${p.name}의 말이 똥을 밟고 멈췄습니다!`);
    io.r.fxText(dest, '똥!', '#b07a3a'); io.sfx.play('bad');
  }
  const prevNode = r.path.length >= 2 ? r.path[r.path.length - 2] : from;
  const res = await resolveLanding(p, stack, dest, { backdo: !!opt.backdo, prevNode, r });
  if (G.over || p.out) return { moved: true, ...res };
  if (!r.poop && !opt.noTrap && stack.some(onBoard)) await triggerTrap(p, stack, opt.depth || 0);
  render();
  return { moved: true, ...res };
}
export async function resolveLanding(p, stack, dest, ctx) {
  const out = { captured: 0 };
  const here = piecesAt(dest).filter(x => !stack.includes(x));
  const enemies = here.filter(x => x.owner !== p.id);
  if (enemies.length) {
    const kr = await killPieces(enemies, p, 'capture');
    if (kr.killed.length) {
      out.captured = kr.killed.length;
      const vs = [...new Set(kr.killed.map(x => P(x.owner).name))].join(', ');
      say(`💥 ${p.name}이(가) ${vs}의 말 ${kr.killed.length}개를 잡았습니다!`, p.color);
      if (G.T && G.T.pid === p.id && !p.out) {
        let bonus = 1;
        if (has(p, 'treason') && kr.killed.some(x => doneCount(P(x.owner)) > doneCount(p))) { bonus++; say('🗡 역모: 투척 기회 +1 추가'); }
        G.T.throwsLeft += bonus;
      }
      if (ctx.backdo && has(p, 'cowback') && !p.out) {
        p.st.cow++; say(`🐄 소 뒷걸음질 ${p.st.cow}/2`);
        if (p.st.cow >= 2) await specialWin(p, '소 뒷걸음질: 빽도로 2번 잡기', 'cowback');
      }
    } else if (kr.shielded && stack.some(onBoard)) {
      const pn = ctx.prevNode;
      const r = ctx.r;
      if (pn === HOME) stack.forEach(x => { x.pos = HOME; x.trail = []; });
      else {
        const tr = ctx.backdo ? r.trail.concat([dest]) : r.trail.slice(0, -1);
        stack.forEach(x => { x.pos = pn; x.trail = tr.slice(); });
      }
      say('보호막에 막혀 공격한 말이 직전 칸에 멈췄습니다');
    }
  }
  if (G.over || p.out) return out;
  const mine = piecesAt(dest).filter(x => x.owner === p.id && !stack.includes(x));
  const lead = stack.find(onBoard);
  if (mine.length && lead && lead.type !== 'pawn' && canon(lead.pos) === canon(dest)) {
    if (has(p, 'cannibal')) {
      const kr = await killPieces(mine, p, 'cannibal');
      if (kr.killed.length) {
        say(`🍖 카니발리즘: ${p.name}이(가) 자기 말 ${kr.killed.length}개를 먹었습니다 (추가 투척)`);
        if (G.T && G.T.pid === p.id) G.T.throwsLeft += 1;
      }
    } else {
      const joiners = mine.filter(x => x.type !== 'pawn');
      joiners.forEach(x => { x.pos = lead.pos; x.trail = lead.trail.slice(); });
      if (joiners.length) { say(`${p.name} 업기! (${stackOf(lead).length}개)`); io.r.fxText(dest, '업기', p.color); }
    }
  }
  return out;
}
export async function triggerTrap(p, stack, depth) {
  if (depth > 2) return;
  const lead = stack.find(onBoard);
  if (!lead) return;
  const t = G.traps.find(x => canon(x.node) === canon(lead.pos));
  if (!t) return;
  if (t.kind === 'trap') {
    if (t.owner === p.id) return;
    if (Math.random() < 0.5) {
      say(`💣 함정! ${p.name}의 말이 터졌습니다`, '#e66');
      io.sfx.play('boom');
      await killPieces(stackOf(lead), P(t.owner), 'trap');
    } else {
      say(`💣 함정! ${p.name}의 말이 뒤로 3칸`);
      await moveStack(p, lead, -3, { noTrap: true });
    }
  } else {
    if (Math.random() < 0.5) {
      say(`🎁 보상! ${p.name}의 말이 앞으로 2칸`);
      await moveStack(p, lead, 2, { depth: depth + 1 });
    } else {
      say(`🎁 보상! ${p.name} 추가 투척`);
      if (G.T && G.T.pid === p.id) G.T.throwsLeft++;
    }
  }
}
export async function collectGarlic(p, path) {
  const g = G.garlics.find(x => x.owner === p.id);
  if (!g || !has(p, 'bear')) return;
  for (const n of path) {
    const i = g.nodes.findIndex(x => canon(x) === canon(n));
    if (i >= 0) { g.nodes.splice(i, 1); g.got++; say(`🧄 웅녀: 마늘 ${g.got}/3`); io.r.fxText(n, '마늘!', '#fff'); io.sfx.play('magic'); }
  }
  if (g.got >= 3) await specialWin(p, '웅녀: 마늘 3개를 모두 모음', 'bear');
}
export async function advancePawns(p) {
  for (const pc of p.pieces) {
    if (pc.type !== 'pawn' || pc.pos === DONE || isBound(pc) || p.out || G.over) continue;
    await moveStack(p, pc, 1, { pawn: true });
  }
}

/* =====================================================================
   9. 윷 던지기
   ===================================================================== */
export function stickCount(p) { return (has(p, 'excess') ? 6 : 4) + (has(p, 'burden') ? 1 : 0) - (has(p, 'equiv') ? 1 : 0); }
export function throwSticks(p) {
  if (has(p, 'moordo')) {
    const mo = Math.random() < 0.5;
    return { v: mo ? 5 : 1, flats: mo ? [false, false, false, false] : [false, true, false, false] };
  }
  const n = stickCount(p), ex = has(p, 'excess');
  const flats = Array.from({ length: n }, () => Math.random() < 0.55);
  const k = flats.filter(Boolean).length;
  let v;
  if (ex) v = k === n ? 'OUT' : k === 0 ? 5 : k >= 4 ? 4 : k;
  else if (n <= 3) v = k === 0 ? 4 : k;
  else if (n === 4) v = k === 0 ? 5 : k;
  else v = k === 0 ? 6 : Math.min(k, 5);
  if (v === 1 && flats[0]) v = -1;
  return { v, flats };
}
export async function doThrow(p, forced) {
  const T = G.T;
  if (forced === undefined && T.throwsLeft <= 0) return;
  T.throwsLeft--; T.fresh = false;
  const sets = [];
  if (forced !== undefined) sets.push({ v: forced, flats: null });
  else if (has(p, 'dogpig')) {
    const v = await io.ui.choose(p, '개돼지: 이번 결과를 고르세요', [{ label: '도 (1칸)', value: 1 }, { label: '개 (2칸)', value: 2 }], { ai: () => AI.dogpig(p) });
    sets.push({ v: v ?? 2, flats: null });
  } else sets.push(throwSticks(p));
  if (has(p, 'dual')) {
    sets.push(throwSticks(p));
    sets.forEach(s => { if (s.v === 5) { s.v = 1; s.dualFix = true; } });
  }
  p.st.throws++;
  io.sfx.play('throw');
  await io.ui.showThrow(p, sets);
  for (const s of sets) {
    if (s.v === 'OUT') { say(`🎋 ${p.name} 과유불급: 앞면 ${stickCount(p)}개!`, '#e66'); await eliminate(p, '과유불급 (앞면 전부)'); return; }
    T.chips.push(s.v);
    if (s.v >= 4) T.throwsLeft++;
    say(`${p.name}: ${resName(s.v)}${s.dualFix ? ' (이도류: 모→도)' : ''}${s.v >= 4 ? ' — 한 번 더!' : ''}`);
    await recordResult(p, s.v);
    if (p.out || G.over) return;
  }
  if (has(p, 'queen')) {
    p.st.queenThrows++;
    const q = p.pieces.find(x => x.type === 'queen');
    if (q && onBoard(q) && p.st.queenThrows >= 12) { if (await specialWin(p, '중전마마를 12번 던질 때까지 지킴', 'queen')) return; }
  }
  await advancePawns(p);
  render();
}
export async function recordResult(p, v) {
  const T = G.T;
  p.st.seen[v === 6 ? 5 : v] = true;
  T.counts[v] = (T.counts[v] || 0) + 1;
  if (v === 2) { p.st.dogs++; if (has(p, 'doberman')) p.st.dogCoins++; }
  if (v === 4) p.st.yuts = (p.st.yuts || 0) + 1;
  if (v === 5 || v === 6) p.st.mos = (p.st.mos || 0) + 1;
  if (v === 3 && has(p, 'jajin')) {
    p.st.geol++;
    if (p.st.geol % 2 === 0) { T.chips.push(2); say('🥁 자진모리 장단: 걸 2번 → 개 추가!'); }
  }
  if (v === 5 && T.poisoned) { say('☠ 독이 든 성배: 모가 나왔습니다!', '#e66'); await eliminate(p, '독이 든 성배'); return; }
  if (has(p, 'score') && [-1, 1, 2, 3, 4, 5].every(k => p.st.seen[k])) { if (await specialWin(p, '악보 완성 (빽도·도·개·걸·윷·모)', 'score')) return; }
  if (has(p, 'seven') && T.counts[v] >= 3) { if (await specialWin(p, `777: 한 차례에 ${resName(v)} 3번`, 'seven')) return; }
}

/* =====================================================================
   10. 판 변형: 접기 · 회전 · 설치물
   ===================================================================== */
// 접은 뒤의 칸 별칭표: 출구(0)가 있는 쪽 절반이 남고, 반대쪽 절반은 거울 대칭 칸으로 합쳐진다
export function foldAlias(dir) {
  const ex = XY[canon(0)];
  const keepHigh = dir === 'h' ? ex[1] > 0.5 : ex[0] > 0.5;
  const mirror = c => {
    const [x, y] = XY[c];
    if (dir === 'h') { if ((keepHigh && y < 0.5 - 1e-6) || (!keepHigh && y > 0.5 + 1e-6)) return nodeAt(x, 1 - y); }
    else if ((keepHigh && x < 0.5 - 1e-6) || (!keepHigh && x > 0.5 + 1e-6)) return nodeAt(1 - x, y);
    return c;
  };
  const na = {};
  for (const n of NODES) { const c2 = mirror(canon(n)); if (c2 !== n) na[n] = c2; }
  return na;
}
export async function applyFold(dir, actor) {
  io.sfx.play('fold');
  io.ui.flash('게임 접어라!', actor.color);
  await io.r.animFold(dir);
  G.alias = foldAlias(dir);
  G.folds.push(dir);
  say(`📄 ${actor.name}: 윷판을 ${dir === 'h' ? '가로로' : '세로로'} 접었습니다! 대칭 칸이 하나로 합쳐졌습니다`, actor.color);
  await resolveMerges(actor);
  await checkBoardWins();
  render();
}
// 접기로 같은 칸에 겹친 서로 다른 플레이어의 말 → 잡기 판정
export async function resolveMerges(actor) {
  const byNode = new Map();
  for (const pc of boardPieces()) { const c = canon(pc.pos); if (!byNode.has(c)) byNode.set(c, []); byNode.get(c).push(pc); }
  for (const [node, pcs] of byNode) {
    const owners = [...new Set(pcs.map(x => x.owner))];
    if (owners.length < 2) continue;
    let winner = owners.includes(actor.id) ? actor.id : null;
    if (winner === null) { const flap = pcs.filter(x => x.pos !== canon(x.pos)).map(x => x.owner); winner = flap.length ? flap[0] : pick(owners); }
    const victims = pcs.filter(x => x.owner !== winner && onBoard(x));
    if (!victims.length) continue;
    say(`접힌 ${node}번 칸: ${P(winner).name}의 말이 위에 포개졌습니다`);
    await killPieces(victims, P(winner), 'fold');
  }
}
export async function doRotate(actor) {
  io.sfx.play('magic');
  io.ui.flash('돌려돌려 돌림판!', actor.color);
  await io.r.animRotate();
  const m = ROT;
  for (const pc of G.players.flatMap(q => q.pieces)) if (onBoard(pc)) { pc.pos = m[pc.pos]; pc.trail = pc.trail.map(n => m[n]); }
  const na = {};
  for (const n of NODES) { const a = G.alias[n]; if (a !== undefined) na[m[n]] = m[a]; }
  G.alias = na;
  G.poops.forEach(x => x.node = m[x.node]);
  G.traps.forEach(x => x.node = m[x.node]);
  G.garlics.forEach(g => g.nodes = g.nodes.map(n => m[n]));
  G.targets.forEach(t => t.node = m[t.node]);
  G.rotations++;
  say(`🌀 ${actor.name}: 판이 시계방향으로 90° 돌았습니다 (출구는 그대로)`, actor.color);
  await checkBoardWins();
  render();
}
export function placePoop(p) {
  const occupied = new Set(boardPieces().map(pc => canon(pc.pos)));
  const cands = canonNodes().filter(n => !isExit(n) && !occupied.has(n) && !G.poops.some(x => canon(x.node) === n));
  if (!cands.length) return;
  const mine = G.poops.filter(x => x.owner === p.id);
  if (mine.length >= 3) G.poops.splice(G.poops.indexOf(mine[0]), 1);
  const n = pick(cands);
  G.poops.push({ node: n, owner: p.id });
  say(`💩 ${p.name}: 히히 똥! (${n}번 칸)`);
  io.r.fxText(n, '뿌직', '#b07a3a');
}
export async function resolveEnemiesAt(node, actor) {
  const vs = piecesAt(node).filter(x => x.owner !== actor.id);
  if (vs.length) await killPieces(vs, actor, 'place');
}

/* =====================================================================
   11. 승리 판정 (판 상태형)
   ===================================================================== */
export function fourCheck(p) {
  const cnt = {};
  p.pieces.filter(onBoard).forEach(x => { const c = canon(x.pos); cnt[c] = (cnt[c] || 0) + 1; });
  if (Object.values(cnt).some(c => c >= 4)) return true;
  const occ = new Set(Object.keys(cnt).map(Number));
  for (const L of LINES) {
    const cl = L.map(canon);
    for (let i = 0; i + 3 < cl.length; i++) { const w = cl.slice(i, i + 4); if (new Set(w).size === 4 && w.every(n => occ.has(n))) return true; }
  }
  return false;
}
export async function checkBoardWins() {
  if (!G || G.over) return;
  const groupCount = allGroups().length;
  for (const p of G.players) {
    if (p.out || G.over) continue;
    if (has(p, 'four') && fourCheck(p)) { if (await specialWin(p, '사목: 일직선 4칸 / 4개 한 뭉치', 'four')) continue; }
    if (has(p, 'alone')) {
      if (groupCount >= 2) p.aloneArmed = true;
      else if (groupCount === 1 && p.aloneArmed) await specialWin(p, '천상천하 유아독존: 판에 말뭉치 1개', 'alone');
    }
  }
}
export async function checkCatLove() {
  if (!G.players.some(q => hasCat(q))) return;
  for (const L of G.players) {
    if (L.out || G.over || !has(L, 'catlove')) continue;
    say('🐱 고양이 좋아: 고양이를 고른 플레이어가 있습니다!');
    await specialWin(L, '고양이 좋아', 'catlove');
  }
}

/* =====================================================================
   12. 증강 획득(즉발 효과)
   ===================================================================== */
export async function acquire(p, id, opts = {}) {
  const A = AUG_BY[id];
  const inst = { id, used: false, disabled: false, catUntil: 0 };
  p.augs.push(inst);
  if (G.draft) G.draft.picks.push({ pid: p.id, id, inst });
  if (p.ai) markSeen([id]); else markGot(id);
  io.sfx.play('aug');
  say(`✨ ${p.name} 증강 획득: ${A.name}`, p.color);
  render();
  const h = ON_ACQ[id];
  if (h) await h(p, inst, opts);
  if (A.kind === 'instant') inst.used = true;
  if (!G.over) await checkCatLove();
  if (!G.over) await checkBoardWins();
  render();
}
export function revertGlobal(id, owner) {
  if (id === 'chosen') G.chosenRule = G.players.some(q => has(q, 'chosen'));
  if (id === 'echo' && G.echo && G.echo.owner === owner.id) G.echo = null;
  if (id === 'murder') G.murder = G.players.some(q => has(q, 'murder'));
}
export function pieceLabel(pc) {
  const t = TYPE_NAME[pc.type];
  if (pc.pos === HOME) return `대기 중인 ${t}`;
  const s = stackOf(pc).length;
  return `${canon(pc.pos)}번 칸 ${t}${s > 1 ? ` (${s}개 업힘)` : ''}`;
}
export async function pickOwnPiece(p, filter, msg, aiFn) {
  const cands = p.pieces.filter(filter);
  if (!cands.length) { say(`${msg}: 고를 수 있는 말이 없습니다`); return null; }
  return io.ui.pickPiece(p, cands, msg, { ai: aiFn || (() => AI.bestPieceFor(p, cands)) });
}
export const ON_ACQ = {
  truck: async p => { say(`🚚 ${p.name}: 2개 이상 업힌 말뭉치가 생기면 차례 시작에 8톤 트럭을 부를 수 있습니다`); },
  triple: async p => { say(`🔥 ${p.name}: 3개 이상 업힌 말뭉치가 생기면 차례 시작에 필살기를 쓸 수 있습니다`); },
  fold: async p => {
    const dir = await io.ui.choose(p, '게임 접어라: 접는 방향을 고르세요', [
      { label: '가로로 접기', sub: '위아래가 포개집니다', value: 'h' },
      { label: '세로로 접기', sub: '좌우가 포개집니다', value: 'v' }], { ai: () => AI.foldDir(p) });
    await applyFold(dir || 'v', p);
  },
  cat: async p => { say(`🐱 ${p.name}: 냐옹.`); },
  chosen: async p => { G.chosenRule = true; say('👑🐱 간택: 이제 선택창에 고양이가 나오면 무조건 골라야 합니다', true); },
  catpick: async () => {},
  catlove: async () => {},
  excess: async p => { say(`${p.name}: 이제 윷 6개를 던집니다`); },
  dogpig: async () => {},
  leech: async p => {
    const cands = others(p);
    if (!cands.length) return;
    const t = await io.ui.choosePlayer(p, '거머리: 말을 줄 플레이어를 고르세요', cands, { ai: () => AI.leader(p, cands) });
    if (!t) return;
    const left = needPieces(p).filter(x => x.pos !== DONE);
    if (left.length > 1) {
      const pc = p.pieces.find(x => x.pos === HOME && x.type === 'normal') || p.pieces.find(x => x.pos === HOME && x.type !== 'queen') || p.pieces.find(x => onBoard(x) && x.type !== 'queen');
      if (pc) { p.pieces.splice(p.pieces.indexOf(pc), 1); pc.owner = t.id; pc.type = 'normal'; t.pieces.push(pc); }
    }
    p.host = t.id;
    say(`🩸 ${p.name}이(가) ${t.name}에게 말을 주고 거머리처럼 붙었습니다 (승패 공유)`, p.color);
  },
  whoami: async p => {
    const syms = shuffle(['갑', '을', '병', '정'].slice(0, G.n));
    G.mask = {};
    G.players.forEach((q, i) => G.mask[q.id] = syms[i]);
    render();
    io.ui.flash('나 누구게?', '#bbb');
    await sleep(900);
    const symList = syms.slice().sort();
    const summary = s => { const q = G.players.find(x => G.mask[x.id] === s); return `판 위 ${q.pieces.filter(onBoard).length} · 대기 ${q.pieces.filter(x => x.pos === HOME).length} · 완주 ${doneCount(q)}`; };
    for (const q of others(p)) {
      const opts = symList.map(s => ({ label: `「${s}」`, sub: summary(s), value: s }));
      const g = await io.ui.choose(q, `${q.name}님, 당신의 말은 어느 기호일까요?`, opts, { blind: true, peek: true, ai: () => (Math.random() < 0.7 ? G.mask[q.id] : pick(symList)) });
      if (g === G.mask[q.id]) say(`${q.name} 정답!`);
      else { q.skip++; say(`${q.name} 오답 → 차례 1번 건너뜀`, q.color); }
    }
    G.mask = null;
    render();
  },
  notme: async p => {
    const cands = live();
    const t = pick(cands);
    io.ui.flash(`${t.name} 당첨!`, t.color);
    await sleep(700);
    say(`🎯 나만 아니면 돼~: ${t.name}의 판 위 말이 모두 죽습니다`, t.color);
    await killPieces(t.pieces.filter(onBoard), p, 'notme');
  },
  getdown: async p => {
    const voters = live(), votes = {};
    for (const v of voters) {
      const cands = voters.filter(x => x.id !== v.id);
      if (!cands.length) continue;
      const t = await io.ui.choosePlayer(v, `내려 투표: ${v.name}님, 차례를 건너뛸 사람은?${v.id === p.id ? ' (당신은 2표)' : ''}`, cands, { blind: true, ai: () => AI.leader(v, cands) });
      if (!t) continue;
      votes[t.id] = (votes[t.id] || 0) + (v.id === p.id ? 2 : 1);
    }
    const ids = Object.keys(votes);
    if (!ids.length) return;
    const max = Math.max(...Object.values(votes));
    const tops = ids.filter(k => votes[k] === max).map(Number);
    const loser = P(pick(tops));
    loser.skip++;
    const tally = G.players.filter(q => votes[q.id]).map(q => `${q.name} ${votes[q.id]}표`).join(' · ');
    say(`🗳 내려 결과: ${tally} → ${loser.name} 차례 1번 건너뜀`, loser.color);
    await io.ui.alert('내려! 투표 결과', `<p class="mdesc">${esc(tally)}</p><p class="mdesc"><b style="color:${loser.color}">${loser.name}</b>님은 차례를 한 번 건너뜁니다.</p>`, G.players.some(q => !q.ai) ? null : p);
  },
  doberman: async p => { p.st.dogCoins += p.st.dogs; say(`🐕 도베르만: 지금까지 낸 개 ${p.st.dogs}번 → 개 코인 ${p.st.dogCoins}개`); },
  spin: async p => { await doRotate(p); },
  sniper: async () => {},
  detective: async p => {
    if (!G.draft) return;
    const cat = G.draft.cat;
    const pool = AUGS.filter(a => (a.cat === 'general' || a.cat === cat) && a.id !== 'detective').map(a => ({ label: a.name, value: a.id }));
    const id = await io.ui.choose(p, '명탐정: 이번 증강 선택에서 무효화할 증강', pool, { blind: true, grid: true, ai: () => AI.detective(p, pool) });
    if (!id) return;
    G.draft.banned.add(id);
    for (const pk of G.draft.picks) {
      if (pk.id === id && pk.pid !== p.id && !pk.inst.disabled) {
        pk.inst.disabled = true; revertGlobal(id, P(pk.pid));
        say(`🔍 명탐정: ${P(pk.pid).name}의 「${AUG_BY[id].name}」 무효화!`, true);
      }
    }
    say(`🔍 ${p.name}이(가) 비밀리에 증강 하나를 지목했습니다`);
  },
  moordo: async () => {},
  baduk: async () => {},
  delivery: async p => {
    const pool = AUGS.filter(a => a.id !== 'delivery' && augAllowed(a.id)).map(a => ({ label: a.name, value: a.id }));
    const id = await io.ui.choose(p, '배달: 다음 증강 선택 때 받을 증강', pool, { blind: true, grid: true, ai: () => AI.delivery(p) });
    if (id) { p.delivery = id; say(`📦 ${p.name}이(가) 비밀 배달을 예약했습니다`); }
  },
  dokkaebi: async () => {},
  vanguard: async p => {
    const pc = await pickOwnPiece(p, x => x.type === 'normal' && x.pos !== DONE, '선봉장으로 바꿀 일반말');
    if (pc) { pc.type = 'vanguard'; say(`🚩 ${p.name}: 선봉장 등장 (판 위에 있으면 모든 이동 +1)`); }
  },
  cannon: async () => {},
  pawn: async () => {},
  four: async () => {},
  cowback: async p => { p.st.cow = 0; },
  hand: async () => {},
  timetravel: async () => {},
  score: async p => {
    const got = [-1, 1, 2, 3, 4, 5].filter(k => p.st.seen[k]).map(resName).join('·');
    say(`🎼 악보: 이미 낸 결과 ${got || '없음'}`);
    if ([-1, 1, 2, 3, 4, 5].every(k => p.st.seen[k])) await specialWin(p, '악보 완성', 'score');
  },
  fog: async () => {},
  alkkagi: async () => {},
  fisher: async p => { p.st.fish = 0; },
  illusion: async p => {
    const targets = [];
    for (const q of G.players) {
      if (q.out) continue;
      for (const a of q.augs) {
        if (a.disabled || a.used || a.id === 'cat' || (a.catUntil && G.round < a.catUntil)) continue;
        if (q.id === p.id && a.id === 'illusion') continue;
        targets.push({ q, a });
      }
    }
    if (!targets.length) { say('언제부터 착각한 거지?: 바꿀 수 있는 증강이 없습니다'); return; }
    const opts = targets.map((t, i) => ({ label: `${t.q.name} · ${AUG_BY[t.a.id].name}`, sub: KIND_NAME[AUG_BY[t.a.id].kind], value: i, color: t.q.color }));
    const i = await io.ui.choose(p, '언제부터 착각한 거지?: 3라운드 동안 고양이로 바꿀 능력', opts, { ai: () => AI.illusion(p, targets) });
    if (i == null) return;
    const t = targets[i];
    t.a.catUntil = G.round + 3;
    say(`🐱 ${t.q.name}의 「${AUG_BY[t.a.id].name}」이(가) ${G.round + 2}라운드까지 고양이로 보입니다`, true);
  },
  throwhit: async () => {},
  dual: async () => {},
  objection: async p => { if (G.draft) G.draft.reroll = true; say(`🙋 ${p.name}: 이의있음!`); },
  jajin: async p => { p.st.geol = 0; },
  moonwalk: async p => {
    p.reverse = true;
    p.pieces.forEach(pc => { pc.trail = []; });
    say(`🌙 ${p.name}: 천마군림보 — 이제 반대 방향으로 걷습니다`);
  },
  shield: async () => {},
  redbutton: async p => {
    io.ui.flash('쾅!', '#e33');
    io.sfx.play('boom');
    const vs = boardPieces().filter(pc => DIAG.includes(canon(pc.pos)));
    say(`🔴 크고 빨간 버튼: 대각선 위 말 ${vs.length}개 폭파`, '#e33');
    await io.r.fxDiagBlast();
    if (vs.length) await killPieces(vs, p, 'redbutton');
  },
  friendshield: async () => {},
  sacrifice: async () => {},
  poop: async p => { placePoop(p); },
  equiv: async p => {
    if (needPieces(p).length > 1) {
      const i = p.pieces.findIndex(x => x.pos === HOME && x.type === 'normal');
      const j = i >= 0 ? i : p.pieces.findIndex(x => x.pos === HOME && x.type !== 'queen');
      if (j >= 0) p.pieces.splice(j, 1);
    }
    say(`⚖ ${p.name}: 등가교환 — 말 ${needPieces(p).length}개, 윷 ${stickCount(p)}개`);
  },
  party: async p => {
    const used = new Set(G.traps.map(t => canon(t.node)));
    const cands = shuffle(canonNodes().filter(n => !isExit(n) && n !== 1 && n !== 19 && !used.has(n)));
    cands.slice(0, 6).forEach(n => G.traps.push({ node: n, owner: p.id, kind: 'trap' }));
    cands.slice(6, 10).forEach(n => G.traps.push({ node: n, owner: p.id, kind: 'gift' }));
    say(`🎉 말이오? 파티: 함정 6개와 보상 4개 설치`, true);
  },
  speed: async p => {
    for (const q of G.players) {
      let normals = q.pieces.filter(x => x.type !== 'queen');
      while (normals.length > 2) {
        const rm = normals.find(x => x.pos === HOME) || normals.find(x => x.pos === DONE) || normals[normals.length - 1];
        q.pieces.splice(q.pieces.indexOf(rm), 1);
        normals = q.pieces.filter(x => x.type !== 'queen');
      }
      while (normals.length < 2) { q.pieces.push(makePiece(q.id)); normals = q.pieces.filter(x => x.type !== 'queen'); }
    }
    const ns = p.reverse ? [19, 18] : [1, 2];
    p.pieces.filter(x => x.type !== 'queen').slice(0, 2).forEach((pc, i) => {
      if (pc.pos === DONE) return;
      pc.pos = ns[i]; pc.trail = i === 1 ? [ns[0]] : [];
    });
    say('⚡ 스겜: 모두 말 2개! (소유자는 도·개에서 출발)', true);
    for (const n of ns) await resolveEnemiesAt(n, p);
  },
  kim: async p => {
    const pc = await pickOwnPiece(p, x => x.type === 'normal' && x.pos !== DONE, '김첨지로 바꿀 일반말');
    if (pc) { pc.type = 'kim'; p.st.kimTurns = 0; p.st.kimSpoiled = false; say(`${p.name}: 김첨지 — ${KIM_TURNS}차례 안에, 다른 말보다 먼저 완주하면 승리!`); }
  },
  queen: async p => {
    const pc = p.pieces.find(x => x.type === 'normal' && x.pos === HOME) || p.pieces.find(x => x.type === 'normal' && x.pos !== DONE);
    if (!pc) return;
    pc.type = 'queen'; pc.lives = 1; pc.pos = 10; pc.trail = []; p.st.queenThrows = 0;
    say(`👑 ${p.name}: 좌측 상단(10번)에 중전마마 — 12번 던질 때까지 지키세요`, true);
  },
  bear: async p => {
    const used = new Set(G.garlics.flatMap(g => g.nodes.map(canon)));
    const nodes = shuffle(canonNodes().filter(n => !isExit(n) && n !== 1 && n !== 19 && !used.has(n))).slice(0, 3);
    G.garlics.push({ owner: p.id, nodes, got: 0 });
    say(`🧄 웅녀: 마늘 3개가 ${nodes.join('·')}번 칸에 놓였습니다`);
  },
  piggy: async p => {
    const n = p.reverse ? 19 : 1;
    const hs = p.pieces.filter(x => x.pos === HOME && x.type !== 'pawn');
    hs.forEach(x => { x.pos = n; x.trail = []; });
    p.pieces.filter(x => onBoard(x) && canon(x.pos) === canon(n)).forEach(x => x.trail = []);
    say(`🐷 이리 오너라 업고 놀자: ${p.name}의 말 ${stackOf(hs[0] || p.pieces[0]).length}개가 업힌 채 도 칸에서 출발`);
    await resolveEnemiesAt(n, p);
  },
  burden: async p => { p.pieces.push(makePiece(p.id)); say(`🎒 ${p.name}: 짐덩이와 복덩이 — 말 ${needPieces(p).length}개, 윷 ${stickCount(p)}개`); },
  alone: async p => { p.aloneArmed = false; },
  seven: async () => {},
  nofriend: async p => { p.st.nofriend = {}; },
  demon: async p => {
    let n = 0;
    p.pieces.forEach(x => { if (x.type === 'normal') { x.type = 'cultist'; n++; } });
    p.st.ritual = 0;
    say(`🔮 마신 소환: 일반말 ${n}개가 광신도가 되었습니다`);
  },
  coup: async p => { p.st.kills = 0; },
  treason: async () => {},
  wait: async p => {
    const cands = others(p).filter(q => myStacks(q).length);
    if (!cands.length) { say('잠깐!: 판 위에 묶을 상대 말이 없습니다'); return; }
    const t = await io.ui.choosePlayer(p, '잠깐!: 가장 앞선 말뭉치를 묶을 플레이어', cands, { ai: () => AI.leader(p, cands) });
    if (!t) return;
    const s = myStacks(t).sort((a, b) => stepsToFinish(a[0].pos, a[0].trail, t.reverse) - stepsToFinish(b[0].pos, b[0].trail, t.reverse))[0];
    s.forEach(x => x.boundUntil = G.round + 2);
    io.r.fxText(s[0].pos, '속박', '#ccc');
    say(`⛓ 잠깐!: ${t.name}의 ${canon(s[0].pos)}번 칸 말뭉치가 ${G.round + 1}라운드까지 묶였습니다`, t.color);
  },
  peace: async p => { say(`🕊 ${p.name}: 평화 협정`); },
  plan: async p => {
    await io.ui.cover(p);
    let rest = G.players.slice();
    const order = [];
    for (let r = 1; r <= G.n; r++) {
      let id;
      if (rest.length === 1) id = rest[0].id;
      else {
        const opts = rest.map(q => ({ label: q.name + (q.rank ? ` (현재 ${q.rank}위 확정)` : ''), value: q.id, color: q.color }));
        id = await io.ui.choose(p, `계획대로: ${r}위는 누구?`, opts, { ai: () => AI.planPick(p, rest) });
      }
      order.push(id); rest = rest.filter(q => q.id !== id);
    }
    p.plan = order;
    if (!p.ai) await io.ui.cover(null, '예측 완료! 기기를 다음 사람에게 넘겨주세요');
    say(`📜 ${p.name}이(가) 최종 순위를 비밀리에 예측했습니다`);
  },
  murder: async p => { G.murder = true; G.players.forEach(q => q.st.hp = 3); say('🩸 나에게 윷놀이는 "살인"이다: 모두 체력 3', true); },
  necro: async () => {},
  grail: async () => {},
  bronze: async p => {
    if (G.n >= 3) {
      const fr = freeRanks();
      const r = fr.includes(3) ? 3 : fr.slice().sort((a, b) => Math.abs(a - 3) - Math.abs(b - 3) || b - a)[0];
      setRank(p, r, '동메달도 잘한 거야');
      say(`🥉 ${p.name}: 즉시 ${r}위!`, p.color);
    } else {
      p.badge = '🥉 특별 동메달';
      setRank(p, worstFree(), '동메달도 잘한 거야 (2인전 특별 배지)');
      say(`🥉 ${p.name}: 2인전 특별 동메달 엔딩!`, p.color);
    }
    io.ui.flash('동메달!', '#cd7f32');
    checkContention();
  },
  lastdance: async () => {},
  echo: async p => { G.echo = { owner: p.id, active: false }; say(`🔁 메아리의 형상: ${p.name}의 다음 차례부터 모두 두 번씩!`, true); },
  marathon: async () => {},
  duel: async p => {
    const cands = others(p);
    if (!cands.length) return;
    const t = await io.ui.choosePlayer(p, '승부다!: 도전할 플레이어를 고르세요', cands, { ai: () => AI.duelTarget(p, cands) });
    if (!t) return;
    G.duel = { caster: p.id, target: t.id, turns: 0 };
    say(`⚔ 승부다!: ${t.name}은(는) 3차례 안에 완주를 못 하면 탈락, 해내면 ${p.name} 탈락`, true);
  },
  comeback: async p => {
    const pool = shuffle(AUGS.filter(a => a.id !== 'comeback' && a.id !== 'objection' && !p.augs.some(x => x.id === a.id) && augAllowed(a.id)));
    const got = pool.slice(0, 3);
    say(`🎰 역전 찬스: ${got.map(a => a.name).join(', ')}`, true);
    await io.ui.alert('역전 찬스!', `<div class="book-list">${got.map(a => `<div class="book-item"><b>${esc(a.name)}</b><p>${esc(a.desc)}</p></div>`).join('')}</div>`, p);
    for (const a of got) { if (p.out || G.over) break; await acquire(p, a.id, { fromComeback: true }); }
  },
  domain: async () => {},
  cancel: async () => {},
  cannibal: async () => {}
};

/* =====================================================================
   13. 액티브 증강 (버튼)
   ===================================================================== */
export function dokPiece(p) { return p.pieces.find(x => x.type === 'dokkaebi' && x.pos !== DONE && !(onBoard(x) && stackBound(stackOf(x)))); }
export function cannonPiece(p) { return p.pieces.find(x => x.type === 'cannon' && onBoard(x) && !isBound(x)); }
export function cannonMoves(p) {
  const c = cannonPiece(p);
  if (!c) return [];
  const here = canon(c.pos), res = [];
  for (const L of LINES) {
    const cl = []; L.forEach(n => { const k = canon(n); if (cl[cl.length - 1] !== k) cl.push(k); });
    const i = cl.indexOf(here);
    if (i < 0) continue;
    for (const d of [1, -1]) {
      let j = i + d, screen = false;
      const path = [];
      while (j >= 0 && j < cl.length) {
        const n = cl[j];
        path.push(n);
        const occ = piecesAt(n).filter(x => x !== c);
        if (!screen) { if (occ.length) screen = true; }
        else if (occ.length) {
          if (occ.some(x => x.owner !== p.id) && !isExit(n)) res.push({ to: n, path: path.slice(), capture: true });
          break;
        } else if (!isExit(n)) res.push({ to: n, path: path.slice(), capture: false });
        j += d;
      }
    }
  }
  return res;
}
export function badukOptions(p) {
  const res = [], keys = new Set();
  for (const L of LINES) {
    const cl = []; L.forEach(n => { const k = canon(n); if (cl[cl.length - 1] !== k) cl.push(k); });
    const idx = [];
    cl.forEach((n, i) => { if (piecesAt(n).some(x => x.owner === p.id)) idx.push(i); });
    for (let a = 0; a < idx.length; a++) for (let b = a + 1; b < idx.length; b++) {
      const i1 = idx[a], i2 = idx[b];
      if (i2 - i1 < 2) continue;
      const vs = new Set();
      for (let k = i1 + 1; k < i2; k++) piecesAt(cl[k]).filter(x => x.owner !== p.id).forEach(x => vs.add(x));
      const key = [cl[i1], cl[i2]].sort((x, y) => x - y).join('-');
      if (vs.size && !keys.has(key)) { keys.add(key); res.push({ a: cl[i1], b: cl[i2], victims: [...vs] }); }
    }
  }
  return res;
}
export function backNodes(pc, p) {
  const out = [];
  let cur = pc.pos;
  const tr = pc.trail.slice();
  for (let k = 0; k < 30; k++) {
    const nx = tr.length ? tr.pop() : defaultPrev(cur, p.reverse);
    if (nx === undefined || isExit(nx)) break;
    if (!out.some(o => canon(o.node) === canon(nx)) && canon(nx) !== canon(pc.pos)) out.push({ node: nx, trail: tr.slice() });
    cur = nx;
  }
  return out;
}
export async function truckMove(p, s) {
  const lead = s[0], cur = lead.pos;
  const prev = lead.trail.length ? lead.trail[lead.trail.length - 1] : null;
  const nx0 = nextNode(cur, prev, true, p.reverse);
  const line = LINES.find(L => { const a = L.indexOf(cur), b = L.indexOf(nx0); return a >= 0 && b >= 0 && Math.abs(a - b) === 1; });
  if (!line) { say('8톤 트럭: 직선을 찾지 못했습니다'); return; }
  const dir = line.indexOf(nx0) - line.indexOf(cur);
  const path = [], trail = lead.trail.slice();
  let i = line.indexOf(cur), finished = false, poop = null, last = cur;
  for (;;) {
    const j = i + dir;
    if (j < 0 || j >= line.length) break;
    const n = line[j];
    if (piecesAt(n).filter(x => !s.includes(x)).length) break;
    trail.push(last); path.push(n); last = n; i = j;
    if (isExit(n)) { finished = true; break; }
    if (poopBlocks(n, p)) { poop = n; break; }
  }
  if (!path.length) { say('🚚 8톤 트럭: 바로 앞이 막혀 움직이지 못했습니다'); return; }
  say(`🚚 8톤 트럭: ${path.length}칸 직진!`, p.color);
  await executeMove(p, s, cur, { path, trail, finished, poop }, {});
}
export const ACTIONS = [
  { key: 'truck', aug: 'truck', once: true, fresh: true, label: '8톤 트럭', can: p => myStacks(p).some(s => s.length >= 2 && !stackBound(s)),
    run: async p => {
      const st = myStacks(p).filter(s => s.length >= 2 && !stackBound(s));
      const s = await io.ui.pickStack(p, st, '8톤 트럭: 2개 이상 업힌 말뭉치를 고르세요', { ai: () => AI.truckStack(p, st) });
      if (!s) return false;
      await truckMove(p, s); G.T.endNow = true; return true;
    } },
  { key: 'triple', aug: 'triple', once: true, fresh: true, label: '3단 합체 필살기!!!', can: p => myStacks(p).some(s => s.length >= 3),
    run: async p => {
      const st = myStacks(p).filter(s => s.length >= 3);
      const s = await io.ui.pickStack(p, st, '3단 합체: 3개 이상 업힌 말뭉치를 고르세요', { ai: () => st[0] });
      if (!s) return false;
      io.ui.flash('3단 합체 필살기!!!', p.color); io.sfx.play('boom');
      await io.r.fxNova(s[0].pos, p.color);
      await killPieces(boardPieces().filter(x => !s.includes(x)), p, 'triple');
      G.T.endNow = true; return true;
    } },
  { key: 'doberman', aug: 'doberman', label: p => `개 코인 2개 → 모 (${p.st.dogCoins})`, can: p => p.st.dogCoins >= 2 && G.T.throwsLeft > 0,
    run: async p => { p.st.dogCoins -= 2; say('🐕 도베르만: 개 코인 2개로 모!'); await doThrow(p, 5); return true; } },
  { key: 'spin', aug: 'spin', once: true, label: '돌림판 다시 돌리기', can: () => true, run: async p => { await doRotate(p); return true; } },
  { key: 'sniper', aug: 'sniper', label: '명사수 조준 (투척 1회)', can: p => G.T.throwsLeft > 0 && !G.targets.some(t => t.owner === p.id),
    run: async p => {
      const n = await io.ui.pickNode(p, canonNodes(), '명사수: 다음 내 차례에 쏠 칸을 고르세요', { ai: () => AI.sniperNode(p) });
      if (n == null) return false;
      G.T.throwsLeft--; G.T.fresh = false;
      G.targets.push({ node: n, owner: p.id });
      say(`🎯 ${p.name}: ${n}번 칸 조준 완료`, p.color);
      return true;
    } },
  { key: 'baduk', aug: 'baduk', once: true, label: '바둑', can: p => badukOptions(p).length > 0,
    run: async p => {
      const ops = badukOptions(p);
      const i = await io.ui.choose(p, '바둑: 내 말뭉치 둘 사이의 적을 잡습니다', ops.map((o, k) => ({ label: `${o.a}번 ↔ ${o.b}번`, sub: `적 ${o.victims.length}개`, value: k })), { cancel: true, ai: () => ops.reduce((bi, o, k) => o.victims.length > ops[bi].victims.length ? k : bi, 0) });
      if (i == null) return false;
      const kr = await killPieces(ops[i].victims, p, 'baduk');
      G.T.throwsLeft += kr.killed.length;
      say(`⚫ 바둑: 적 ${kr.killed.length}개를 잡고 투척 +${kr.killed.length}`, p.color);
      return true;
    } },
  { key: 'dokkaebi', aug: 'dokkaebi', once: true, label: '도깨비 변환', can: p => p.pieces.some(x => x.type === 'normal' && x.pos !== DONE),
    run: async p => { const pc = await pickOwnPiece(p, x => x.type === 'normal' && x.pos !== DONE, '도깨비로 바꿀 일반말'); if (!pc) return false; pc.type = 'dokkaebi'; say(`👹 ${p.name}: 도깨비 변환`); return true; } },
  { key: 'dokMove', aug: 'dokkaebi', label: '도깨비 걸음 (도/빽도)', can: p => !G.T.usedDok && !!dokPiece(p),
    run: async p => {
      const d = dokPiece(p);
      const opts = [{ label: '도 — 앞으로 1칸', value: 1 }];
      if (onBoard(d)) opts.push({ label: '빽도 — 뒤로 1칸', value: -1 });
      const v = await io.ui.choose(p, '도깨비 걸음', opts, { cancel: true, ai: () => AI.dokMove(p, d) });
      if (v == null) return false;
      G.T.usedDok = true; G.T.fresh = false;
      await moveStack(p, d, v);
      return true;
    } },
  { key: 'cannon', aug: 'cannon', once: true, label: '포 변환', can: p => p.pieces.some(x => x.type === 'normal' && x.pos !== DONE),
    run: async p => { const pc = await pickOwnPiece(p, x => x.type === 'normal' && x.pos !== DONE, '포로 바꿀 일반말'); if (!pc) return false; pc.type = 'cannon'; say(`包 ${p.name}: 포 변환`); return true; } },
  { key: 'cannonJump', aug: 'cannon', label: '포 넘기', can: p => !G.T.usedCannon && cannonMoves(p).length > 0,
    run: async p => {
      const ms = cannonMoves(p), c = cannonPiece(p);
      const n = await io.ui.pickNode(p, [...new Set(ms.map(m => m.to))], '포: 다리를 넘어 착지할 칸을 고르세요', { ai: () => AI.cannonPick(p, ms) });
      if (n == null) return false;
      const m = ms.find(x => x.to === n);
      G.T.usedCannon = true; G.T.fresh = false;
      await executeMove(p, [c], c.pos, { path: m.path, trail: [], finished: false, poop: null }, {});
      return true;
    } },
  { key: 'pawn', aug: 'pawn', once: true, label: '폰 변환', can: p => p.pieces.some(x => x.type === 'normal' && x.pos !== DONE),
    run: async p => { const pc = await pickOwnPiece(p, x => x.type === 'normal' && x.pos !== DONE, '폰으로 바꿀 일반말'); if (!pc) return false; pc.type = 'pawn'; say(`♟ ${p.name}: 폰 변환 (던질 때마다 자동 1칸)`); return true; } },
  { key: 'hand', aug: 'hand', once: true, label: '손은 눈보다 빠르다', can: () => G.T.throwsLeft > 0,
    run: async p => {
      const v = await io.ui.choose(p, '손은 눈보다 빠르다: 원하는 결과', [-1, 1, 2, 3, 4, 5].map(v => ({ label: resName(v), value: v })), { cancel: true, ai: () => AI.handValue(p) });
      if (v == null) return false;
      say(`🤚 ${p.name}: 손은 눈보다 빠르다 → ${resName(v)}`, p.color);
      await doThrow(p, v); return true;
    } },
  { key: 'timetravel', aug: 'timetravel', once: true, label: '시간 여행', can: p => p.pieces.some(x => onBoard(x) && !stackBound(stackOf(x)) && backNodes(x, p).length),
    run: async p => {
      const cands = p.pieces.filter(x => onBoard(x) && !stackBound(stackOf(x)) && backNodes(x, p).length);
      const pc = await io.ui.pickPiece(p, cands, '시간 여행: 되돌릴 말을 고르세요', { ai: () => AI.timeTravel(p).pc });
      if (!pc) return false;
      const bn = backNodes(pc, p);
      const n = await io.ui.pickNode(p, bn.map(b => b.node), '시간 여행: 돌아갈 칸을 고르세요', { ai: () => AI.timeTravel(p).node });
      if (n == null) return false;
      const b = bn.find(x => canon(x.node) === canon(n));
      say(`⏳ ${p.name}: 시간 여행`, p.color);
      await executeMove(p, [pc], pc.pos, { path: [b.node], trail: b.trail, finished: false, poop: null }, { noTrap: true });
      return true;
    } },
  { key: 'fog', aug: 'fog', once: true, label: '안개', can: () => true,
    run: async p => { G.fog = { caster: p.id, until: G.round + 2 }; io.sfx.play('magic'); say(`🌫 ${p.name}: 안개 — ${G.round + 1}라운드까지 다른 사람은 자기 말 근처만 보입니다`, true); return true; } },
  { key: 'alkkagi', aug: 'alkkagi', once: true, fresh: true, label: '알까기', can: p => p.pieces.some(onBoard),
    run: async p => { await ALK.run(p); G.T.endNow = true; return true; } },
  { key: 'throwhit', aug: 'throwhit', once: true, label: '윷을 잘 던져봐', can: p => others(p).length > 0,
    run: async p => {
      const t = await io.ui.choosePlayer(p, '윷을 잘 던져봐: 맞출 플레이어', others(p), { cancel: true, ai: () => AI.leader(p, others(p)) });
      if (!t) return false;
      io.sfx.play('throw');
      await io.ui.flyStick(t);
      io.sfx.play('hit');
      io.ui.flash(`퍽! ${t.name}`, t.color);
      t.skip += 2;
      say(`🥢 ${p.name}의 윷이 ${t.name}에게 명중! 차례 2번 건너뜀`, t.color);
      return true;
    } },
  { key: 'shield', aug: 'shield', once: true, label: '천상의 보호막', can: p => myStacks(p).length > 0,
    run: async p => {
      const st = myStacks(p);
      const s = await io.ui.pickStack(p, st, '천상의 보호막: 지킬 말뭉치를 고르세요', { ai: () => AI.shieldStack(p, st) });
      if (!s) return false;
      s.forEach(x => x.shield = Math.max(x.shield, 1));
      io.sfx.play('shield'); io.r.fxRing(s[0].pos, '#ffd65a');
      say(`🛡 ${p.name}: ${canon(s[0].pos)}번 칸 말뭉치에 보호막`, p.color);
      return true;
    } },
  { key: 'sacrifice', aug: 'sacrifice', once: true, label: '희생', can: p => p.pieces.some(onBoard),
    run: async p => {
      const cands = p.pieces.filter(onBoard);
      const pc = await io.ui.pickPiece(p, cands, '희생: 바칠 말 하나를 고르세요', { ai: () => AI.sacrificePick(p, cands) });
      if (!pc) return false;
      const node = pc.pos;
      const wasQueen = pc.type === 'queen', wasDomain = pc.domain;
      sendHome(pc);
      io.r.fxBoom(node, p.color);
      p.pieces.filter(onBoard).forEach(x => x.shield = Math.max(x.shield, 1));
      io.sfx.play('shield');
      say(`🕯 ${p.name}: 희생 — 판 위의 다른 말 모두 보호막`, p.color);
      if (wasQueen) await eliminate(p, '중전마마를 희생');
      else if (wasDomain) await eliminate(p, '영역 전개 말을 희생');
      return true;
    } },
  { key: 'necro', aug: 'necro', once: true, label: '네크로맨서', can: () => G.players.some(q => q.elim),
    run: async p => {
      const cands = G.players.filter(q => q.elim);
      const t = await io.ui.choosePlayer(p, '네크로맨서: 부활시킬 플레이어', cands, { cancel: true, ai: () => cands[0] });
      if (!t) return false;
      await revive(t, p); return true;
    } },
  { key: 'grail', aug: 'grail', label: '독이 든 성배 (+3 투척)', can: () => true,
    run: async p => { G.T.throwsLeft += 3; G.T.poisoned = true; G.T.fresh = false; io.sfx.play('magic'); say(`🍷 ${p.name}: 독이 든 성배 — 투척 +3, 이번 차례에 모가 나오면 탈락`, '#a3f'); return true; } },
  { key: 'lastdance', aug: 'lastdance', once: true, label: '라스트 댄스', can: () => !G.T.lastDance,
    run: async p => { G.T.lastDance = true; io.ui.flash('라스트 댄스', p.color); io.sfx.play('magic'); say(`💃 ${p.name}: 라스트 댄스 — 이번 차례 이동 2배, 끝나면 탈락`, true); return true; } },
  { key: 'marathon', aug: 'marathon', once: true, label: '마라토너 변환', can: p => p.pieces.some(x => x.type === 'normal' && x.pos === HOME),
    run: async p => { const pc = p.pieces.find(x => x.type === 'normal' && x.pos === HOME); pc.type = 'marathon'; say(`🏃 ${p.name}: 마라토너 — 완주하면 승리!`, p.color); return true; } },
  { key: 'domain', aug: 'domain', once: true, label: '영역 전개', can: p => p.pieces.some(x => onBoard(x) && !isBound(x)),
    run: async p => {
      const cands = p.pieces.filter(x => onBoard(x) && !isBound(x));
      const pc = await io.ui.pickPiece(p, cands, '영역 전개: 지정할 말을 고르세요', { ai: () => AI.domainPick(p, cands) });
      if (!pc) return false;
      pc.domain = true; p.domainPiece = pc.id; p.st.domainTurns = 0;
      io.sfx.play('magic'); io.ui.flash('영역 전개', p.color);
      say(`🔯 ${p.name}: 영역 전개 — 두 차례 동안 살아남으면 승리, 죽으면 탈락`, true);
      return true;
    } }
];
export function availableActions(p) {
  if (!G.T || G.T.pid !== p.id) return [];
  return ACTIONS.filter(a => {
    const inst = aug(p, a.aug);
    if (!inst) return false;
    if (a.once && inst.used) return false;
    if (a.fresh && !G.T.fresh) return false;
    try { return !!a.can(p); } catch (e) { return false; }
  });
}
export async function useAction(p, key) {
  const a = ACTIONS.find(x => x.key === key);
  if (!a) return;
  const inst = aug(p, a.aug);
  if (!inst || (a.once && inst.used) || !availableActions(p).includes(a)) return;
  const ok = await a.run(p);
  if (ok && a.once) inst.used = true;
  render();
}

/* =====================================================================
   14. 차례 진행
   ===================================================================== */
export async function turnStart(p) {
  p.st.turns++;
  if (has(p, 'kim') && p.pieces.some(x => x.type === 'kim' && x.pos !== DONE)) p.st.kimTurns++;
  if (G.echo && G.echo.owner === p.id && !G.echo.active) { G.echo.active = true; say('🔁 메아리의 형상: 지금부터 모든 플레이어가 차례를 두 번씩!', true); }
  const mine = G.targets.filter(t => t.owner === p.id);
  G.targets = G.targets.filter(t => t.owner !== p.id);
  for (const t of mine) {
    const vs = piecesAt(t.node);
    say(`🎯 ${p.name}의 명사수 발사! ${t.node}번 칸 (${vs.length}개)`, p.color);
    io.sfx.play('boom');
    await io.r.fxShot(t.node);
    if (vs.length) await killPieces(vs, p, 'sniper');
    if (p.out || G.over) return;
  }
  if (has(p, 'demon')) {
    const n = p.pieces.filter(x => x.type === 'cultist' && onBoard(x)).length;
    if (n) { p.st.ritual += n; say(`🔮 의식 코인 +${n} (${p.st.ritual}/12)`); }
    if (p.st.ritual >= 12) { io.ui.flash('마신 강림!', '#8f5fd0'); if (await specialWin(p, '마신 소환: 의식 코인 12개', 'demon')) return; }
  }
  if (p.domainPiece) {
    const pc = p.pieces.find(x => x.id === p.domainPiece);
    if (pc && pc.domain && onBoard(pc)) {
      p.st.domainTurns++;
      say(`🔯 영역 전개 ${p.st.domainTurns}/2`);
      if (p.st.domainTurns >= 2) { p.domainPiece = null; pc.domain = false; if (await specialWin(p, '영역 전개: 두 차례 생존', 'domain')) return; }
    } else p.domainPiece = null;
  }
  while (p.st.fishPending > 0) { p.st.fishPending--; G.T.chips.push(2); say(`🎣 ${p.name} 어부지리: 개 획득`); }
  if (has(p, 'poop')) placePoop(p);
  if (p.pieces.some(x => x.type === 'queen' && onBoard(x)) && has(p, 'queen')) say(`👑 중전마마 던진 횟수 ${p.st.queenThrows}/12`);
  render();
}
export async function turnEnd(p, skipped) {
  if (!skipped && G.T && G.T.lastDance && !p.out && !G.over) { say(`💃 라스트 댄스가 끝났습니다`); await eliminate(p, '라스트 댄스'); }
  if (G.duel && G.duel.target === p.id && !G.over) {
    G.duel.turns++;
    say(`⚔ 승부다! ${p.name} ${G.duel.turns}/3차례`);
    if (G.duel.turns >= 3) { G.duel = null; if (!p.out) { say(`⚔ 승부다!: ${p.name} 3차례 안에 완주 실패`, true); await eliminate(p, '승부다! 패배'); } }
  }
}
export async function useChip(p, ci, lead) {
  const T = G.T;
  const v = T.chips[ci];
  if (v === undefined) return;
  const leads = movableLeads(p, v);
  let ok = leads.find(x => x === lead) || leads.find(x => onBoard(x) && onBoard(lead) && stackOf(x).includes(lead));
  if (!ok) { io.ui.toast('그 말은 이 결과로 움직일 수 없어요'); return; }
  T.chips.splice(ci, 1);
  T.fresh = false;
  await moveStack(p, ok, modValue(p, v));
}
export async function performAction(p, act) {
  if (act.type === 'throw') await doThrow(p);
  else if (act.type === 'move') await useChip(p, act.chip, act.piece);
  else if (act.type === 'action') await useAction(p, act.key);
}
export const hasTurnActions = p => availableActions(p).length > 0;
export async function playTurn(p) {
  G.T = { pid: p.id, throwsLeft: 1, chips: [], counts: {}, fresh: true, poisoned: false, lastDance: false, usedDok: false, usedCannon: false, endNow: false, aiTried: new Set() };
  io.ui.sel = null;
  io.sfx.play('turn');
  render();
  if (p.skip > 0) {
    p.skip--;
    say(`⏭ ${p.name} 차례를 건너뜁니다${p.skip ? ` (앞으로 ${p.skip}번 더)` : ''}`, p.color);
    io.ui.flash(`${p.name} 건너뜀`, p.color);
    await sleep(1000);
    await turnEnd(p, true);
    return;
  }
  if (!p.ai && G.players.filter(q => !q.ai && !q.out).length > 1) io.ui.toast(`${p.name} (${p.cname}) 차례입니다`, p.color);
  await turnStart(p);
  while (!G.over && !p.out && !G.T.endNow) {
    const T = G.T;
    if (T.throwsLeft <= 0 && T.chips.length && !T.chips.some(v => movableLeads(p, v).length)) {
      say(`움직일 수 없는 결과(${T.chips.map(resName).join(', ')})는 버립니다`);
      T.chips = []; io.ui.sel = null;
    }
    const idle = T.throwsLeft <= 0 && !T.chips.length;
    if (idle && !p.ai && !hasTurnActions(p)) break;
    const act = p.ai ? await AI.act(p) : await io.ui.waitAction(p);
    if (!act || act.type === 'end') break;
    await performAction(p, act);
    if (!G.over) await checkBoardWins();
    render();
  }
  await turnEnd(p, false);
}
export function newRound() {
  G.round++;
  if (G.round > 80) { say('80라운드가 지나 진행도로 순위를 정합니다', true); G.over = true; return; }
  if (DRAFT_ROUNDS.includes(G.round)) G.needDraft = true;
  if (G.fog && G.round >= G.fog.until) { G.fog = null; say('🌫 안개가 걷혔습니다'); }
  say(`── ${G.round}라운드 ──`);
}
export function advanceTurn() {
  const cur = P(G.turnIdx);
  if (G.echo && G.echo.active && !G.echoSecond && !cur.out) { G.echoSecond = true; say(`🔁 메아리: ${cur.name} 한 번 더!`); return; }
  G.echoSecond = false;
  let i = G.turnIdx;
  for (let k = 0; k < G.n; k++) {
    i = (i + 1) % G.n;
    if (i === 0) newRound();
    if (!P(i).out) break;
  }
  G.turnIdx = i;
}

/* =====================================================================
   15. 증강 선택 라운드 (1R 시작 / 4R 중간 / 8R 마무리)
   ===================================================================== */
// 비밀 투표·비밀 지목 증강: 사람이 2명 이상 모여서 할 때(모여서 하기 모드)는 풀에서 뺀다
export const SECRET_AUGS = ['getdown', 'detective', 'delivery', 'plan', 'whoami'];
export const secretBanned = () => !!G.gather && G.players.filter(q => !q.ai).length >= 2;
export const augAllowed = id => !(secretBanned() && SECRET_AUGS.includes(id));
export function drawOptions(p, cat, excl) {
  const owned = id => p.augs.some(a => a.id === id);
  const opts = [];
  if (p.delivery) { if (!owned(p.delivery) && !excl.has(p.delivery) && augAllowed(p.delivery)) opts.push(p.delivery); p.delivery = null; }
  if (G.chosenRule && !owned('cat') && !opts.includes('cat') && !excl.has('cat') && Math.random() < 0.6) opts.push('cat');
  const pool = shuffle(AUGS.filter(a => (a.cat === 'general' || a.cat === cat) && !owned(a.id) && !excl.has(a.id) && !opts.includes(a.id) && augAllowed(a.id)).map(a => a.id));
  while (opts.length < 3 && pool.length) opts.push(pool.pop());
  return opts;
}
export async function draftRound() {
  const cat = G.round === DRAFT_ROUNDS[0] ? 'start' : G.round === DRAFT_ROUNDS[1] ? 'mid' : 'end';
  G.draft = { cat, banned: new Set(), picks: [], reroll: false };
  render();
  io.ui.flash(`${G.round}라운드 증강 선택`, '#e3b34a');
  say(`🃏 ${G.round}라운드 증강 선택 (${CAT_NAME[cat]} 전용 + 범용)${G.chaos ? ' · 혼돈 모드: 2번씩' : ''}`);
  await sleep(1000);
  const times = G.chaos ? 2 : 1;
  for (const p of G.players) {
    for (let k = 0; k < times; k++) {
      if (p.out || G.over) break;
      const excl = new Set();
      for (let guard = 0; guard < 6; guard++) {
        const opts = drawOptions(p, cat, excl);
        if (!opts.length) break;
        const forced = (G.chosenRule || has(p, 'catpick')) && opts.includes('cat');
        if (!p.ai) markSeen(opts);
        const id = await io.ui.draftPick(p, opts, forced, { k, times, cat });
        if (G.draft.banned.has(id)) {
          p.augs.push({ id, used: true, disabled: true, catUntil: 0 });
          say(`🔍 명탐정: ${p.name}의 「${AUG_BY[id].name}」 선택이 무효화되었습니다`, true);
          break;
        }
        await acquire(p, id);
        if (G.draft && G.draft.reroll) { G.draft.reroll = false; opts.forEach(o => excl.add(o)); continue; }
        break;
      }
    }
    if (G.over) break;
  }
  G.draft = null;
  render();
}

/* =====================================================================
   16. 메인 루프 · 종료
   ===================================================================== */
export async function flushPendingWins() {
  const list = G.pendingWins;
  G.pendingWins = [];
  for (const w of list) {
    const p = P(w.pid);
    if (G.over || p.out || !has(p, w.augId)) continue;
    say(`${WIN_FROM_ROUND}라운드: 미뤄 둔 ${p.name}의 승리 조건이 발동합니다`);
    await specialWin(p, w.why, w.augId);
  }
}
export async function gameLoop() {
  while (!G.over) {
    checkpoint();
    if (G.round >= WIN_FROM_ROUND && G.pendingWins.length) { await flushPendingWins(); if (G.over) break; }
    if (G.needDraft) { G.needDraft = false; await draftRound(); if (G.over) break; }
    const p = P(G.turnIdx);
    if (p.out) { advanceTurn(); continue; }
    await playTurn(p);
    G.T = null;
    io.ui.sel = null;
    render();
    if (G.over) break;
    advanceTurn();
    render();
    await sleep(260);
  }
  await finishGame();
}
export async function finishGame() {
  G.over = true;
  G.T = null;
  clearSave();
  const rest = G.players.filter(p => p.rank == null).sort((a, b) => progress(b) - progress(a));
  for (const p of rest) { const r = bestFree(); p.rank = r; G.rankTaken.add(r); p.outReason = p.outReason || '진행도 기준 순위'; }
  const order = G.players.slice().sort((a, b) => a.rank - b.rank || a.id - b.id);
  G.planWinner = null;
  for (const p of G.players) {
    if (!p.plan || !has(p, 'plan')) continue;
    const actual = order.map(q => q.id);
    const hit = actual.every((id, i) => id === p.plan[i]);
    say(`📜 ${p.name}의 계획대로: ${p.plan.map(id => P(id).name).join(' > ')} — ${hit ? '적중!' : '빗나감'}`);
    if (!hit) continue;
    const q = G.players.find(x => x.id !== p.id && has(x, 'cancel') && !aug(x, 'cancel').used);
    if (q) { aug(q, 'cancel').used = true; io.sfx.play('cancel'); io.ui.flash('취~소!', q.color); say(`✋ ${q.name}: 취~소! 계획대로가 무효`); await sleep(1000); continue; }
    G.planWinner = p;
    io.ui.flash('계획대로!', p.color);
    io.sfx.play('win');
    await sleep(1200);
    break;
  }
  render();
  recordGameEnd(G.planWinner ? [G.planWinner] : G.players.filter(q => q.rank === 1 && !q.elim));
  io.ui.results(order);
}

// 결과 화면 요약: 플레이어별 잡은·잡힌 말, 윷·모 횟수, 받은 증강, 결정적 순간 1~2개
export function buildSummary() {
  const players = G.players.map(p => ({
    id: p.id, name: p.name, capt: p.st.capt || 0, lost: p.st.lost || 0, yuts: p.st.yuts || 0, mos: p.st.mos || 0,
    augs: p.augs.filter(a => !a.disabled).map(a => AUG_BY[a.id].name)
  }));
  const ms = (G.moments || []).slice().sort((a, b) => b.score - a.score || a.round - b.round);
  if (G.planWinner) ms.unshift({ score: 200, text: `${G.planWinner.name}의 계획대로! 최종 순위를 모두 맞힘` });
  if (!ms.length) {
    const top = players.slice().sort((a, b) => b.capt - a.capt)[0];
    if (top && top.capt) ms.push({ text: `${top.name}이(가) 이번 판에서 가장 많은 말(${top.capt}개)을 잡음` });
  }
  return { players, moments: ms.slice(0, 2).map(m => m.text) };
}

export async function resumeGame() {
  const snap = readSave();
  if (!snap) { io.ui.buildTitle(); return; }
  bumpGen();
  setSkip(false);
  io.ui.closeAll();
  restoreSnap(snap);
  globalThis.__resumeCheck = serializeGame();
  io.ui.enterGame();
  render();
  say(`저장된 판을 ${G.round}라운드부터 이어서 합니다`);
  try { await gameLoop(); }
  catch (e) { if (e !== ABORT) { console.error(e); io.ui.toast('오류: ' + e.message, '#e33'); } }
}
export async function startGame() {
  bumpGen();
  setSkip(false);
  io.ui.closeAll();
  clearSave();
  newGame();
  io.ui.enterGame();
  render();
  say('윷판을 펼쳤습니다. 1라운드 증강 선택부터 시작합니다');
  try { await gameLoop(); }
  catch (e) { if (e !== ABORT) { console.error(e); io.ui.toast('오류: ' + e.message, '#e33'); } }
}

/* =====================================================================
   17. 안개 시야 (렌더러·AI 공용)
   ===================================================================== */
export const fogActive = () => !!(G && G.fog && G.round < G.fog.until);
export function visibleSet(viewer) {
  if (!fogActive() || !viewer || viewer.id === G.fog.caster) return null;
  const vis = new Set();
  for (const pc of viewer.pieces.filter(onBoard)) {
    const c = canon(pc.pos);
    vis.add(c);
    for (const n of NODES) if (canon(n) === c) for (const m of ADJ[n]) vis.add(canon(m));
  }
  return vis;
}
