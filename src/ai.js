import { CFG, G } from './state.js';
import { DONE, DRAFT_ROUNDS, HOME, pick, rand, sleep } from './util.js';
import { LINES, nextNode, NODES, ROT } from './board.js';
import { AUG_BY, AUGS } from './augs.js';
import { availableActions, backNodes, badukOptions, boardPieces, cannonMoves, cannonPiece, canon, computePath, dokPiece, foldAlias, has, hasCat, isExit, live, modValue, movableLeads, myStacks, needPieces, onBoard, others, P, piecesAt, progress, stackBound, stackOf, stepsToFinish, visibleSet } from './rules.js';

/* =====================================================================
   18. 스마트 AI
   ===================================================================== */
export const AI = {
  delay(ms) { return CFG.fast ? Math.round(ms * 0.35) : ms; },
  W: {
    truck: 4, triple: 6, fold: 4, cat: 1, chosen: 2, catpick: 1, catlove: 6, excess: 2, dogpig: 4, leech: 3, whoami: 3, notme: 4, getdown: 4,
    doberman: 5, spin: 4, sniper: 4, detective: 3, moordo: 4, baduk: 5, delivery: 4, dokkaebi: 6, vanguard: 7, cannon: 5, pawn: 4, four: 5,
    cowback: 3, hand: 6, timetravel: 4, score: 5, fog: 3, alkkagi: 5, fisher: 5, illusion: 4, throwhit: 6, dual: 7, objection: 2, jajin: 5,
    moonwalk: 3, shield: 6, redbutton: 5, friendshield: 5, sacrifice: 4, poop: 4,
    equiv: 6, party: 4, speed: 7, kim: 6, queen: 4, bear: 6, piggy: 5, burden: 5, alone: 4,
    seven: 5, nofriend: 4, demon: 8, coup: 7, treason: 5, wait: 6, peace: 5,
    plan: 3, murder: 6, necro: 3, grail: 5, bronze: 1, lastdance: 2, echo: 4, marathon: 8, duel: 5, comeback: 8, domain: 5, cancel: 6, cannibal: 3
  },
  level() { return CFG.difficulty || 'normal'; },
  noise() { return { easy: 45, normal: 10, hard: 0.5 }[this.level()] ?? 10; },
  pickAug(p, opts, forced) {
    if (forced) return 'cat';
    if (this.level() === 'easy') return pick(opts);
    let best = opts[0], bs = -1e9;
    const anyCat = G.players.some(q => hasCat(q));
    const catLovers = G.players.filter(q => !q.out && has(q, 'catlove'));
    for (const id of opts) {
      let s = (this.W[id] ?? 4) + rand() * (this.level() === 'hard' ? 3 : 6);
      if (id === 'catlove') s = anyCat ? 100 : s;
      if (id === 'cat') s = has(p, 'catlove') ? 100 : (catLovers.some(q => q.id !== p.id) ? -10 : s);
      if (id === 'chosen' && catLovers.some(q => q.id !== p.id)) s = -5;
      if (id === 'illusion' && has(p, 'catlove')) s = 60;
      if (id === 'bronze') { const order = live().sort((a, b) => progress(b) - progress(a)); s = (G.n >= 4 && order[order.length - 1] === p) ? 7 : 0.5; if (G.n === 2) s = -10; }
      if (id === 'necro' && !G.players.some(q => q.elim)) s = 2;
      if (id === 'four' && needPieces(p).length < 4) s = 0;
      if (id === 'lastdance' && this.remain(p) <= 5) s = 7;
      if (id === 'speed' && G.n >= 3) s += 1;
      if (id === 'cannibal' && has(p, 'piggy')) s = 0;
      if (s > bs) { bs = s; best = id; }
    }
    return best;
  },
  leader(p, cands) {
    if (!cands || !cands.length) return null;
    if (this.level() === 'easy') return pick(cands);
    return cands.slice().sort((a, b) => (progress(b) + (b.augs.filter(x => AUG_BY[x.id].kind === 'win').length * 15)) - (progress(a) + (a.augs.filter(x => AUG_BY[x.id].kind === 'win').length * 15)))[0];
  },
  remain(p) { return needPieces(p).filter(x => x.pos !== DONE).reduce((s, pc) => s + stepsToFinish(pc.pos, pc.trail, p.reverse), 0); },
  boardSteps(q) { return q.out ? 0 : q.pieces.filter(onBoard).reduce((s, pc) => s + stepsToFinish(pc.pos, pc.trail, q.reverse), 0); },
  danger(p, node, excl) {
    if (has(p, 'peace')) return 0;
    const PR = { '-1': 0.05, 1: 0.17, 2: 0.35, 3: 0.26, 4: 0.1, 5: 0.07 };
    const target = canon(node);
    let d = 0;
    for (const q of G.players) {
      if (q.out || q.id === p.id || has(q, 'peace')) continue;
      const leads = [], seen = new Set();
      for (const pc of q.pieces) {
        if (pc.pos === DONE || pc.type === 'pawn') continue;
        const k = pc.pos === HOME ? 'H' : 'n' + canon(pc.pos);
        if (seen.has(k)) continue;
        seen.add(k); leads.push(pc);
      }
      for (const pc of leads) for (const [v, pr] of Object.entries(PR)) {
        const r = computePath(pc, +v, q, [pc]);
        if (!r.finished && r.path.length && canon(r.path[r.path.length - 1]) === target) d += pr;
      }
    }
    return Math.min(1, d);
  },
  evalMove(p, lead, v) {
    const amt = modValue(p, v);
    const stack = lead.pos === HOME ? [lead] : stackOf(lead);
    const r = computePath(lead, amt, p, stack);
    if (!r.path.length && !r.finished) return -1e9;
    const n = stack.length;
    const special = stack.some(x => x.type === 'kim' || x.type === 'marathon') ? 2.5 : 1;
    const before = lead.pos === HOME ? stepsToFinish(HOME, [], p.reverse) + 2 : stepsToFinish(lead.pos, lead.trail, p.reverse);
    const value = n * 12 * special + (stack.some(x => x.type === 'queen') ? 70 : 0) + (stack.some(x => x.domain) ? 90 : 0);
    const dNow = lead.pos === HOME ? 0 : this.danger(p, lead.pos, stack);
    if (r.finished) return 60 * n * special + before + dNow * value - (stack.some(x => x.type === 'queen') ? 10 : 0);
    const dest = r.path[r.path.length - 1];
    const after = stepsToFinish(dest, r.trail, p.reverse);
    let s = (before - after) * 2.2 * n * special;
    if (lead.pos === HOME) s += 4;
    const vis = visibleSet(p);
    const here = piecesAt(dest).filter(x => !stack.includes(x));
    const en = vis && !vis.has(canon(dest)) ? [] : here.filter(x => x.owner !== p.id);
    if (en.length) {
      const blocked = has(p, 'peace') || en.some(x => has(P(x.owner), 'peace'));
      if (!blocked) {
        if (en.some(x => x.shield > 0)) s -= 6;
        else s += 35 + 12 * en.length + (has(p, 'coup') ? 25 : 0) + (has(p, 'murder') ? 15 : 0) + (v < 0 && has(p, 'cowback') ? 45 : 0) + (en.some(x => x.type === 'queen') ? 30 : 0);
      }
    }
    const mine = here.filter(x => x.owner === p.id && x.type !== 'pawn');
    if (mine.length) {
      if (has(p, 'cannibal')) {
        const lost = mine.reduce((a, x) => a + Math.max(0, stepsToFinish(HOME, [], p.reverse) - stepsToFinish(x.pos, x.trail, p.reverse)), 0);
        s += (G.T && G.T.chips.length > 6 ? -20 : 6) - lost * 2.2 - 4 * mine.length;
      } else s += 8 * mine.length + (has(p, 'four') ? 15 : 0);
    }
    if (r.poop) s -= 3;
    const tr = G.traps.find(t => canon(t.node) === canon(dest));
    if (tr) s += tr.kind === 'gift' ? 8 : (tr.owner === p.id ? 0 : -25 * n);
    const g = G.garlics.find(x => x.owner === p.id);
    if (g && has(p, 'bear')) for (const x of r.path) if (g.nodes.some(y => canon(y) === canon(x))) s += 35;
    if (!p.reverse && [5, 10, 22].includes(canon(dest))) s += 6;
    if (p.reverse && [15, 10, 22].includes(canon(dest))) s += 6;
    const dNew = this.danger(p, dest, stack);
    s += (dNow - dNew) * value;
    if (stack.some(x => x.shield > 0)) s += dNew * value * 0.7;
    return s + rand() * this.noise();
  },
  bestMove(p) {
    const T = G.T;
    let best = null;
    const tried = new Set();
    if (this.level() === 'easy' && rand() < 0.35) {
      // 쉬움: 가끔은 아무 말이나 움직인다
      const opts = [];
      T.chips.forEach((v, ci) => movableLeads(p, v).forEach(piece => opts.push({ s: 0, chip: ci, piece })));
      if (opts.length) return pick(opts);
    }
    T.chips.forEach((v, ci) => {
      if (tried.has(v)) return;
      tried.add(v);
      const homeSeen = new Set();
      for (const lead of movableLeads(p, v)) {
        if (lead.pos === HOME) { if (homeSeen.has(lead.type)) continue; homeSeen.add(lead.type); }
        const s = this.evalMove(p, lead, v);
        if (!best || s > best.s) best = { s, chip: ci, piece: lead };
      }
    });
    return best;
  },
  async act(p) {
    await sleep(this.delay(420));
    const T = G.T;
    T.aiSteps = (T.aiSteps || 0) + 1;
    if (T.aiSteps > 250) return { type: 'end' };
    for (const a of availableActions(p)) {
      if (T.aiTried.has(a.key)) continue;
      let want = false;
      try { want = this.want(p, a.key); } catch (e) { want = false; }
      if (want) { if (a.key !== 'doberman') T.aiTried.add(a.key); return { type: 'action', key: a.key }; }
    }
    if (T.throwsLeft > 0) return { type: 'throw' };
    const b = this.bestMove(p);
    if (b) return { type: 'move', chip: b.chip, piece: b.piece };
    return { type: 'end' };
  },
  want(p, key) {
    const lv = this.level();
    if (lv === 'easy') {
      // 쉬움: 변환·코인처럼 단순한 것만 바로 쓰고, 나머지는 가끔 아무 때나 쓴다
      if (['dokkaebi', 'cannon', 'pawn', 'marathon', 'necro'].includes(key)) return true;
      if (key === 'doberman') return G.T.throwsLeft > 0;
      if (['lastdance', 'grail', 'domain', 'triple', 'truck', 'alkkagi'].includes(key)) return rand() < 0.05;
      return rand() < 0.12;
    }
    const smart = this.wantSmart(p, key);
    return lv === 'normal' ? smart && rand() < 0.8 : smart;
  },
  wantSmart(p, key) {
    const T = G.T, idle = T.throwsLeft <= 0 && !T.chips.length;
    const foes = boardPieces().filter(x => x.owner !== p.id && !has(P(x.owner), 'peace'));
    switch (key) {
      case 'truck': return myStacks(p).some(s => s.length >= 2 && !stackBound(s) && this.truckLen(p, s) >= 4);
      case 'triple': {
        const big = Math.max(...myStacks(p).filter(s => s.length >= 3).map(s => s.length));
        return foes.length >= 2 && p.pieces.filter(onBoard).length - big <= 1;
      }
      case 'alkkagi': return foes.length >= 2 && rand() < 0.5;
      case 'doberman': return T.throwsLeft > 0;
      case 'spin': return this.rotateGain(p) >= 5;
      case 'sniper': return this.sniperNode(p) != null && T.throwsLeft >= 2;
      case 'baduk': return badukOptions(p).length > 0;
      case 'dokkaebi': case 'cannon': case 'pawn': case 'marathon': case 'necro': return true;
      case 'dokMove': return idle && this.dokBest(p).s > 2;
      case 'cannonJump': return idle && this.cannonBest(p).s > 3;
      case 'hand': return T.throwsLeft > 0 && !T.chips.length && this.handBest(p).s >= 45;
      case 'timetravel': return this.timeTravel(p).capture;
      case 'fog': return G.round >= 3 && rand() < 0.25;
      case 'throwhit': { const l = this.leader(p, others(p)); return !!l && (progress(l) > progress(p) + 40 || G.round >= 10); }
      case 'shield': return idle && myStacks(p).some(s => this.danger(p, s[0].pos, s) >= (s.length >= 2 ? 0.2 : 0.35));
      case 'sacrifice': return idle && p.pieces.filter(onBoard).length >= 3 && myStacks(p).filter(s => this.danger(p, s[0].pos, s) >= 0.3).length >= 2;
      case 'grail': return !T.poisoned && T.fresh && (this.remain(p) <= 10 || rand() < 0.08);
      case 'lastdance': return T.fresh && this.remain(p) <= 5;
      case 'domain': return myStacks(p).some(s => !stackBound(s) && this.danger(p, s[0].pos, s) < 0.05) && rand() < 0.4;
    }
    return false;
  },
  truckLen(p, s) {
    const lead = s[0], cur = lead.pos;
    const prev = lead.trail.length ? lead.trail[lead.trail.length - 1] : null;
    const nx0 = nextNode(cur, prev, true, p.reverse);
    const line = LINES.find(L => { const a = L.indexOf(cur), b = L.indexOf(nx0); return a >= 0 && b >= 0 && Math.abs(a - b) === 1; });
    if (!line) return 0;
    const dir = line.indexOf(nx0) - line.indexOf(cur);
    let i = line.indexOf(cur), len = 0;
    for (;;) {
      const j = i + dir;
      if (j < 0 || j >= line.length) break;
      const n = line[j];
      if (piecesAt(n).filter(x => !s.includes(x)).length) break;
      len++; i = j;
      if (isExit(n)) { len += 10; break; }
    }
    return len;
  },
  truckStack(p, st) { return st.slice().sort((a, b) => this.truckLen(p, b) - this.truckLen(p, a))[0]; },
  rotateGain(p) {
    const saved = G.alias;
    const before = G.players.map(q => this.boardSteps(q));
    const na = {};
    for (const n of NODES) { const a = saved[n]; if (a !== undefined) na[ROT[n]] = ROT[a]; }
    G.alias = na;
    const after = G.players.map(q => q.out ? 0 : q.pieces.filter(onBoard).reduce((s, pc) => s + stepsToFinish(ROT[pc.pos], pc.trail.map(n => ROT[n]), q.reverse), 0));
    G.alias = saved;
    let g = before[p.id] - after[p.id];
    const os = others(p);
    if (os.length) g -= os.reduce((s, q) => s + before[q.id] - after[q.id], 0) / os.length;
    return g;
  },
  foldDir(p) {
    const saved = G.alias;
    let best = 'v', bs = -1e9;
    for (const dir of ['h', 'v']) {
      G.alias = foldAlias(dir);
      const mine = this.boardSteps(p) + needPieces(p).filter(x => x.pos === HOME).length * stepsToFinish(HOME, [], p.reverse);
      const os = others(p);
      const theirs = os.length ? os.reduce((s, q) => s + this.boardSteps(q) + needPieces(q).filter(x => x.pos === HOME).length * stepsToFinish(HOME, [], q.reverse), 0) / os.length : 0;
      const sc = theirs - mine + rand();
      if (sc > bs) { bs = sc; best = dir; }
      G.alias = saved;
    }
    return best;
  },
  dogpig(p) {
    const T = G.T;
    if (!T) return 2;
    if (this.level() === 'easy') return pick([1, 2]);
    let b1 = -1e9, b2 = -1e9;
    for (const l of movableLeads(p, 1)) b1 = Math.max(b1, this.evalMove(p, l, 1));
    for (const l of movableLeads(p, 2)) b2 = Math.max(b2, this.evalMove(p, l, 2));
    return b1 > b2 + 5 ? 1 : 2;
  },
  handBest(p) {
    let best = { v: 4, s: -1e9 };
    for (const v of [-1, 1, 2, 3, 4, 5]) {
      let s = -1e9;
      for (const l of movableLeads(p, v)) s = Math.max(s, this.evalMove(p, l, v));
      if (v >= 4) s += 15;
      if (s > best.s) best = { v, s };
    }
    return best;
  },
  handValue(p) { return this.level() === 'easy' ? pick([-1, 1, 2, 3, 4, 5]) : this.handBest(p).v; },
  dokBest(p) {
    const d = dokPiece(p);
    if (!d) return { v: 1, s: -1e9 };
    let best = { v: 1, s: this.evalMove(p, d, 1) - 1 };
    if (onBoard(d)) { const s = this.evalMove(p, d, -1); if (s > best.s) best = { v: -1, s }; }
    return best;
  },
  dokMove(p) { return this.dokBest(p).v; },
  cannonScore(p, m) {
    const c = cannonPiece(p);
    if (!c) return -1e9;
    if (m.capture) return 50;
    return (stepsToFinish(c.pos, c.trail, p.reverse) - stepsToFinish(m.to, [], p.reverse)) * 2 - this.danger(p, m.to, [c]) * 12;
  },
  cannonBest(p) {
    let best = { m: null, s: -1e9 };
    for (const m of cannonMoves(p)) { const s = this.cannonScore(p, m); if (s > best.s) best = { m, s }; }
    return best;
  },
  cannonPick(p, ms) { const b = this.cannonBest(p); return b.m ? b.m.to : ms[0].to; },
  timeTravel(p) {
    const cands = p.pieces.filter(x => onBoard(x) && !stackBound(stackOf(x)));
    for (const pc of cands) for (const b of backNodes(pc, p)) {
      if (piecesAt(b.node).some(x => x.owner !== p.id && !has(P(x.owner), 'peace') && x.shield <= 0) && !has(p, 'peace')) return { pc, node: canon(b.node), capture: true };
    }
    const pc = cands[0];
    const bn = pc ? backNodes(pc, p) : [];
    return { pc: pc || null, node: bn.length ? canon(bn[0].node) : null, capture: false };
  },
  sniperNode(p) {
    const st = G.players.filter(q => q.id !== p.id && !q.out).flatMap(q => myStacks(q));
    if (!st.length) return null;
    return canon(st.sort((a, b) => b.length - a.length)[0][0].pos);
  },
  shieldStack(p, st) { return st.slice().sort((a, b) => this.danger(p, b[0].pos, b) * b.length - this.danger(p, a[0].pos, a) * a.length)[0]; },
  sacrificePick(p, cands) {
    const ok = cands.filter(x => x.type !== 'queen' && !x.domain);
    const pool = ok.length ? ok : cands;
    return pool.slice().sort((a, b) => stepsToFinish(b.pos, b.trail, p.reverse) - stepsToFinish(a.pos, a.trail, p.reverse))[0];
  },
  domainPick(p, cands) { return cands.slice().sort((a, b) => this.danger(p, a.pos, [a]) - this.danger(p, b.pos, [b]))[0]; },
  bestPieceFor(p, cands) {
    const board = cands.filter(onBoard).sort((a, b) => stepsToFinish(a.pos, a.trail, p.reverse) - stepsToFinish(b.pos, b.trail, p.reverse));
    return board[0] || cands[0];
  },
  detective(p, pool) {
    const picked = G.draft ? G.draft.picks.filter(x => x.pid !== p.id).map(x => x.id) : [];
    if (picked.length) return picked.sort((a, b) => (this.W[b] ?? 4) - (this.W[a] ?? 4))[0];
    const strong = pool.filter(o => (this.W[o.value] ?? 4) >= 7);
    return (strong.length ? pick(strong) : pick(pool)).value;
  },
  delivery(p) {
    const next = G.round < DRAFT_ROUNDS[1] ? 'mid' : G.round < DRAFT_ROUNDS[2] ? 'end' : 'general';
    const pool = AUGS.filter(a => (a.cat === next || a.cat === 'general') && !p.augs.some(x => x.id === a.id) && a.id !== 'delivery');
    // 비교 함수 안에서 난수를 부르면 정렬 알고리즘(엔진)마다 난수를 쓰는 횟수·순서가 달라진다 → 원소마다 한 번씩 미리 뽑아 둔다
    const scored = pool.map(a => ({ id: a.id, s: (this.W[a.id] ?? 4) + (rand() - 0.5) }));
    return scored.sort((a, b) => b.s - a.s)[0].id;
  },
  illusion(p, targets) {
    // 고양이로 착각된 증강이 생기는 순간 '고양이 좋아' 보유자가 이긴다
    const love = has(p, 'catlove');
    const rivalsLove = G.players.some(q => q.id !== p.id && !q.out && has(q, 'catlove'));
    let bi = 0, bs = -1e9;
    targets.forEach((t, i) => {
      let s;
      if (t.a.id === 'catlove') s = t.q.id === p.id ? -1000 : 200;
      else if (rivalsLove) s = -50;
      else if (love) s = 100 + (t.q.id !== p.id ? (this.W[t.a.id] ?? 4) : 0);
      else s = t.q.id === p.id ? -100 : (this.W[t.a.id] ?? 4) + (AUG_BY[t.a.id].kind === 'win' ? 4 : 0);
      if (s > bs) { bs = s; bi = i; }
    });
    return bi;
  },
  duelTarget(p, cands) {
    const score = q => { const b = q.pieces.filter(onBoard); return b.length ? Math.min(...b.map(pc => stepsToFinish(pc.pos, pc.trail, q.reverse))) : 40; };
    return cands.slice().sort((a, b) => score(b) - score(a))[0];
  },
  planPick(p, rest) {
    return rest.slice().sort((a, b) => ((a.rank ?? 99) - (b.rank ?? 99)) || (progress(b) - progress(a)))[0].id;
  }
};
