import { G, io, SKIP } from './state.js';
import { pick, sleep } from './util.js';
import { XY } from './board.js';
import { allGroups, canon, canonNodes, checkBoardWins, has, isExit, killPieces, live, onBoard, P, render, say } from './rules.js';
import { AI } from './ai.js';

/* =====================================================================
   21. 알까기 물리 모드 — 말뭉치를 2D 원형 강체로 바꿔 충돌 연산
   ===================================================================== */
export const ALK = {
  BOUND: 0.1, MAXPULL: 0.42, MAXV: 4.4,
  async run(p) {
    const discs = allGroups().map(s => {
      const [x, y] = XY[canon(s[0].pos)];
      return { x, y, vx: 0, vy: 0, r: 0.045, m: 1 + 0.35 * (s.length - 1), owner: s[0].owner, pieces: s.slice(), out: false, fall: 0 };
    });
    for (let it = 0; it < 6; it++) for (let i = 0; i < discs.length; i++) for (let j = i + 1; j < discs.length; j++) {
      const a = discs[i], b = discs[j];
      let dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
      if (d >= a.r + b.r) continue;
      if (d < 1e-6) { const ang = Math.random() * Math.PI * 2; dx = Math.cos(ang); dy = Math.sin(ang); d = 0; } else { dx /= d; dy /= d; }
      const push = (a.r + b.r - d) / 2 + 0.002;
      a.x -= dx * push; a.y -= dy * push; b.x += dx * push; b.y += dy * push;
    }
    G.alk = { discs, p, phase: 'aim', aim: null, onShot: null, last: 0, settle: 0 };
    io.sfx.play('magic');
    io.ui.flash('알까기!', p.color);
    say(`🥏 ${p.name}: 알까기 시작`, p.color);
    io.ui.banner(p.ai ? `${p.name} 조준 중…` : '알까기: 내 알을 잡고 뒤로 당겼다가 놓으세요', false);
    render();
    let shot;
    if (p.ai) {
      await sleep(AI.delay(700));
      shot = this.shotAI(p, discs);
      G.alk.aim = { d: shot.d, cx: shot.d.x - shot.vx * 0.08, cy: shot.d.y - shot.vy * 0.08 };
      await sleep(AI.delay(700));
      G.alk.aim = null;
    } else {
      shot = await new Promise(res => { G.alk.onShot = res; });
    }
    io.ui.hideBanner();
    shot.d.vx = shot.vx; shot.d.vy = shot.vy;
    io.sfx.play('hit');
    G.alk.phase = 'sim'; G.alk.last = 0;
    await io.r.wait(() => G.alk && G.alk.phase === 'done');
    let killedN = 0;
    for (const d of discs.filter(x => x.out)) {
      const live = d.pieces.filter(onBoard);
      if (!live.length) continue;
      const kr = await killPieces(live, p, 'alkkagi');
      killedN += kr.killed.length;
      if (d.pieces.some(onBoard)) { d.out = false; d.fall = 0; d.x = Math.min(1, Math.max(0, d.x)); d.y = Math.min(1, Math.max(0, d.y)); }
      if (p.out || G.over) break;
    }
    if (G.alk) this.snap(discs, p);
    say(`🥏 알까기 결과: 판 밖으로 나간 말 ${killedN}개`, p.color);
    G.alk = null;
    render();
    await checkBoardWins();
  },
  tick(t) {
    const A = G.alk;
    if (!A.last) { A.last = t; return; }
    const dt = Math.min(0.05, (t - A.last) / 1000);
    A.last = t;
    const n = SKIP ? 600 : 4;
    for (let i = 0; i < n && A.phase === 'sim'; i++) this.step(SKIP ? 0.01 : dt / 4);
    const moving = A.discs.some(d => !d.out && Math.hypot(d.vx, d.vy) > 0.01);
    const falling = A.discs.some(d => d.out && d.fall < 1);
    if (!moving && !falling) { A.settle += dt; if (A.settle > 0.25) A.phase = 'done'; } else A.settle = 0;
  },
  step(dt) {
    const ds = G.alk.discs, B = this.BOUND;
    for (const d of ds) {
      if (d.out) { d.fall = Math.min(1, d.fall + dt * 2.2); d.x += d.vx * dt * 0.3; d.y += d.vy * dt * 0.3; continue; }
      d.x += d.vx * dt; d.y += d.vy * dt;
      const sp = Math.hypot(d.vx, d.vy);
      if (sp > 0) { const ns = Math.max(0, sp * Math.exp(-1.5 * dt) - 0.35 * dt); d.vx *= ns / sp; d.vy *= ns / sp; }
      if (d.x < -B || d.x > 1 + B || d.y < -B || d.y > 1 + B) { d.out = true; io.sfx.play('bad'); }
    }
    for (let i = 0; i < ds.length; i++) for (let j = i + 1; j < ds.length; j++) {
      const a = ds[i], b = ds[j];
      if (a.out || b.out) continue;
      const dx = b.x - a.x, dy = b.y - a.y, dist = Math.hypot(dx, dy), min = a.r + b.r;
      if (dist >= min || dist < 1e-9) continue;
      const nx = dx / dist, ny = dy / dist;
      const over = (min - dist) / 2;
      a.x -= nx * over; a.y -= ny * over; b.x += nx * over; b.y += ny * over;
      const rel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
      if (rel < 0) {
        const J = -(1 + 0.9) * rel / (1 / a.m + 1 / b.m);
        a.vx -= J / a.m * nx; a.vy -= J / a.m * ny; b.vx += J / b.m * nx; b.vy += J / b.m * ny;
        io.sfx.play('hit');
      }
    }
  },
  down(ux, uy) {
    const A = G.alk;
    if (!A || A.phase !== 'aim' || A.p.ai) return;
    let best = null, bd = 0.11;
    for (const d of A.discs) { if (d.owner !== A.p.id) continue; const dd = Math.hypot(d.x - ux, d.y - uy); if (dd < bd) { bd = dd; best = d; } }
    if (best) A.aim = { d: best, cx: ux, cy: uy };
  },
  move(ux, uy) { const A = G.alk; if (A && A.aim && A.phase === 'aim' && !A.p.ai) { A.aim.cx = ux; A.aim.cy = uy; } },
  up(ux, uy) {
    const A = G.alk;
    if (!A || !A.aim || A.phase !== 'aim' || A.p.ai) return;
    const d = A.aim.d, vx = d.x - ux, vy = d.y - uy, L = Math.hypot(vx, vy);
    A.aim = null;
    if (L < 0.03) { io.ui.toast('알을 잡고 더 길게 당겼다 놓으세요'); return; }
    const pw = Math.min(L, this.MAXPULL) / this.MAXPULL, sp = 0.6 + pw * (this.MAXV - 0.6);
    if (A.onShot) { const f = A.onShot; A.onShot = null; f({ d, vx: vx / L * sp, vy: vy / L * sp }); }
  },
  cancel() { if (G.alk) G.alk.aim = null; },
  segDist(c, a, b) {
    const vx = b.x - a.x, vy = b.y - a.y, L2 = vx * vx + vy * vy || 1e-9;
    const t = Math.max(0, Math.min(1, ((c.x - a.x) * vx + (c.y - a.y) * vy) / L2));
    return Math.hypot(a.x + vx * t - c.x, a.y + vy * t - c.y);
  },
  shotAI(p, discs) {
    const mine = discs.filter(d => d.owner === p.id);
    const foes = discs.filter(d => d.owner !== p.id && !has(p, 'peace') && !has(P(d.owner), 'peace'));
    const B = this.BOUND;
    let best = null;
    for (const a of mine) for (const b of foes) {
      const dx = b.x - a.x, dy = b.y - a.y, dist = Math.hypot(dx, dy);
      if (dist < 1e-6) continue;
      const ux = dx / dist, uy = dy / dist;
      const tx = ux > 1e-6 ? (1 + B - b.x) / ux : ux < -1e-6 ? (-B - b.x) / ux : 9;
      const ty = uy > 1e-6 ? (1 + B - b.y) / uy : uy < -1e-6 ? (-B - b.y) / uy : 9;
      const edge = Math.min(tx, ty);
      const block = discs.some(c => c !== a && c !== b && this.segDist(c, a, b) < c.r + a.r);
      const sc = -(edge * 1.4 + dist * 0.8) - (block ? 2 : 0) + b.pieces.length * 0.4 - (b.pieces.some(x => x.shield > 0) ? 1.5 : 0);
      if (!best || sc > best.sc) best = { sc, a, ux, uy, need: dist + edge };
    }
    if (!best) { const a = pick(mine); const ang = Math.random() * Math.PI * 2; return { d: a, vx: Math.cos(ang) * 1.2, vy: Math.sin(ang) * 1.2 }; }
    const ang = Math.atan2(best.uy, best.ux) + (Math.random() - 0.5) * 0.1;
    const sp = Math.min(this.MAXV, 1.0 + best.need * 2.6);
    return { d: best.a, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp };
  },
  // 멈춘 알을 가장 가까운 칸으로 되돌림 (다른 플레이어 알과 같은 칸은 피함, 출구 칸 제외)
  snap(discs, p) {
    const taken = new Map();
    const alive = discs.filter(d => d.pieces.some(onBoard)).sort((a, b) => (a.owner === p.id ? 0 : 1) - (b.owner === p.id ? 0 : 1));
    const cn = canonNodes().filter(n => !isExit(n));
    for (const d of alive) {
      const sorted = cn.slice().sort((m, n) => Math.hypot(XY[m][0] - d.x, XY[m][1] - d.y) - Math.hypot(XY[n][0] - d.x, XY[n][1] - d.y));
      const n = sorted.find(k => !taken.has(k) || taken.get(k) === d.owner) ?? sorted[0];
      taken.set(n, d.owner);
      d.pieces.filter(onBoard).forEach(pc => { pc.pos = n; pc.trail = []; });
    }
  }
};
