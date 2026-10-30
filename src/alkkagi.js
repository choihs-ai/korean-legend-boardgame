import { G, io, SKIP } from './state.js';
import { pick, rand, sleep } from './util.js';
import { XY } from './board.js';
import { allGroups, canon, canonNodes, checkBoardWins, has, isExit, killPieces, live, onBoard, P, render, say } from './rules.js';
import { AI } from './ai.js';

/* =====================================================================
   21. 알까기 물리 모드 — 말뭉치를 2D 원형 강체로 바꿔 충돌 연산
   ===================================================================== */
/* 온라인 대전에서는 기기마다 물리 결과가 같아야 한다.
   - 사칙연산·sqrt 만 쓴다(hypot·exp·cos 같은 함수는 엔진마다 마지막 비트가 다를 수 있음)
   - 시간 간격은 화면 프레임과 무관한 고정값 DT 로 끝까지 미리 계산하고, 화면은 그 기록(frames)을 재생만 한다
   - 쏘는 힘은 소수 셋째 자리로 반올림해서 입력으로 주고받는다 */
const len = (x, y) => Math.sqrt(x * x + y * y);
const q3 = v => Math.round(v * 1000) / 1000;
const q6 = v => Math.round(v * 1e6) / 1e6;
const expSeries = x => { let t = 1, s = 1; for (let i = 1; i < 16; i++) { t = t * x / i; s += t; } return s; };
export const quantizeShot = sh => ({ d: sh.d, vx: q3(sh.vx), vy: q3(sh.vy) });

export const ALK = {
  BOUND: 0.1, MAXPULL: 0.42, MAXV: 4.4, DT: 0.01,
  async run(p) {
    const discs = allGroups().map(s => {
      const [x, y] = XY[canon(s[0].pos)];
      return { x, y, vx: 0, vy: 0, r: 0.045, m: 1 + 0.35 * (s.length - 1), owner: s[0].owner, pieces: s.slice(), out: false, fall: 0 };
    });
    for (let it = 0; it < 6; it++) for (let i = 0; i < discs.length; i++) for (let j = i + 1; j < discs.length; j++) {
      const a = discs[i], b = discs[j];
      let dx = b.x - a.x, dy = b.y - a.y, d = len(dx, dy);
      if (d >= a.r + b.r) continue;
      if (d < 1e-6) { const ang = rand() * Math.PI * 2; dx = q6(Math.cos(ang)); dy = q6(Math.sin(ang)); d = 0; } else { dx /= d; dy /= d; }
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
      shot = quantizeShot(this.shotAI(p, discs));
      G.alk.aim = { d: shot.d, cx: shot.d.x - shot.vx * 0.08, cy: shot.d.y - shot.vy * 0.08 };
      await sleep(AI.delay(700));
      G.alk.aim = null;
    } else {
      shot = quantizeShot(await io.ui.alkShot(p, discs));
    }
    io.ui.hideBanner();
    shot.d.vx = shot.vx; shot.d.vy = shot.vy;
    io.sfx.play('hit');
    G.alk.frames = this.simulate(discs);
    G.alk.fi = 0; G.alk.pt0 = 0;
    this.applyFrame(G.alk, 0);
    G.alk.phase = 'sim';
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
  // 쏜 뒤의 결과를 고정 간격으로 끝까지 계산해 프레임으로 기록한다. 프레임 = [소리표시, (x,y,out,fall)×알 수]
  simulate(discs) {
    const A = G.alk, frames = [], DT = this.DT;
    const snapFrame = mask => { const f = [mask]; for (const d of discs) f.push(d.x, d.y, d.out ? 1 : 0, d.fall); frames.push(f); };
    snapFrame(0);
    let calm = 0;
    for (let i = 0; i < 4000; i++) {
      const mask = this.step(DT);
      snapFrame(mask);
      const moving = discs.some(d => !d.out && len(d.vx, d.vy) > 0.01);
      const falling = discs.some(d => d.out && d.fall < 1);
      if (!moving && !falling) { if (++calm >= 25) break; } else calm = 0;
    }
    return frames;
  },
  applyFrame(A, i) {
    const f = A.frames[i];
    A.discs.forEach((d, j) => { d.x = f[1 + j * 4]; d.y = f[2 + j * 4]; d.out = !!f[3 + j * 4]; d.fall = f[4 + j * 4]; });
    return f[0];
  },
  // 화면 프레임마다 기록을 재생한다(건너뛰기 중이면 곧장 끝으로)
  tick(t) {
    const A = G.alk;
    if (!A.frames) return;
    if (!A.pt0) { A.pt0 = t; return; }
    const last = A.frames.length - 1;
    const target = SKIP ? last : Math.min(last, Math.floor((t - A.pt0) / (this.DT * 1000)));
    let mask = 0;
    while (A.fi < target) mask |= this.applyFrame(A, ++A.fi);
    if (mask & 1) io.sfx.play('hit');
    if (mask & 2) io.sfx.play('bad');
    if (A.fi >= last) A.phase = 'done';
  },
  // 헤드리스(테스트)·건너뛰기용: 재생 없이 끝 상태로
  finish() {
    const A = G.alk;
    if (A && A.frames) { A.fi = A.frames.length - 1; this.applyFrame(A, A.fi); A.phase = 'done'; }
  },
  step(dt) {
    const ds = G.alk.discs, B = this.BOUND;
    let mask = 0;
    for (const d of ds) {
      if (d.out) { d.fall = Math.min(1, d.fall + dt * 2.2); d.x += d.vx * dt * 0.3; d.y += d.vy * dt * 0.3; continue; }
      d.x += d.vx * dt; d.y += d.vy * dt;
      const sp = len(d.vx, d.vy);
      if (sp > 0) { const ns = Math.max(0, sp * expSeries(-1.5 * dt) - 0.35 * dt); d.vx *= ns / sp; d.vy *= ns / sp; }
      if (d.x < -B || d.x > 1 + B || d.y < -B || d.y > 1 + B) { d.out = true; mask |= 2; }
    }
    for (let i = 0; i < ds.length; i++) for (let j = i + 1; j < ds.length; j++) {
      const a = ds[i], b = ds[j];
      if (a.out || b.out) continue;
      const dx = b.x - a.x, dy = b.y - a.y, dist = len(dx, dy), min = a.r + b.r;
      if (dist >= min || dist < 1e-9) continue;
      const nx = dx / dist, ny = dy / dist;
      const over = (min - dist) / 2;
      a.x -= nx * over; a.y -= ny * over; b.x += nx * over; b.y += ny * over;
      const rel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
      if (rel < 0) {
        const J = -(1 + 0.9) * rel / (1 / a.m + 1 / b.m);
        a.vx -= J / a.m * nx; a.vy -= J / a.m * ny; b.vx += J / b.m * nx; b.vy += J / b.m * ny;
        mask |= 1;
      }
    }
    return mask;
  },
  down(ux, uy) {
    const A = G.alk;
    if (!A || A.phase !== 'aim' || A.p.ai) return;
    let best = null, bd = 0.11;
    for (const d of A.discs) { if (d.owner !== A.p.id) continue; const dd = len(d.x - ux, d.y - uy); if (dd < bd) { bd = dd; best = d; } }
    if (best) A.aim = { d: best, cx: ux, cy: uy };
  },
  move(ux, uy) { const A = G.alk; if (A && A.aim && A.phase === 'aim' && !A.p.ai) { A.aim.cx = ux; A.aim.cy = uy; } },
  up(ux, uy) {
    const A = G.alk;
    if (!A || !A.aim || A.phase !== 'aim' || A.p.ai) return;
    const d = A.aim.d, vx = d.x - ux, vy = d.y - uy, L = len(vx, vy);
    A.aim = null;
    if (L < 0.03) { io.ui.toast('알을 잡고 더 길게 당겼다 놓으세요'); return; }
    const pw = Math.min(L, this.MAXPULL) / this.MAXPULL, sp = 0.6 + pw * (this.MAXV - 0.6);
    if (A.onShot) { const f = A.onShot; A.onShot = null; f({ d, vx: vx / L * sp, vy: vy / L * sp }); }
  },
  cancel() { if (G.alk) G.alk.aim = null; },
  segDist(c, a, b) {
    const vx = b.x - a.x, vy = b.y - a.y, L2 = vx * vx + vy * vy || 1e-9;
    const t = Math.max(0, Math.min(1, ((c.x - a.x) * vx + (c.y - a.y) * vy) / L2));
    return len(a.x + vx * t - c.x, a.y + vy * t - c.y);
  },
  shotAI(p, discs) {
    const mine = discs.filter(d => d.owner === p.id);
    const foes = discs.filter(d => d.owner !== p.id && !has(p, 'peace') && !has(P(d.owner), 'peace'));
    const B = this.BOUND;
    let best = null;
    for (const a of mine) for (const b of foes) {
      const dx = b.x - a.x, dy = b.y - a.y, dist = len(dx, dy);
      if (dist < 1e-6) continue;
      const ux = dx / dist, uy = dy / dist;
      const tx = ux > 1e-6 ? (1 + B - b.x) / ux : ux < -1e-6 ? (-B - b.x) / ux : 9;
      const ty = uy > 1e-6 ? (1 + B - b.y) / uy : uy < -1e-6 ? (-B - b.y) / uy : 9;
      const edge = Math.min(tx, ty);
      const block = discs.some(c => c !== a && c !== b && this.segDist(c, a, b) < c.r + a.r);
      const sc = -(edge * 1.4 + dist * 0.8) - (block ? 2 : 0) + b.pieces.length * 0.4 - (b.pieces.some(x => x.shield > 0) ? 1.5 : 0);
      if (!best || sc > best.sc) best = { sc, a, ux, uy, need: dist + edge };
    }
    if (!best) { const a = pick(mine); const ang = rand() * Math.PI * 2; return { d: a, vx: Math.cos(ang) * 1.2, vy: Math.sin(ang) * 1.2 }; }
    const ang = Math.atan2(best.uy, best.ux) + (rand() - 0.5) * 0.1;
    const sp = Math.min(this.MAXV, 1.0 + best.need * 2.6);
    return { d: best.a, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp };
  },
  // 멈춘 알을 가장 가까운 칸으로 되돌림 (다른 플레이어 알과 같은 칸은 피함, 출구 칸 제외)
  snap(discs, p) {
    const taken = new Map();
    const alive = discs.filter(d => d.pieces.some(onBoard)).sort((a, b) => (a.owner === p.id ? 0 : 1) - (b.owner === p.id ? 0 : 1));
    const cn = canonNodes().filter(n => !isExit(n));
    for (const d of alive) {
      const sorted = cn.slice().sort((m, n) => len(XY[m][0] - d.x, XY[m][1] - d.y) - len(XY[n][0] - d.x, XY[n][1] - d.y));
      const n = sorted.find(k => !taken.has(k) || taken.get(k) === d.owner) ?? sorted[0];
      taken.set(n, d.owner);
      d.pieces.filter(onBoard).forEach(pc => { pc.pos = n; pc.trail = []; });
    }
  }
};
