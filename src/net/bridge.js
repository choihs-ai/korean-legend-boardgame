// 온라인 대전 ↔ 게임 엔진 연결.
//
// 방식: 모든 기기가 같은 엔진을 같은 시드로 돌린다. 사람이 고르는 순간(증강 선택, 윷 던지기, 말 이동 …)만
// "몇 번째 입력인지(k)"와 "무엇을 골랐는지"를 기록으로 주고받는다. 엔진은 같은 기록을 받으면 어디서나 같은 결과를 낸다.
//  - 입력 k 의 주인은 그 순간 차례인 좌석의 사람. 주인 기기는 화면에서 고른 값을 기록에 올리고,
//    다른 기기는 그 기록이 올 때까지 기다렸다가 같은 값으로 엔진을 진행한다.
//  - AI 좌석은 입력을 받지 않고 엔진이 직접 계산한다(난수가 같으니 모든 기기에서 같은 선택).
//  - 좌석을 AI 로 바꾸는 명령(type 1)은 "k 번째 입력부터"라는 기준(floor)을 달고 와서 모든 기기가 같은 시점에 적용한다.
import { CFG, G, io, NET, bumpGen, setInstant, setSkip, GEN } from '../state.js';
import { ABORT, getRng, setRng, sleep } from '../util.js';
import { newGame, gameLoop, P, say } from '../rules.js';
import { AI } from '../ai.js';
import { ALK } from '../alkkagi.js';
import { hashState } from '../save.js';
import { seededRng } from './sha256.js';

export const T_ANSWER = 0, T_AI = 1;

/* ----- 답 ↔ 문자열/숫자 (기록에는 짧고 단순한 값만 담는다) ----- */
const allPieces = () => G.players.flatMap(p => p.pieces);
const pieceById = id => allPieces().find(x => x.id === id) || null;
const optIndex = (options, v) => { if (v == null) return -1; const i = options.findIndex(o => o.value === v); return i; };
const goodInt = v => Number.isInteger(v);

export class Bridge {
  // store: 입력 기록 저장소(Room 또는 테스트용 가짜)  ui/r/sfx/animateMove: 화면 어댑터
  constructor({ store, ui, r, sfx, animateMove, auto = false, alwaysInstant = false, onEvent = () => {} }) {
    Object.assign(this, { store, ui, r, sfx, animateMoveFn: animateMove, auto, alwaysInstant, onEvent });
    this.k = 0; this.resolved = []; this.waiters = []; this.replaying = false; this.info = null; this.pending = null;
    this.privRng = null; this.running = false; this.rebuilds = 0; this.collectCount = 0;
    this.unsub = null;
  }

  /* ----- 시작 · 재시작(되감기) ----- */
  async run(info) {
    this.info = info;
    const gen = bumpGen();
    this.rejectWaiters();
    this.k = 0; this.resolved = []; this.pending = null;
    if (this.unsub) this.unsub();
    this.unsub = this.store.subscribe(() => this.onStoreChange());
    const n = info.cf.n, humans = info.ro.length;
    Object.assign(CFG, {
      n, slots: Array.from({ length: n }, (_, i) => (i < humans ? 'human' : 'ai')), chaos: !!info.cf.ch, endOnFirst: !!info.cf.ef,
      difficulty: info.cf.df || 'normal', gather: false, names: info.nicks.slice(),
    });
    NET.online = true; NET.localSeat = this.store.localSeat();
    NET.onCheckpoint = () => this.store.reportHash(this.k, hashState());
    setRng(seededRng(info.sd));
    this.install();
    this.replaying = this.store.hasEntries();
    setInstant(this.replaying || this.alwaysInstant); setSkip(this.replaying);
    this.ui.closeAll();
    newGame();
    this.ui.enterGame();
    this.ui.refresh();
    say('온라인 대전을 시작합니다. 1라운드 증강 선택부터 시작합니다');
    this.running = true;
    try { await gameLoop(); }
    catch (e) { if (e !== ABORT) { console.error(e); this.onEvent('error', e); } }
    if (gen === GEN) { this.leaveReplay(); this.running = false; this.onEvent('over', null); }
  }
  stop() {
    bumpGen(); this.rejectWaiters(); this.running = false;
    if (this.unsub) { this.unsub(); this.unsub = null; }
    this.uninstall();
    setRng(null); setInstant(this.alwaysInstant); setSkip(false);
    NET.online = false; NET.localSeat = -1; NET.onCheckpoint = null;
  }
  leaveReplay() {
    if (!this.replaying) return;
    this.replaying = false; setInstant(this.alwaysInstant); setSkip(false);
    this.ui.refresh();
  }

  /* ----- 화면 어댑터 끼워 넣기 ----- */
  install() {
    this.saved = { ui: io.ui, r: io.r, sfx: io.sfx, am: io.animateMove };
    const me = this;
    const MUTE_UI = new Set(['flash', 'toast', 'banner', 'hideBanner', 'refresh', 'ticker']);
    io.ui = new Proxy(this.ui, {
      get: (t, k) => {
        if (k in me.ov) return me.ov[k];
        const v = t[k];
        if (typeof v !== 'function') return v;
        if (me.replaying && MUTE_UI.has(k)) return () => {};
        return v.bind(t);
      },
      set: (t, k, v) => { t[k] = v; return true; },
    });
    io.r = new Proxy(this.r, {
      get: (t, k) => {
        const v = t[k];
        if (!me.replaying || typeof v !== 'function') return typeof v === 'function' ? v.bind(t) : v;
        if (k === 'wait') return async pred => { if (G && G.alk && G.alk.phase === 'sim') ALK.finish(); if (!pred()) throw new Error('재생 중 대기 조건 불충족'); };
        return () => Promise.resolve();
      },
      set: (t, k, v) => { t[k] = v; return true; },
    });
    io.sfx = new Proxy(this.sfx, { get: (t, k) => (me.replaying && k === 'play' ? () => {} : typeof t[k] === 'function' ? t[k].bind(t) : t[k]), set: (t, k, v) => { t[k] = v; return true; } });
    io.animateMove = (...a) => (this.replaying ? Promise.resolve() : this.animateMoveFn(...a));
  }
  uninstall() {
    if (!this.saved) return;
    io.ui = this.saved.ui; io.r = this.saved.r; io.sfx = this.saved.sfx; io.animateMove = this.saved.am; this.saved = null;
  }

  /* ----- 기록 조회 ----- */
  peek(k, seat) {
    if (this.store.aiFloor(seat) <= k) return { x: true };
    const a = this.store.answerFor(seat, k);
    return a === undefined ? null : { a };
  }
  waitFor(k, seat) {
    return new Promise((res, rej) => {
      const w = { k, seat, res, rej, gen: GEN };
      this.waiters.push(w);
      this.pump();
    });
  }
  pump() {
    for (const w of this.waiters.slice()) {
      if (w.gen !== GEN) { this.waiters.splice(this.waiters.indexOf(w), 1); w.rej(ABORT); continue; }
      const r = this.peek(w.k, w.seat);
      if (r) { this.waiters.splice(this.waiters.indexOf(w), 1); w.res(r); }
    }
  }
  rejectWaiters() { for (const w of this.waiters.splice(0)) w.rej(ABORT); }
  // 새 기록이 도착했을 때: 이미 지나온 입력이 뒤집혔는지 확인 (AI 대체 명령이 늦게 도착한 경우)
  onStoreChange() {
    if (!this.running) return;
    for (let k = 0; k < this.resolved.length; k++) {
      const r = this.resolved[k];
      if (r && r.how === 'a' && this.store.aiFloor(r.seat) <= k) { this.rebuild(); return; }
    }
    this.pump();
    this.onEvent('change', null);
  }
  rebuild() {
    this.rebuilds++;
    this.onEvent('rebuild', null);
    this.run(this.info);
  }

  /* ----- 사람 입력 한 번 ----- */
  // collect(): 화면에서 값을 받는 함수(Promise)   enc/dec: 값 ↔ 기록 값   aiRun(): 이 좌석이 AI 로 바뀌었을 때 엔진이 쓸 경로
  async prompt(p, collect, enc, dec, aiRun) {
    if (p.ai) return aiRun();
    const gen = GEN, seat = p.id, k = this.k++;
    const alive = () => { if (gen !== GEN) throw ABORT; };
    this.pending = { k, seat };
    let res = this.peek(k, seat);
    if (res) {
      if (!this.replaying) setSkip(true); // 뒤처진 상태: 다음에 기다릴 때까지 연출을 건너뛰며 따라잡는다
    } else {
      this.leaveReplay();
      setSkip(false);
      if (this.store.isLocal(seat)) {
        const waiter = this.waitFor(k, seat);
        waiter.catch(() => {});
        this.collectCount++;
        const local = Promise.resolve(collect()).then(v => ({ local: v }));
        const first = await Promise.race([waiter, local]);
        alive();
        if ('local' in first) {
          this.store.propose(T_ANSWER, k, enc(first.local), seat);
          res = await this.waitFor(k, seat);
        } else { this.ui.closeAll(); res = first; }
      } else {
        this.ui.remote = p; this.ui.refresh();
        try { res = await this.waitFor(k, seat); } finally { this.ui.remote = null; }
      }
      alive();
    }
    this.pending = null;
    this.resolved[k] = { seat, how: res.x ? 'x' : 'a' };
    if (res.x) { p.ai = true; say(`${p.name}: AI가 대신 둡니다`, p.color); return aiRun(); }
    return dec(res.a);
  }

  get ov() { return this._ov || (this._ov = this.makeOverrides()); }
  makeOverrides() {
    const me = this, ui = this.ui;
    // 자동 조종(테스트)이 공용 난수열을 쓰면 이 기기만 난수가 앞서가 버린다 → 답을 만드는 동안만 따로 난수를 쓴다
    const priv = async fn => {
      if (!me.privRng) me.privRng = seededRng('private' + Math.random());
      const keep = getRng(); setRng(me.privRng);
      try { return await fn(); } finally { setRng(keep); }
    };
    const first = (arr, f = x => x) => arr.find(x => !x.disabled) ?? arr[0];
    return {
      async choose(p, title, options, o = {}) {
        const collect = () => (me.auto ? priv(async () => (o.ai ? o.ai() : first(options).value)) : ui.choose(p, title, options, { ...o, blind: false }));
        return me.prompt(p, collect,
          v => optIndex(options, v),
          i => (goodInt(i) && i >= 0 && i < options.length ? options[i].value : (options.find(x => !x.disabled) ?? options[0]).value),
          () => ui.choose(p, title, options, o));
      },
      async choosePlayer(p, title, cands, o = {}) {
        const collect = () => (me.auto ? priv(async () => (o.ai ? o.ai() : cands[0])) : ui.choosePlayer(p, title, cands, { ...o, blind: false }));
        return me.prompt(p, collect,
          v => (v == null ? -1 : v.id),
          i => (i === -1 ? null : cands.find(c => c.id === i) ?? cands[0]),
          () => ui.choosePlayer(p, title, cands, o));
      },
      async pickNode(p, nodes, msg, o = {}) {
        const collect = () => (me.auto ? priv(async () => (o.ai ? o.ai() : nodes[0])) : ui.pickNode(p, nodes, msg, o));
        return me.prompt(p, collect,
          v => (v == null ? -1 : v),
          i => (i === -1 ? null : nodes.includes(i) ? i : nodes[0]),
          () => ui.pickNode(p, nodes, msg, o));
      },
      async pickStack(p, stacks, msg, o = {}) {
        const collect = () => (me.auto ? priv(async () => (o.ai ? o.ai() : stacks[0])) : ui.pickStack(p, stacks, msg, o));
        return me.prompt(p, collect,
          v => (v == null ? -1 : v[0].id),
          i => (i === -1 ? null : stacks.find(s => s[0].id === i) ?? stacks[0]),
          () => ui.pickStack(p, stacks, msg, o));
      },
      async pickPiece(p, cands, msg, o = {}) {
        const collect = () => (me.auto ? priv(async () => (o.ai ? o.ai() : cands[0])) : ui.pickPiece(p, cands, msg, o));
        return me.prompt(p, collect,
          v => (v == null ? -1 : v.id),
          i => (i === -1 ? null : cands.find(c => c.id === i) ?? cands[0]),
          () => ui.pickPiece(p, cands, msg, o));
      },
      async draftPick(p, opts, forced, info) {
        const collect = () => (me.auto ? priv(async () => AI.pickAug(p, opts, forced)) : ui.draftPick(p, opts, forced, info));
        return me.prompt(p, collect,
          v => opts.indexOf(v),
          i => (goodInt(i) && i >= 0 && i < opts.length ? opts[i] : opts[0]),
          () => ui.draftPick(p, opts, forced, info));
      },
      async waitAction(p) {
        const collect = () => (me.auto ? priv(() => AI.act(p)) : ui.waitAction(p));
        return me.prompt(p, collect, encAct, decAct, () => AI.act(p));
      },
      async alkShot(p, discs) {
        const collect = () => (me.auto ? priv(async () => ALK.shotAI(p, discs)) : ui.alkShot(p, discs));
        return me.prompt(p, collect,
          sh => { const i = discs.indexOf(sh.d); return `${i},${Math.round(sh.vx * 1000)},${Math.round(sh.vy * 1000)}`; },
          s => decShot(s, discs),
          async () => ALK.shotAI(p, discs));
      },
      // 확인창은 기록에 올리지 않는다: 내 화면에서만 잠깐 띄운다
      async alert(title, html, p) {
        if (me.replaying || me.auto || (p && (p.ai || !me.store.isLocal(p.id))) || !me.store.hasLocal()) { await sleep(AI.delay(600)); return; }
        return ui.alert(title, html, p);
      },
      // 기기마다 화면이 따로라서 가림막(핫시트용)은 필요 없다
      cover() { return Promise.resolve(); },
    };
  }
}

/* ----- 차례 행동 ↔ 문자열 ----- */
function encAct(a) {
  if (!a || a.type === 'end') return 'e';
  if (a.type === 'throw') return 't';
  if (a.type === 'move') return `m${a.chip}.${a.piece.id}`;
  if (a.type === 'action') return `a${a.key}`;
  return 'e';
}
function decAct(s) {
  s = String(s);
  if (s === 't') return { type: 'throw' };
  if (s[0] === 'm') {
    const m = /^m(\d+)\.(\d+)$/.exec(s), pc = m && pieceById(+m[2]);
    if (m && pc) return { type: 'move', chip: +m[1], piece: pc };
  }
  if (s[0] === 'a' && s.length > 1) return { type: 'action', key: s.slice(1) };
  return { type: 'end' };
}
function decShot(s, discs) {
  const m = /^(\d+),(-?\d+),(-?\d+)$/.exec(String(s));
  if (m && discs[+m[1]]) return { d: discs[+m[1]], vx: +m[2] / 1000, vy: +m[3] / 1000 };
  return { d: discs[0], vx: 0, vy: 0 };
}
