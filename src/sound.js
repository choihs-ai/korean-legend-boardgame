import { aug } from './rules.js';

/* =====================================================================
   2. 효과음 — Web Audio 신디사이저 (외부 파일 없음)
   ===================================================================== */
export const SFX = {
  ctx: null, on: true, lastHit: 0,
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    try { const C = window.AudioContext || window.webkitAudioContext; if (C) this.ctx = new C(); } catch (e) { this.ctx = null; }
  },
  tone(f, d = 0.12, type = 'sine', v = 0.2, f2 = null, delay = 0) {
    if (!this.on || !this.ctx) return;
    const c = this.ctx, t = c.currentTime + delay;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + d);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(v, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o.connect(g); g.connect(c.destination); o.start(t); o.stop(t + d + 0.03);
  },
  noise(d = 0.08, v = 0.25, delay = 0, hp = 800) {
    if (!this.on || !this.ctx) return;
    const c = this.ctx, t = c.currentTime + delay;
    const len = Math.max(1, Math.floor(c.sampleRate * d));
    const buf = c.createBuffer(1, len, c.sampleRate), data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const s = c.createBufferSource(); s.buffer = buf;
    const f = c.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = hp;
    const g = c.createGain(); g.gain.value = v;
    s.connect(f); f.connect(g); g.connect(c.destination); s.start(t);
  },
  play(name) {
    if (!this.on || !this.ctx) return;
    switch (name) {
      case 'throw': for (let i = 0; i < 5; i++) this.noise(0.05, 0.3, i * 0.07 + Math.random() * 0.03, 1400); this.tone(320, 0.08, 'triangle', 0.1, 520, 0.3); break;
      case 'land': this.noise(0.08, 0.3, 0, 300); this.tone(190, 0.12, 'triangle', 0.18, 90); break;
      case 'step': this.tone(560, 0.045, 'square', 0.04); break;
      case 'capture': this.tone(240, 0.25, 'sawtooth', 0.16, 60); this.noise(0.18, 0.28, 0, 200); this.tone(880, 0.1, 'square', 0.07, 1320, 0.12); break;
      case 'finish': [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.18, 'triangle', 0.14, null, i * 0.09)); break;
      case 'aug': [660, 880, 1320].forEach((f, i) => this.tone(f, 0.14, 'sine', 0.12, null, i * 0.06)); break;
      case 'win': [523, 659, 784, 1046, 784, 1046, 1318].forEach((f, i) => this.tone(f, 0.24, 'triangle', 0.15, null, i * 0.12)); break;
      case 'bad': this.tone(210, 0.3, 'sawtooth', 0.14, 80); break;
      case 'click': this.tone(900, 0.04, 'square', 0.04); break;
      case 'shield': this.tone(1300, 0.22, 'sine', 0.12, 650); this.tone(1950, 0.15, 'sine', 0.06, 900, 0.05); break;
      case 'boom': this.noise(0.45, 0.5, 0, 50); this.tone(90, 0.45, 'sine', 0.3, 30); break;
      case 'hit': { const now = performance.now(); if (now - this.lastHit < 60) return; this.lastHit = now; this.noise(0.035, 0.4, 0, 2400); this.tone(1500, 0.04, 'square', 0.05); break; }
      case 'magic': [440, 554, 659, 880, 1108].forEach((f, i) => this.tone(f, 0.26, 'sine', 0.08, null, i * 0.05)); break;
      case 'cancel': this.tone(620, 0.16, 'square', 0.12, 300); this.tone(310, 0.32, 'square', 0.12, 150, 0.16); break;
      case 'fold': this.noise(0.35, 0.22, 0, 500); this.tone(300, 0.35, 'triangle', 0.1, 150); break;
      case 'turn': this.tone(392, 0.09, 'triangle', 0.08); this.tone(587, 0.12, 'triangle', 0.08, null, 0.08); break;
    }
  }
};
