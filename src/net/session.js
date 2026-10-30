// 온라인 대전 한 판의 생명주기: 전송 계층 연결 → 방 프로토콜(RoomCore) → 게임 연결(Bridge).
// 화면(DOM)은 모르고, 화면 쪽은 on 콜백으로 소식을 받는다.
import { Bridge } from './bridge.js';
import { RoomCore, makeCode, normCode, cleanText } from './room.js';
import { chooseTransport } from './transports.js';

export const SAVE_KEY = 'augyut-online-v1', NICK_KEY = 'augyut-nick', SID_KEY = 'augyut-sid';
const SID_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';

export const ERROR_TEXT = {
  nohost: '방을 찾지 못했어요. 코드를 다시 확인해 주세요.',
  full: '이미 자리가 다 찬 방이에요.',
  started: '이미 시작한 방이에요.',
  kicked: '방장이 방에서 내보냈어요.',
  hostlost: '방장과 연결이 끊겼어요.',
  collision: '같은 코드의 방이 이미 있어요. 다시 만들어 주세요.',
  startfail: '시작하지 못했어요. 모두 연결되어 있는지 확인하고 다시 눌러 주세요.',
  badreveal: '시작 값이 맞지 않아 중단했어요. 다시 시작해 주세요.',
  seedmismatch: '시작 값이 맞지 않아 중단했어요. 다시 시작해 주세요.',
  noroom: '온라인 대전은 로그인한 상태에서만 쓸 수 있어요.',
  joinfail: '방에 들어가지 못했어요. 잠시 뒤에 다시 시도해 주세요.',
  offline: '인터넷에 연결되지 않았어요.',
};

export function defaultEnv() {
  const safe = st => ({ get: k => { try { return st.getItem(k); } catch (e) { return null; } }, set: (k, v) => { try { st.setItem(k, v); } catch (e) { /* 저장 불가 */ } }, del: k => { try { st.removeItem(k); } catch (e) { /* 무시 */ } } });
  return { local: safe(globalThis.localStorage), session: safe(globalThis.sessionStorage), hash: () => globalThis.location ? globalThis.location.hash : '', win: globalThis };
}
function randBytesHex(n) {
  const a = new Uint8Array(n);
  if (globalThis.crypto && globalThis.crypto.getRandomValues) globalThis.crypto.getRandomValues(a); else for (let i = 0; i < n; i++) a[i] = Math.floor(Math.random() * 256);
  return Array.from(a, b => b.toString(16).padStart(2, '0')).join('');
}
const randInt = n => { const a = new Uint32Array(1); if (globalThis.crypto && globalThis.crypto.getRandomValues) { globalThis.crypto.getRandomValues(a); return a[0] % n; } return Math.floor(Math.random() * n); };

export class Session {
  // ui/r/sfx/animateMove: 화면 어댑터(Bridge 에 그대로 전달)   on: 화면 쪽 콜백   env: 저장소·주소·창(테스트에서 바꿔 끼움)
  constructor({ ui, r, sfx, animateMove, on = {}, env = defaultEnv(), auto = false, alwaysInstant = false, makeTransport = null, autoTakeoverMs = 0, sidOverride = null, peerGraceMs = 15000 }) {
    Object.assign(this, { ui, r, sfx, animateMove, on, env, auto, alwaysInstant, makeTransport, autoTakeoverMs });
    this.core = null; this.tx = null; this.bridge = null; this.timer = null; this.gate = null; this.status = { connected: 0, total: 0 };
    this.lastSaveKey = ''; this.lastSaveAt = 0; this.lastRefresh = 0; this.waitingSince = 0; this.pendSince = new Map(); this.timeoutSent = new Set(); this.peerGraceMs = peerGraceMs; this.over = false; this.sidOverride = sidOverride;
  }
  get sid() {
    if (this.sidOverride) return this.sidOverride;
    let s = this.env.session.get(SID_KEY);
    if (!s || !/^[A-Za-z2-9]{8}$/.test(s)) {
      s = Array.from({ length: 8 }, () => SID_ALPHABET[randInt(SID_ALPHABET.length)]).join('');
      this.env.session.set(SID_KEY, s);
    }
    return s;
  }
  get nick() { return cleanText(this.env.local.get(NICK_KEY) || '') || '손님'; }
  set nick(v) { this.env.local.set(NICK_KEY, cleanText(v) || '손님'); }
  get code() { return this.core ? this.core.code : ''; }
  get active() { return !!this.core && this.core.phase !== 'closed'; }
  emit(type, data) { try { if (this.on[type]) this.on[type](data); } catch (e) { console.error(e); } }

  /* ----- 저장된 판 ----- */
  // 시험 모드(#local)에서는 한 브라우저에 여러 참가자가 있으므로 저장 칸을 참가자별로 나눈다
  saveKey() { return /#local/.test(this.env.hash()) ? `${SAVE_KEY}-${this.sid}` : SAVE_KEY; }
  savedGame() {
    try { const s = JSON.parse(this.env.local.get(this.saveKey()) || 'null'); return s && s.code && s.sid && Array.isArray(s.streams) && s.ro && s.cf && s.sd ? s : null; } catch (e) { return null; }
  }
  clearSaved() { this.env.local.del(this.saveKey()); this.lastSaveKey = ''; }
  saveNow(force = false) {
    if (!this.core || this.core.phase !== 'play' || this.over) return;
    const snap = this.core.snapshot();
    if (!snap) return;
    const key = snap.streams.map(s => s.length).join(',');
    if (!force && key === this.lastSaveKey) return;
    this.lastSaveKey = key; this.lastSaveAt = Date.now();
    this.env.local.set(this.saveKey(), JSON.stringify(snap));
  }

  /* ----- 연결 ----- */
  async connect(code) {
    this.teardown(false);
    this.over = false;
    const sid = this.sid;
    this.tx = this.makeTransport ? this.makeTransport({ code, sid }) : chooseTransport({ code, sid, hash: this.env.hash(), win: this.env.win });
    this.core = new RoomCore({ sid, nick: this.nick, randHex: randBytesHex, randInt, publish: st => { if (this.tx) this.tx.set(st); }, onEvent: (t, d) => this.onCore(t, d) });
    try {
      await this.tx.open({ onPeers: list => { if (this.core) this.core.receive(list); }, onStatus: s => { this.status = s; this.emit('status', s); } });
    } catch (e) {
      const c = e && e.code ? e.code : 'offline';
      this.teardown(true);
      this.emit('error', { code: c });
      return false;
    }
    this.timer = setInterval(() => this.tick(), 250);
    return true;
  }
  async create(cfg) {
    const code = makeCode(randInt);
    if (!(await this.connect(code))) return null;
    this.core.create(code, cfg);
    this.core.tick();
    return code;
  }
  async join(codeText) {
    const code = normCode(codeText);
    if (code.length !== 4) { this.emit('error', { code: 'nohost' }); return false; }
    if (!(await this.connect(code))) return false;
    this.core.join(code);
    this.core.tick();
    return true;
  }
  async resume() {
    const snap = this.savedGame();
    if (!snap) return false;
    if (!/#local/.test(this.env.hash())) this.sidOverride = snap.sid;
    if (!(await this.connect(snap.code))) return false;
    this.core.restore(snap);
    return true;
  }
  // 앱이 다시 화면에 나왔을 때: 연결을 확인하고 내 상태를 다시 올린다
  wake() { if (this.tx && this.tx.wake) this.tx.wake(); if (this.core) this.core.flush(true); }
  start() { return this.core ? this.core.start() : false; }
  kick(sid) { if (this.core) this.core.kick(sid); }

  /* ----- 주기 작업 ----- */
  tick() {
    if (!this.core) return;
    this.core.tick();
    if (!this.core) return;          // tick 도중 오류로 연결이 정리됐을 수 있다
    const now = Date.now();
    if (this.core.phase === 'play') {
      if (now - this.lastSaveAt > 1500) this.saveNow();
      const b = this.bridge;
      if (b && b.running && b.remotes.size) {
        if (!this.waitingSince) this.waitingSince = now;
        if (now - this.lastRefresh > 1000) { this.lastRefresh = now; b.ui.refresh(); }
        for (const pd of b.pendings.values()) {
          if (this.core.store.isLocal(pd.seat)) continue;
          const since = this.pendSince.get(pd.k) || (this.pendSince.set(pd.k, now), now);
          if (this.autoTakeoverMs && !this.core.isLive(this.core.ro[pd.seat]) && now - since > this.autoTakeoverMs) { this.takeover(pd.seat); this.pendSince.set(pd.k, now); }
          // 상대 기기가 제한 시간을 알리지 못하면(앱이 멈춘 경우 등) 여유 시간이 지난 뒤 다른 사람이 대신 알린다
          const tl = (this.core.cfg && this.core.cfg.tl) || 0;
          if (tl && !this.timeoutSent.has(pd.k) && now - since > ((pd.kind === 'draft' ? Math.max(tl, 45) : tl) * 1000) + this.peerGraceMs && this.isTimeoutReporter(pd.seat)) { this.timeoutSent.add(pd.k); this.core.store.propose(2, pd.k, 0); }
        }
      } else { this.waitingSince = 0; if (!b || !b.remotes.size) this.pendSince.clear(); }
    }
  }
  isLive(seat) { return !!this.core && this.core.isLive(this.core.ro[seat]); }
  // 대신 알리는 역할: 그 자리 주인을 뺀 살아 있는 사람 중 가장 앞 좌석 하나(여러 명이 중복해서 올리지 않도록)
  isTimeoutReporter(seat) {
    const core = this.core;
    for (let i = 0; i < core.ro.length; i++) if (i !== seat && core.isLive(core.ro[i])) return i === core.myIdx;
    return false;
  }
  takeover(seat) {
    if (!this.core || !this.bridge) return;
    const pd = this.bridge.pendingFor(seat);
    const k = pd ? pd.k : this.bridge.k;
    this.core.store.propose(1, seat, k);
  }

  /* ----- 방 프로토콜 소식 ----- */
  onCore(type, data) {
    if (type === 'lobby') this.emit('lobby', data);
    else if (type === 'error') {
      if (data.code === 'startfail') { this.emit('error', data); return; }
      this.emit('error', data);
      if (this.core && this.core.phase === 'closed') this.teardown(true);
    } else if (type === 'start') this.launch(data);
    else if (type === 'desync') this.emit('desync', data);
    else if (type === 'rewrite') { if (this.bridge) this.bridge.rebuild(); }
  }
  launch(info) {
    if (this.bridge) this.bridge.stop();
    this.bridge = new Bridge({
      store: this.core.store, ui: this.ui, r: this.r, sfx: this.sfx, animateMove: this.animateMove, auto: this.auto, alwaysInstant: this.alwaysInstant, gate: (k, seat) => (this.gate ? this.gate(k, seat) : undefined),
      onEvent: (t, d) => this.onBridge(t, d),
    });
    this.saveNow(true);
    this.emit('start', info);
    this.bridge.run({ cf: info.cf, ro: info.ro, nicks: info.nk, sd: info.sd });
  }
  onBridge(type, data) {
    if (type === 'over') { this.over = true; this.clearSaved(); this.emit('over', null); }
    else if (type === 'rebuild') this.emit('rebuild', null);
    else if (type === 'error') this.emit('error', { code: 'engine', error: data });
  }

  /* ----- 나가기 ----- */
  // 판 도중에 나가면 내 자리는 AI 가 이어 두도록 명령을 남기고, 다른 참가자에게 내 입력이 모두 전해진 뒤에 닫는다
  async leave() {
    const core = this.core;
    if (core && core.phase === 'play' && this.bridge && this.bridge.running && core.myIdx >= 0 && !this.over) {
      this.takeover(core.myIdx);
      core.flush(true);
      const t0 = Date.now();
      while (Date.now() - t0 < 3000) {
        const mine = core.streams[core.myIdx].length;
        if (core.ro.every((sid, i) => i === core.myIdx || !core.isLive(sid) || core.have(sid, core.myIdx) >= mine)) break;
        await new Promise(r => setTimeout(r, 100));
      }
    }
    this.clearSaved();
    this.teardown(true);
  }
  teardown(clearSave) {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    if (this.bridge) { this.bridge.stop(); this.bridge = null; }
    if (this.core) { try { if (this.core.phase !== 'closed') this.core.leave(); } catch (e) { /* 무시 */ } }
    if (this.tx) { try { this.tx.close(); } catch (e) { /* 무시 */ } }
    this.core = null; this.tx = null; this.waitingSince = 0;
    if (clearSave) this.status = { connected: 0, total: 0 };
  }
}
