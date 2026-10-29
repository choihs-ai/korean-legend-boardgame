import { CFG, G, GEN, SKIP } from './state.js';
import { $, HOME, sleep, TYPE_ICON } from './util.js';
import { CORNERS, LINES, XY } from './board.js';
import { SFX } from './sound.js';
import { boardPieces, canon, canonNodes, onBoard, P, visibleSet } from './rules.js';
import { ALK } from './alkkagi.js';
import { UI } from './ui.js';

/* =====================================================================
   19. 캔버스 렌더러
   ===================================================================== */
export const FONT = '"IBM Plex Sans KR","Apple SD Gothic Neo","Noto Sans KR","Malgun Gothic",sans-serif';
export const SERIF = '"Black Han Sans","Apple SD Gothic Neo","Noto Sans KR",sans-serif';
export const ease = t => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
export const R = {
  cv: null, ctx: null, S: 300, dpr: 1, dirty: true, hl: null, movable: null, rot: null, fold: null, paper: null, waiters: [],
  init() {
    this.cv = $('#board');
    try { ['16px "Black Han Sans"', '16px "IBM Plex Sans KR"', '700 16px "IBM Plex Sans KR"'].forEach(f => document.fonts && document.fonts.load(f, '가1')); } catch (e) { /* 폰트 API가 없으면 기본 글꼴 */ }
    this.ctx = this.cv.getContext('2d');
    const st = $('#stage');
    if (window.ResizeObserver) new ResizeObserver(() => this.resize()).observe(st);
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('orientationchange', () => setTimeout(() => this.resize(), 250));
    st.addEventListener('pointerdown', () => { if (UI.canSkip()) UI.startSkip(); });
    this.cv.addEventListener('pointerdown', e => {
      SFX.init();
      e.preventDefault();
      if (UI.canSkip()) return;
      const [ux, uy] = this.toUnit(e);
      if (G && G.alk) { ALK.down(ux, uy, e); return; }
      UI.tapNode(this.hitNode(ux, uy));
    });
    this.cv.addEventListener('pointermove', e => { if (G && G.alk) { e.preventDefault(); const [ux, uy] = this.toUnit(e); ALK.move(ux, uy); } });
    window.addEventListener('pointerup', e => { if (G && G.alk && this.cv) { const [ux, uy] = this.toUnit(e); ALK.up(ux, uy); } });
    window.addEventListener('pointercancel', () => { if (G && G.alk) ALK.cancel(); });
    const loop = t => {
      requestAnimationFrame(loop);
      try { this.frame(t); } catch (e) { console.error(e); }
    };
    requestAnimationFrame(loop);
  },
  resize() {
    const st = $('#stage');
    if (!st || !this.cv) return;
    const w = st.clientWidth, h = st.clientHeight;
    if (!w || !h) return;
    const S = Math.max(160, Math.floor(Math.min(w, h)));
    this.dpr = Math.min(3, window.devicePixelRatio || 1);
    if (S !== this.S || this.cv.width !== Math.round(S * this.dpr)) {
      this.S = S;
      this.cv.style.width = S + 'px'; this.cv.style.height = S + 'px';
      this.cv.width = Math.round(S * this.dpr); this.cv.height = Math.round(S * this.dpr);
      this.paper = null;
    }
    this.dirty = true;
  },
  get m() { return this.S * 0.1; },
  U(x, y) { const m = this.m, w = this.S - 2 * m; return [m + x * w, m + y * w]; },
  NP(n) { const [x, y] = XY[canon(n)]; return this.U(x, y); },
  homePt() { const [x, y] = this.NP(0); const d = this.m * 0.75; return [Math.min(this.S - 4, x + d), Math.min(this.S - 4, y + d)]; },
  toUnit(e) {
    const r = this.cv.getBoundingClientRect();
    const px = (e.clientX - r.left) * (this.S / r.width), py = (e.clientY - r.top) * (this.S / r.height);
    const m = this.m, w = this.S - 2 * m;
    return [(px - m) / w, (py - m) / w];
  },
  hitNode(ux, uy) {
    // 칸 터치 영역: 보이는 원보다 넓게, 최소 지름 44px
    let best = null, bd = Math.max(0.085, 22 / (this.S - 2 * this.m));
    for (const n of canonNodes()) { const d = Math.hypot(XY[n][0] - ux, XY[n][1] - uy); if (d < bd) { bd = d; best = n; } }
    return best;
  },
  makePaper() {
    const S = this.S, d = this.dpr;
    const c = document.createElement('canvas');
    c.width = Math.round(S * d); c.height = Math.round(S * d);
    const x = c.getContext('2d');
    x.scale(d, d);
    x.fillStyle = '#e4d9bd';
    this.rr(x, 2, 2, S - 4, S - 4, 6); x.fill();
    x.globalAlpha = 0.08; x.strokeStyle = '#7a5a2e';
    for (let i = 0; i < 260; i++) {
      const px = Math.random() * S, py = Math.random() * S, l = 4 + Math.random() * 18, a = Math.random() * Math.PI;
      x.lineWidth = 0.5 + Math.random();
      x.beginPath(); x.moveTo(px, py); x.lineTo(px + Math.cos(a) * l, py + Math.sin(a) * l); x.stroke();
    }
    x.globalAlpha = 1;
    x.strokeStyle = '#1f1a14'; x.lineWidth = 3;
    this.rr(x, 3, 3, S - 6, S - 6, 6); x.stroke();
    this.paper = c;
  },
  rr(x, a, b, w, h, r) { x.beginPath(); x.moveTo(a + r, b); x.arcTo(a + w, b, a + w, b + h, r); x.arcTo(a + w, b + h, a, b + h, r); x.arcTo(a, b + h, a, b, r); x.arcTo(a, b, a + w, b, r); x.closePath(); },
  wait(pred) { return new Promise(res => this.waiters.push({ pred, res, g: GEN })); },
  frame(t) {
    if (!this.ctx || !G || $('#game').hidden) return;
    if (!this.paper) this.makePaper();
    if (G.alk && G.alk.phase === 'sim') ALK.tick(t);
    this.draw(t);
    for (const w of this.waiters.slice()) {
      if (w.g !== GEN) { this.waiters.splice(this.waiters.indexOf(w), 1); continue; }
      if (w.pred(t)) { this.waiters.splice(this.waiters.indexOf(w), 1); w.res(); }
    }
  },
  draw(t) {
    const c = this.ctx, S = this.S;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.clearRect(0, 0, S, S);
    let ang = 0;
    if (this.rot) { const f = Math.min(1, Math.max(0, (t - this.rot.t0) / this.rot.dur)); ang = ease(f) * Math.PI / 2; if (f >= 1) this.rot.done = true; }
    c.save();
    if (ang) { c.translate(S / 2, S / 2); c.rotate(ang); c.translate(-S / 2, -S / 2); }
    c.drawImage(this.paper, 0, 0, S, S);
    this.drawFolded(c);
    this.drawLines(c);
    this.drawNodes(c, t);
    this.drawInstall(c, t);
    this.drawHighlights(c, t);
    if (G.alk) this.drawAlk(c, t); else this.drawPieces(c, t);
    this.drawFog(c, t);
    c.restore();
    this.drawExit(c, ang);
    this.drawFoldAnim(c, t);
    this.drawFx(c, t);
  },
  foldedQuads() {
    if (!Object.keys(G.alias).length) return [];
    const cn = canonNodes();
    const out = [];
    for (const [qx, qy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      const inside = cn.some(n => { const [x, y] = XY[n]; return (qx ? x > 0.5 : x < 0.5) && (qy ? y > 0.5 : y < 0.5); });
      if (!inside) out.push([qx, qy]);
    }
    return out;
  },
  drawFolded(c) {
    const qs = this.foldedQuads();
    if (!qs.length) return;
    const [x0, y0] = this.U(-0.08, -0.08), [x1, y1] = this.U(1.08, 1.08), [cx, cy] = this.U(0.5, 0.5);
    c.save();
    for (const [qx, qy] of qs) {
      const ax = qx ? cx : x0, ay = qy ? cy : y0, w = qx ? x1 - cx : cx - x0, h = qy ? y1 - cy : cy - y0;
      c.fillStyle = 'rgba(70,50,25,.28)'; c.fillRect(ax, ay, w, h);
      c.save();
      c.beginPath(); c.rect(ax, ay, w, h); c.clip();
      c.strokeStyle = 'rgba(70,50,25,.2)'; c.lineWidth = 1;
      const S = this.S;
      for (let k = -S; k < S * 2; k += S * 0.03) { c.beginPath(); c.moveTo(k, 0); c.lineTo(k - S, S); c.stroke(); }
      c.restore();
    }
    c.setLineDash([6, 5]); c.strokeStyle = 'rgba(90,50,20,.7)'; c.lineWidth = 2;
    const fx = qs.some(q => q[0] === 0) !== qs.some(q => q[0] === 1), fy = qs.some(q => q[1] === 0) !== qs.some(q => q[1] === 1);
    if (fx || qs.length >= 2) { c.beginPath(); c.moveTo(cx, y0); c.lineTo(cx, y1); c.stroke(); }
    if (fy || qs.length >= 2) { c.beginPath(); c.moveTo(x0, cy); c.lineTo(x1, cy); c.stroke(); }
    c.restore();
    c.save();
    c.fillStyle = 'rgba(60,40,20,.55)'; c.font = `700 ${Math.round(this.S * 0.035)}px ${FONT}`; c.textAlign = 'center';
    for (const [qx, qy] of qs) { const [lx, ly] = this.U(qx ? 0.78 : 0.22, qy ? 0.78 : 0.22); c.fillText('접힘', lx, ly); }
    c.restore();
  },
  drawLines(c) {
    c.save();
    c.strokeStyle = 'rgba(42,31,23,.82)'; c.lineWidth = Math.max(2, this.S * 0.007); c.lineCap = 'round';
    for (const L of LINES) for (let i = 0; i + 1 < L.length; i++) {
      const a = canon(L[i]), b = canon(L[i + 1]);
      if (a === b) continue;
      const [x1, y1] = this.U(...XY[a]), [x2, y2] = this.U(...XY[b]);
      c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke();
    }
    c.restore();
  },
  nodeR(n) { return CORNERS.includes(n) ? Math.max(15, this.S * 0.045) : Math.max(12, this.S * 0.033); },
  drawNodes(c) {
    const S = this.S;
    c.save();
    for (const n of canonNodes()) {
      const [x, y] = this.U(...XY[n]), r = this.nodeR(n);
      c.fillStyle = '#fbf4e2'; c.strokeStyle = 'rgba(42,31,23,.9)'; c.lineWidth = Math.max(1.5, S * 0.005);
      c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill(); c.stroke();
      if (CORNERS.includes(n)) { c.beginPath(); c.arc(x, y, r * 0.72, 0, Math.PI * 2); c.stroke(); }
      c.fillStyle = 'rgba(42,31,23,.42)'; c.font = `600 ${Math.max(11, Math.round(S * 0.029))}px ${FONT}`; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(String(n), x, y + 0.5);
    }
    const arrow = (from, to) => {
      if (canon(from) !== from || canon(to) !== to) return;
      const [x1, y1] = this.U(...XY[from]), [x2, y2] = this.U(...XY[to]);
      const a = Math.atan2(y2 - y1, x2 - x1), r0 = this.nodeR(from) + S * 0.012, s = S * 0.018;
      const ax = x1 + Math.cos(a) * r0, ay = y1 + Math.sin(a) * r0;
      c.fillStyle = 'rgba(207,63,44,.85)';
      c.beginPath(); c.moveTo(ax + Math.cos(a) * s * 1.4, ay + Math.sin(a) * s * 1.4);
      c.lineTo(ax + Math.cos(a + 2.5) * s, ay + Math.sin(a + 2.5) * s); c.lineTo(ax + Math.cos(a - 2.5) * s, ay + Math.sin(a - 2.5) * s); c.closePath(); c.fill();
    };
    arrow(5, 20); arrow(10, 23); arrow(22, 27);
    c.restore();
  },
  drawExit(c, ang) {
    const [x, y] = this.NP(0), S = this.S, r = this.nodeR(0);
    c.save();
    c.strokeStyle = '#cf3f2c'; c.lineWidth = Math.max(2.5, S * 0.008);
    c.beginPath(); c.arc(x, y, r * 1.18, 0, Math.PI * 2); c.stroke();
    c.fillStyle = '#cf3f2c'; c.font = `${Math.max(13, Math.round(S * 0.032))}px ${SERIF}`; c.textAlign = 'center'; c.textBaseline = 'middle';
    const lx = Math.min(S * 0.9, Math.max(S * 0.1, x)), ly = y + (y > S / 2 ? 1 : -1) * r * 1.95;
    c.fillText('출발·도착', lx, Math.min(S - S * 0.02, Math.max(S * 0.03, ly)));
    c.restore();
  },
  drawInstall(c, t) {
    const S = this.S;
    for (const pp of G.poops) {
      const [x0, y0] = this.NP(pp.node), r = this.nodeR(canon(pp.node));
      const x = x0 - r * 0.85, y = y0 + r * 0.7, s = S * 0.016;
      c.save(); c.fillStyle = '#7a4a1f'; c.strokeStyle = '#4a2a0f'; c.lineWidth = 1;
      [[0, 0.55, 1.2, 0.5], [0, 0.05, 0.9, 0.42], [0, -0.38, 0.55, 0.34]].forEach(([dx, dy, rx, ry]) => { c.beginPath(); c.ellipse(x + dx * s, y + dy * s, rx * s, ry * s, 0, 0, Math.PI * 2); c.fill(); c.stroke(); });
      c.beginPath(); c.moveTo(x, y - 0.7 * s); c.quadraticCurveTo(x + 0.3 * s, y - 1.1 * s, x + 0.1 * s, y - 1.3 * s); c.stroke();
      c.fillStyle = P(pp.owner).color; c.beginPath(); c.arc(x + 1.1 * s, y + 0.6 * s, s * 0.32, 0, Math.PI * 2); c.fill();
      c.restore();
    }
    for (const tr of G.traps) {
      const [x0, y0] = this.NP(tr.node), r = this.nodeR(canon(tr.node));
      const x = x0 - r * 0.85, y = y0 - r * 0.8, s = S * 0.017;
      c.save();
      if (tr.kind === 'trap') {
        c.fillStyle = '#222'; c.beginPath(); c.arc(x, y, s, 0, Math.PI * 2); c.fill();
        c.strokeStyle = '#8a6a3a'; c.lineWidth = 2; c.beginPath(); c.moveTo(x + s * 0.6, y - s * 0.6); c.quadraticCurveTo(x + s * 1.2, y - s * 1.3, x + s * 1.5, y - s * 1.1); c.stroke();
        const fl = 0.6 + 0.4 * Math.sin(t / 90);
        c.fillStyle = `rgba(255,${Math.round(150 + 80 * fl)},40,${fl})`; c.beginPath(); c.arc(x + s * 1.55, y - s * 1.15, s * 0.35, 0, Math.PI * 2); c.fill();
        c.fillStyle = P(tr.owner).color; c.beginPath(); c.arc(x - s * 0.3, y - s * 0.3, s * 0.25, 0, Math.PI * 2); c.fill();
      } else {
        c.fillStyle = '#d64a6a'; c.fillRect(x - s, y - s * 0.7, s * 2, s * 1.6);
        c.fillStyle = '#ffd65a'; c.fillRect(x - s * 0.18, y - s * 0.7, s * 0.36, s * 1.6); c.fillRect(x - s, y - s * 0.1, s * 2, s * 0.32);
        c.beginPath(); c.ellipse(x - s * 0.35, y - s * 0.9, s * 0.35, s * 0.2, -0.5, 0, Math.PI * 2); c.ellipse(x + s * 0.35, y - s * 0.9, s * 0.35, s * 0.2, 0.5, 0, Math.PI * 2); c.fill();
      }
      c.restore();
    }
    for (const g of G.garlics) for (const n of g.nodes) {
      const [x0, y0] = this.NP(n), r = this.nodeR(canon(n));
      const x = x0 + r * 0.85, y = y0 - r * 0.75, s = S * 0.016;
      c.save();
      c.fillStyle = '#fffaf0'; c.strokeStyle = '#a89a80'; c.lineWidth = 1.2;
      c.beginPath(); c.moveTo(x, y - s * 1.3); c.bezierCurveTo(x + s * 1.4, y - s * 0.4, x + s * 1.2, y + s, x, y + s); c.bezierCurveTo(x - s * 1.2, y + s, x - s * 1.4, y - s * 0.4, x, y - s * 1.3); c.fill(); c.stroke();
      c.beginPath(); c.moveTo(x, y - s * 0.9); c.lineTo(x, y + s * 0.9); c.moveTo(x - s * 0.5, y - s * 0.3); c.quadraticCurveTo(x - s * 0.6, y + s * 0.5, x - s * 0.35, y + s * 0.9); c.moveTo(x + s * 0.5, y - s * 0.3); c.quadraticCurveTo(x + s * 0.6, y + s * 0.5, x + s * 0.35, y + s * 0.9); c.stroke();
      c.fillStyle = P(g.owner).color; c.beginPath(); c.arc(x + s * 0.9, y + s * 0.8, s * 0.3, 0, Math.PI * 2); c.fill();
      c.restore();
    }
    for (const tg of G.targets) {
      const [x, y] = this.NP(tg.node), r = this.nodeR(canon(tg.node)) * 1.9;
      const col = P(tg.owner).color, pulse = 1 + 0.06 * Math.sin(t / 150);
      c.save(); c.strokeStyle = col; c.lineWidth = 2.5;
      c.beginPath(); c.arc(x, y, r * pulse, 0, Math.PI * 2); c.stroke();
      c.beginPath(); c.arc(x, y, r * 0.6 * pulse, 0, Math.PI * 2); c.stroke();
      c.beginPath(); c.moveTo(x - r * 1.25, y); c.lineTo(x - r * 0.3, y); c.moveTo(x + r * 0.3, y); c.lineTo(x + r * 1.25, y);
      c.moveTo(x, y - r * 1.25); c.lineTo(x, y - r * 0.3); c.moveTo(x, y + r * 0.3); c.lineTo(x, y + r * 1.25); c.stroke();
      c.restore();
    }
  },
  drawHighlights(c, t) {
    const pulse = 0.55 + 0.45 * Math.sin(t / 170);
    if (this.hl) {
      c.save(); c.strokeStyle = `rgba(181,52,31,${0.6 + 0.4 * pulse})`; c.lineWidth = Math.max(3, this.S * 0.01);
      for (const n of this.hl) { const [x, y] = this.U(...XY[n]); c.beginPath(); c.arc(x, y, this.nodeR(n) * 1.55, 0, Math.PI * 2); c.stroke(); }
      c.restore();
    }
    if (this.movable && G.T) {
      const col = P(G.T.pid).color;
      c.save();
      for (const [n, dest] of this.movable) {
        const [x, y] = this.U(...XY[n]);
        c.strokeStyle = `rgba(31,26,20,${0.45 + 0.5 * pulse})`; c.lineWidth = Math.max(3, this.S * 0.009);
        c.beginPath(); c.arc(x, y, this.nodeR(n) * 1.65, 0, Math.PI * 2); c.stroke();
        if (dest === 'fin') continue;
        if (dest == null) continue;
        const [dx, dy] = this.U(...XY[canon(dest)]);
        c.setLineDash([4, 5]); c.strokeStyle = col; c.globalAlpha = 0.65; c.lineWidth = 2;
        c.beginPath(); c.moveTo(x, y); c.lineTo(dx, dy); c.stroke(); c.setLineDash([]); c.globalAlpha = 1;
        c.fillStyle = col; c.beginPath(); c.arc(dx, dy, this.S * 0.012, 0, Math.PI * 2); c.fill();
      }
      c.restore();
    }
  },
  groupIcon(pcs) {
    const order = ['queen', 'kim', 'marathon', 'vanguard', 'cannon', 'dokkaebi', 'pawn', 'cultist'];
    for (const ty of order) if (pcs.some(x => x.type === ty)) return ty;
    return 'normal';
  },
  drawPieces(c, t) {
    const vis = G.T ? visibleSet(P(G.T.pid)) : null;
    const nodes = new Map();
    for (const pc of boardPieces()) {
      if (G.anim && G.anim.ids.has(pc.id)) continue;
      const cn = canon(pc.pos);
      if (vis && !vis.has(cn)) continue;
      if (!nodes.has(cn)) nodes.set(cn, new Map());
      const key = pc.owner + (pc.type === 'pawn' ? 'p' + pc.id : '');
      const m = nodes.get(cn);
      if (!m.has(key)) m.set(key, []);
      m.get(key).push(pc);
    }
    const pr = this.S * 0.034;
    for (const [n, m] of nodes) {
      const [x, y] = this.U(...XY[n]);
      const groups = [...m.values()], k = groups.length;
      groups.forEach((g, i) => {
        const a = (i / k) * Math.PI * 2 - Math.PI / 2, off = k > 1 ? pr * 0.62 : 0;
        this.drawPiece(c, x + Math.cos(a) * off, y + Math.sin(a) * off, k > 1 ? pr * 0.86 : pr, g, t);
      });
    }
    if (G.anim) {
      const A = G.anim;
      if (A.g !== GEN) { G.anim = null; return; }
      const f = Math.max(0, (t - A.t0) / A.step);
      const i = Math.floor(f);
      if (i > A.last) { A.last = i; if (i < A.pts.length) SFX.play('step'); }
      if (i >= A.pts.length - 1) {
        const [x, y] = A.pts[A.pts.length - 1];
        this.drawPiece(c, x, y, pr, A.pieces, t);
        const res = A.res; G.anim = null; res();
      } else {
        const fr = f - i, [x1, y1] = A.pts[i], [x2, y2] = A.pts[i + 1];
        const hop = Math.sin(fr * Math.PI) * pr * 0.7;
        c.save(); c.fillStyle = 'rgba(0,0,0,.18)'; c.beginPath(); c.ellipse(x1 + (x2 - x1) * fr, y1 + (y2 - y1) * fr + pr * 0.8, pr * 0.9, pr * 0.35, 0, 0, Math.PI * 2); c.fill(); c.restore();
        this.drawPiece(c, x1 + (x2 - x1) * fr, y1 + (y2 - y1) * fr - hop, pr * 1.08, A.pieces, t);
      }
    }
  },
  drawPiece(c, x, y, r, pcs, t) {
    const owner = P(pcs[0].owner);
    const masked = !!G.mask;
    const col = masked ? '#8d929e' : owner.color;
    c.save();
    c.fillStyle = 'rgba(20,12,4,.2)'; c.beginPath(); c.ellipse(x, y + r * 0.86, r * 0.95, r * 0.3, 0, 0, Math.PI * 2); c.fill();
    if (pcs.some(p => p.domain)) {
      c.save(); c.translate(x, y); c.rotate(t / 900); c.strokeStyle = 'rgba(143,95,208,.9)'; c.lineWidth = 2.5;
      c.beginPath(); for (let k = 0; k < 6; k++) { const a = k * Math.PI / 3; c.lineTo(Math.cos(a) * r * 1.75, Math.sin(a) * r * 1.75); } c.closePath(); c.stroke();
      c.fillStyle = 'rgba(143,95,208,.15)'; c.fill(); c.restore();
    }
    c.fillStyle = col; c.strokeStyle = '#1f1a14'; c.lineWidth = Math.max(2.5, r * 0.18);
    c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill(); c.stroke();
    c.strokeStyle = 'rgba(255,255,255,.55)'; c.lineWidth = Math.max(1, r * 0.08);
    c.beginPath(); c.arc(x, y, r * 0.82, 0, Math.PI * 2); c.stroke();
    if (masked) {
      c.fillStyle = '#fff'; c.font = `${Math.round(r * 1.05)}px ${SERIF}`; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(G.mask[owner.id] || '?', x, y + r * 0.05);
    } else this.drawIcon(c, this.groupIcon(pcs), x, y, r);
    if (pcs.some(p => p.shield > 0)) {
      c.strokeStyle = '#d0a23a'; c.lineWidth = r * 0.2;
      c.beginPath(); c.arc(x, y, r * 1.34, 0, Math.PI * 2); c.stroke();
      c.strokeStyle = '#1f1a14'; c.lineWidth = Math.max(1, r * 0.07);
      c.beginPath(); c.arc(x, y, r * 1.47, 0, Math.PI * 2); c.stroke();
    }
    if (pcs.some(p => p.boundUntil > G.round)) {
      c.strokeStyle = '#5d6170'; c.lineWidth = r * 0.2; c.setLineDash([r * 0.35, r * 0.22]);
      c.beginPath(); c.arc(x, y, r * 1.18, 0, Math.PI * 2); c.stroke(); c.setLineDash([]);
      c.strokeStyle = '#c9ccd6'; c.lineWidth = r * 0.08; c.setLineDash([r * 0.35, r * 0.22]); c.lineDashOffset = r * 0.17;
      c.beginPath(); c.arc(x, y, r * 1.18, 0, Math.PI * 2); c.stroke(); c.setLineDash([]); c.lineDashOffset = 0;
    }
    const q = pcs.find(p => p.type === 'queen');
    if (q && q.lives > 1 && !masked) {
      c.fillStyle = '#d64a6a'; c.font = `800 ${Math.round(r * 0.62)}px ${FONT}`; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText('♥' + q.lives, x - r * 1.05, y - r * 1.05);
    }
    if (pcs.length > 1) {
      const bx = x + r * 0.78, by = y - r * 0.78, br = r * 0.48;
      c.fillStyle = '#1f1a14'; c.strokeStyle = '#e4d9bd'; c.lineWidth = Math.max(1.5, r * 0.08);
      c.beginPath(); c.arc(bx, by, br, 0, Math.PI * 2); c.fill(); c.stroke();
      c.fillStyle = '#fff'; c.font = `800 ${Math.round(br * 1.25)}px ${FONT}`; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(String(pcs.length), bx, by + br * 0.05);
    }
    c.restore();
  },
  tint(hex, k) {
    const n = parseInt(hex.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
    const f = v => Math.round(v + (255 - v) * k);
    return `rgb(${f(r)},${f(g)},${f(b)})`;
  },
  drawIcon(c, type, x, y, r) {
    if (type === 'normal') { c.strokeStyle = 'rgba(255,255,255,.45)'; c.lineWidth = r * 0.1; c.beginPath(); c.arc(x, y, r * 0.5, 0, Math.PI * 2); c.stroke(); return; }
    c.save();
    c.fillStyle = '#fff'; c.strokeStyle = 'rgba(0,0,0,.55)'; c.lineWidth = Math.max(1, r * 0.1); c.lineJoin = 'round';
    if (type === 'queen') {
      c.fillStyle = '#ffd65a';
      c.beginPath(); c.moveTo(x - r * 0.58, y + r * 0.38); c.lineTo(x - r * 0.62, y - r * 0.32); c.lineTo(x - r * 0.28, y + r * 0.02); c.lineTo(x, y - r * 0.52);
      c.lineTo(x + r * 0.28, y + r * 0.02); c.lineTo(x + r * 0.62, y - r * 0.32); c.lineTo(x + r * 0.58, y + r * 0.38); c.closePath(); c.fill(); c.stroke();
    } else if (type === 'vanguard') {
      c.lineWidth = Math.max(1.5, r * 0.13); c.strokeStyle = '#fff';
      c.beginPath(); c.moveTo(x - r * 0.35, y + r * 0.58); c.lineTo(x - r * 0.35, y - r * 0.58); c.stroke();
      c.beginPath(); c.moveTo(x - r * 0.33, y - r * 0.58); c.lineTo(x + r * 0.55, y - r * 0.3); c.lineTo(x - r * 0.33, y - r * 0.02); c.closePath(); c.fill();
    } else if (type === 'pawn') {
      c.beginPath(); c.arc(x, y - r * 0.32, r * 0.2, 0, Math.PI * 2); c.fill();
      c.beginPath(); c.moveTo(x - r * 0.14, y - r * 0.14); c.lineTo(x + r * 0.14, y - r * 0.14); c.lineTo(x + r * 0.25, y + r * 0.28); c.lineTo(x + r * 0.42, y + r * 0.3);
      c.lineTo(x + r * 0.42, y + r * 0.5); c.lineTo(x - r * 0.42, y + r * 0.5); c.lineTo(x - r * 0.42, y + r * 0.3); c.lineTo(x - r * 0.25, y + r * 0.28); c.closePath(); c.fill();
    } else if (type === 'cultist') {
      c.beginPath(); c.ellipse(x, y, r * 0.58, r * 0.32, 0, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#5b2a8a'; c.beginPath(); c.arc(x, y, r * 0.2, 0, Math.PI * 2); c.fill();
    } else {
      c.font = `${Math.round(r * (type === 'kim' ? 0.88 : 1.02))}px ${SERIF}`; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.lineWidth = Math.max(1.5, r * 0.16); c.strokeText(TYPE_ICON[type], x, y + r * 0.06); c.fillText(TYPE_ICON[type], x, y + r * 0.06);
    }
    c.restore();
  },
  drawFog(c, t) {
    if (!G.T || G.alk) return;
    const vis = visibleSet(P(G.T.pid));
    if (!vis) return;
    c.save();
    for (const n of canonNodes()) {
      if (vis.has(n)) continue;
      const [x, y] = this.U(...XY[n]), r = this.S * (0.075 + 0.01 * Math.sin(t / 700 + n));
      const g = c.createRadialGradient(x, y, r * 0.15, x, y, r);
      g.addColorStop(0, 'rgba(205,210,220,.95)'); g.addColorStop(1, 'rgba(205,210,220,0)');
      c.fillStyle = g; c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
    }
    c.restore();
  },
  drawAlk(c, t) {
    const A = G.alk;
    const [bx0, by0] = this.U(-ALK.BOUND, -ALK.BOUND), [bx1, by1] = this.U(1 + ALK.BOUND, 1 + ALK.BOUND);
    c.save(); c.strokeStyle = 'rgba(181,52,31,.85)'; c.setLineDash([8, 6]); c.lineWidth = 2.5; c.strokeRect(bx0, by0, bx1 - bx0, by1 - by0); c.restore();
    const w = this.S - 2 * this.m;
    for (const d of A.discs) {
      if (!d.pieces.some(onBoard) && !d.out) continue;
      const [x, y] = this.U(d.x, d.y);
      const rr = d.r * w * (d.out ? Math.max(0.05, 1 - d.fall) : 1);
      if (d.out && d.fall >= 1) continue;
      c.save(); if (d.out) c.globalAlpha = Math.max(0, 1 - d.fall);
      this.drawPiece(c, x, y, rr, d.pieces, t);
      c.restore();
      if (A.aim && A.aim.d === d) {
        const [ax, ay] = this.U(A.aim.cx, A.aim.cy);
        c.save(); c.strokeStyle = 'rgba(42,31,23,.6)'; c.lineWidth = 3; c.beginPath(); c.moveTo(x, y); c.lineTo(ax, ay); c.stroke();
        const vx = d.x - A.aim.cx, vy = d.y - A.aim.cy, L = Math.hypot(vx, vy);
        if (L > 0.01) {
          const pw = Math.min(L, ALK.MAXPULL) / ALK.MAXPULL, len = w * (0.12 + 0.35 * pw), ux = vx / L, uy = vy / L;
          c.strokeStyle = `rgb(${Math.round(120 + 135 * pw)},${Math.round(160 - 100 * pw)},60)`; c.lineWidth = 5; c.setLineDash([10, 6]);
          c.beginPath(); c.moveTo(x, y); c.lineTo(x + ux * len, y + uy * len); c.stroke(); c.setLineDash([]);
          c.fillStyle = c.strokeStyle; c.beginPath(); const hx = x + ux * len, hy = y + uy * len, a = Math.atan2(uy, ux);
          c.moveTo(hx + Math.cos(a) * 12, hy + Math.sin(a) * 12); c.lineTo(hx + Math.cos(a + 2.4) * 10, hy + Math.sin(a + 2.4) * 10); c.lineTo(hx + Math.cos(a - 2.4) * 10, hy + Math.sin(a - 2.4) * 10); c.fill();
        }
        c.restore();
      }
    }
  },
  drawFoldAnim(c, t) {
    const F = this.fold;
    if (!F) return;
    const f = Math.min(1, Math.max(0, (t - F.t0) / F.dur));
    if (f >= 1) F.done = true;
    const [x0, y0] = this.U(-0.08, -0.08), [x1, y1] = this.U(1.08, 1.08), [cx, cy] = this.U(0.5, 0.5);
    const k = Math.cos(Math.PI * ease(f));
    c.save();
    c.shadowColor = 'rgba(0,0,0,.4)'; c.shadowBlur = 18;
    c.fillStyle = k >= 0 ? 'rgba(242,231,205,.92)' : 'rgba(214,193,150,.96)';
    if (F.dir === 'h') {
      const h = (cy - y0) * Math.abs(k);
      if (F.keepHigh) { if (k >= 0) c.fillRect(x0, cy - h, x1 - x0, h); else c.fillRect(x0, cy, x1 - x0, h); }
      else { if (k >= 0) c.fillRect(x0, cy, x1 - x0, h); else c.fillRect(x0, cy - h, x1 - x0, h); }
    } else {
      const w = (cx - x0) * Math.abs(k);
      if (F.keepHigh) { if (k >= 0) c.fillRect(cx - w, y0, w, y1 - y0); else c.fillRect(cx, y0, w, y1 - y0); }
      else { if (k >= 0) c.fillRect(cx, y0, w, y1 - y0); else c.fillRect(cx - w, y0, w, y1 - y0); }
    }
    c.restore();
  },
  /* ----- 이펙트 ----- */
  fxAt(node) { return this.NP(node); },
  fxBoom(node, color) {
    if (!G) return;
    const [x, y] = this.fxAt(node);
    const parts = Array.from({ length: 12 }, () => ({ a: Math.random() * Math.PI * 2, s: 0.6 + Math.random() * 0.8 }));
    G.fx.push({ type: 'boom', x, y, color: color || '#e33', t0: performance.now(), dur: 650, parts });
  },
  fxText(node, text, color) { if (!G) return; const [x, y] = this.fxAt(node); G.fx.push({ type: 'text', x, y, text, color: color || '#fff', t0: performance.now(), dur: 1100 }); },
  fxRing(node, color) { if (!G) return; const [x, y] = this.fxAt(node); G.fx.push({ type: 'ring', x, y, color: color || '#ffd65a', t0: performance.now(), dur: 700 }); },
  async fxShot(node) { const [x, y] = this.fxAt(node); G.fx.push({ type: 'shot', x, y, t0: performance.now(), dur: 600 }); await sleep(600); },
  async fxNova(node, color) { const [x, y] = this.fxAt(node); G.fx.push({ type: 'nova', x, y, color, t0: performance.now(), dur: 700 }); await sleep(650); },
  async fxDiagBlast() { G.fx.push({ type: 'diag', t0: performance.now(), dur: 700 }); await sleep(650); },
  drawFx(c, t) {
    const now = performance.now(), S = this.S;
    G.fx = G.fx.filter(f => now - f.t0 < f.dur);
    for (const f of G.fx) {
      const k = (now - f.t0) / f.dur;
      c.save();
      if (f.type === 'boom') {
        c.globalAlpha = 1 - k; c.strokeStyle = f.color; c.lineWidth = 4 * (1 - k) + 1;
        c.beginPath(); c.arc(f.x, f.y, S * 0.02 + S * 0.08 * k, 0, Math.PI * 2); c.stroke();
        c.fillStyle = f.color;
        for (const p of f.parts) { const d = S * 0.11 * k * p.s; c.beginPath(); c.arc(f.x + Math.cos(p.a) * d, f.y + Math.sin(p.a) * d, S * 0.008 * (1 - k) + 1, 0, Math.PI * 2); c.fill(); }
      } else if (f.type === 'text') {
        c.globalAlpha = k < 0.75 ? 1 : (1 - k) * 4; c.font = `800 ${Math.round(S * 0.045)}px ${FONT}`; c.textAlign = 'center';
        c.lineWidth = 4; c.strokeStyle = 'rgba(21,26,44,.85)'; c.fillStyle = f.color;
        c.strokeText(f.text, f.x, f.y - S * 0.05 - S * 0.05 * k); c.fillText(f.text, f.x, f.y - S * 0.05 - S * 0.05 * k);
      } else if (f.type === 'ring') {
        c.globalAlpha = 1 - k; c.strokeStyle = f.color; c.lineWidth = 5; c.shadowColor = f.color; c.shadowBlur = 14;
        c.beginPath(); c.arc(f.x, f.y, S * 0.045 + S * 0.04 * k, 0, Math.PI * 2); c.stroke();
      } else if (f.type === 'shot') {
        const r = S * (0.18 - 0.14 * Math.min(1, k * 1.6));
        c.strokeStyle = '#cf3f2c'; c.lineWidth = 3; c.globalAlpha = 1 - Math.max(0, k - 0.7) * 3;
        c.beginPath(); c.arc(f.x, f.y, r, 0, Math.PI * 2); c.moveTo(f.x - r * 1.3, f.y); c.lineTo(f.x + r * 1.3, f.y); c.moveTo(f.x, f.y - r * 1.3); c.lineTo(f.x, f.y + r * 1.3); c.stroke();
        if (k > 0.6) { c.fillStyle = `rgba(255,220,120,${1 - k})`; c.beginPath(); c.arc(f.x, f.y, S * 0.06, 0, Math.PI * 2); c.fill(); }
      } else if (f.type === 'nova') {
        c.globalAlpha = 1 - k; c.strokeStyle = f.color || '#fff'; c.lineWidth = 8 * (1 - k) + 2;
        c.beginPath(); c.arc(f.x, f.y, S * 0.9 * k, 0, Math.PI * 2); c.stroke();
      } else if (f.type === 'diag') {
        c.globalAlpha = (1 - k) * 0.85; c.strokeStyle = '#ff3b2f'; c.lineWidth = S * 0.05 * (1 - k * 0.5); c.lineCap = 'round'; c.shadowColor = '#ff3b2f'; c.shadowBlur = 20;
        const a = this.U(...XY[canon(5)]), b = this.U(...XY[canon(15)]), d1 = this.U(...XY[canon(10)]), d2 = this.U(...XY[canon(0)]);
        c.beginPath(); c.moveTo(...a); c.lineTo(...b); c.moveTo(...d1); c.lineTo(...d2); c.stroke();
      }
      c.restore();
    }
  },
  async animRotate() { if (SKIP) return; this.rot = { t0: performance.now(), dur: 750 }; await this.wait(() => this.rot && this.rot.done); this.rot = null; },
  async animFold(dir) {
    if (SKIP) return;
    const ex = XY[canon(0)];
    this.fold = { dir, t0: performance.now(), dur: 850, keepHigh: dir === 'h' ? ex[1] > 0.5 : ex[0] > 0.5 };
    await this.wait(() => this.fold && this.fold.done);
    this.fold = null;
  }
};
export function animateMove(stack, from, path, p) {
  if (SKIP || !path.length || !R.cv || $('#game').hidden) return Promise.resolve();
  return new Promise(res => {
    const pts = [from === HOME ? R.homePt() : R.NP(from), ...path.map(n => R.NP(n))];
    G.anim = { ids: new Set(stack.map(x => x.id)), pieces: stack.slice(), pts, t0: performance.now(), step: (CFG.fast && p.ai) ? 85 : 145, last: 0, res, g: GEN };
  });
}
