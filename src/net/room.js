// 온라인 방 프로토콜 코어 (DOM·네트워크 없이 Node 에서도 돌아간다).
//
// 전송 계층이 해 주는 일은 딱 하나: "각 참가자가 자기 상태 객체 하나를 올리면 다른 사람들에게 최신본이 전해진다"(presence).
// Claude 아티팩트의 room.presence, MQTT 의 retained 메시지, 같은 브라우저 탭끼리의 BroadcastChannel 이 모두 이 모양이다.
// 이 코어는 그 위에 다음을 얹는다.
//  - 방 코드로 모으기: 방장이 설정과 명단을 정하고, 참가자는 입장 의사만 올린다. 정원이 차면 거절.
//  - 시드 합의: 모두가 비밀 값의 해시(commit)를 먼저 올리고, 다 모인 뒤에 값(reveal)을 올려 합친다. 방장도 시드를 못 고른다.
//  - 입력 기록 복제: 사람마다 자기 입력 줄(stream)만 쓰고, 다른 사람들은 그것을 받아 모은다. 줄은 "항목 개수"로 확인하며
//    (hv = 내가 각 줄을 몇 개까지 받았는지), 모자라는 사람이 있으면 그 부분을 창(window)으로 다시 올려 준다.
//    상태를 통째로 올리는 방식이라 메시지가 빠지거나 중복되거나 순서가 뒤바뀌어도 다음 갱신에서 저절로 메워진다.
//  - 해시 대조: 차례 경계마다 판 상태의 해시를 올려 서로 맞는지 본다.
//
// 상태 객체 크기는 4 KiB 이하로 유지한다(Claude room 의 presence 한도).
import { sha256 } from './sha256.js';

export const APP = 'aug1';
export const LIVE_MS = 15000;       // 이 시간 동안 소식이 없으면 연결이 끊긴 것으로 본다
export const BEAT_MS = 2000;        // 변화가 없어도 이 간격으로 생존 신호를 올린다
export const MIN_PUB_MS = 120;      // 연속 갱신 최소 간격
export const MAX_STATE_BYTES = 3500;
export const START_TIMEOUT_MS = 30000;
export const FIND_TIMEOUT_MS = 10000;
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 0 O 1 I 제외 32자

/* ----- 받은 값 검사: 모르는 필드는 버리고, 숫자는 범위로 자르고, 문자열은 길이·글자 제한 ----- */
const isObj = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const int = (x, lo, hi, def = null) => (Number.isInteger(x) && x >= lo && x <= hi ? x : def);
const hex = (x, len) => (typeof x === 'string' && x.length === len && /^[0-9a-f]+$/.test(x) ? x : null);
const sidOk = x => (typeof x === 'string' && /^[A-Za-z2-9]{6,12}$/.test(x) ? x : null);
// eslint-disable-next-line no-control-regex
const BAD_CHARS = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁤﻿<>&"'`]/g;
export const cleanText = (x, max = 10) => (typeof x === 'string' ? x.replace(BAD_CHARS, '').trim().slice(0, max) : '');
export const normCode = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/O/g, '').replace(/I/g, '').replace(/[01]/g, '').slice(0, 4);
export const makeCode = randInt => Array.from({ length: 4 }, () => CODE_ALPHABET[randInt(32)]).join('');

function cleanCfg(c) {
  if (!isObj(c)) return null;
  const n = int(c.n, 2, 4), hu = int(c.hu, 1, 4);
  if (n == null || hu == null || hu > n) return null;
  return { n, hu, ch: c.ch ? 1 : 0, df: ['easy', 'normal', 'hard'].includes(c.df) ? c.df : 'normal', ef: c.ef ? 1 : 0 };
}
const cleanSidList = (a, max) => (Array.isArray(a) && a.length <= max ? a.map(sidOk) : null);
export function cleanEntry(e) {
  if (!Array.isArray(e) || e.length !== 3) return null;
  const t = e[0] === 0 || e[0] === 1 ? e[0] : null;
  const a = int(e[1], 0, 100000);
  if (t == null || a == null) return null;
  let b = e[2];
  if (t === 1) b = int(b, 0, 100000);
  else if (typeof b === 'string') b = b.length <= 32 && /^[A-Za-z0-9.,:_+\-]*$/.test(b) ? b : null;
  else b = int(b, -1, 1000000);
  return b == null ? null : [t, a, b];
}
function cleanWindow(w, skipFirst = 0) {
  if (!Array.isArray(w) || w.length < 1 + skipFirst || w.length > 200) return null;
  const from = int(w[skipFirst], 0, 100000);
  if (from == null) return null;
  const list = [];
  for (let i = skipFirst + 1; i < w.length; i++) { const e = cleanEntry(w[i]); if (!e) break; list.push(e); }
  return { from, list };
}
export function cleanState(r) {
  if (!isObj(r) || r.a !== APP) return null;
  const s = sidOk(r.s);
  if (!s) return null;
  const o = { s, n: cleanText(r.n) || '손님', t: int(r.t, 0, 1e9, 0) };
  if (r.cr) {
    o.cr = 1; o.ph = ['L', 'S', 'R', 'P'].includes(r.ph) ? r.ph : 'L'; o.ep = int(r.ep, 0, 1e6, 0);
    o.cf = cleanCfg(r.cf); o.ro = cleanSidList(r.ro, 4);
    if (!o.cf || !o.ro || o.ro.some(x => !x)) return null;
  }
  if (r.j) o.j = 1;
  if (r.lv) o.lv = 1;
  if (Array.isArray(r.cm) && int(r.cm[0], 0, 1e6) != null && hex(r.cm[1], 64)) o.cm = [r.cm[0], r.cm[1]];
  if (Array.isArray(r.rv) && int(r.rv[0], 0, 1e6) != null && hex(r.rv[1], 32)) o.rv = [r.rv[0], r.rv[1]];
  if (isObj(r.g)) {
    const cf = cleanCfg(r.g.cf), ro = cleanSidList(r.g.ro, 4), sd = hex(r.g.sd, 64), ep = int(r.g.ep, 0, 1e6);
    if (cf && ro && ro.every(Boolean) && sd && ep != null && Array.isArray(r.g.nk)) o.g = { sd, cf, ro, ep, nk: r.g.nk.slice(0, 4).map(x => cleanText(x) || '손님') };
  }
  if (Array.isArray(r.hv) && r.hv.length <= 4) o.hv = r.hv.map(x => int(x, 0, 100000, 0));
  const e = cleanWindow(r.e), c = cleanWindow(r.c), rl = cleanWindow(r.rl, 1);
  if (e) o.e = e;
  if (c) o.c = c;
  if (rl && int(r.rl[0], 0, 3) != null) o.rl = { idx: r.rl[0], ...rl };
  if (Array.isArray(r.hs)) o.hs = r.hs.slice(0, 6).filter(x => Array.isArray(x) && int(x[0], 0, 1e6) != null && hex(x[1], 16)).map(x => [x[0], x[1]]);
  return o;
}

export class RoomCore {
  constructor({ sid, nick, now = () => Date.now(), randHex, randInt, publish, onEvent = () => {} }) {
    Object.assign(this, { sid, nick: cleanText(nick) || '손님', now, randHex, randInt, publishFn: publish, onEvent });
    this.phase = 'idle';           // idle | join | lobby | start | play | closed
    this.isHost = false; this.code = ''; this.cfg = null; this.ro = []; this.ep = 0; this.hostPh = 'L';
    this.peers = new Map();        // sid → { st, seenAt, gone }
    this.bind = new Map();         // sid → 전송 계층의 연결 id
    this.streams = [[], [], [], []]; this.ansMap = [new Map(), new Map(), new Map(), new Map()]; this.floorMap = new Map();
    this.game = null;              // { sd, cf, ro, ep, nk }
    this.myIdx = -1; this.subs = new Set();
    this.hashes = []; this.desync = new Set();
    this.t = 0; this.lastKey = ''; this.lastPubAt = 0; this.dirty = true; this.leaving = false;
    this.startedAt = 0; this.joinedAt = 0; this.rejected = null; this.myEp = -1; this.secret = ''; this.commit = '';
    this.hostSeenAt = 0; this.error = null; this.notified = ''; this.revealOut = false; this.repub = []; this.genAt = 0; this.syncing = false; this.syncSince = 0; this.started = false;
  }

  /* ===== 방 열기 / 들어가기 / 나가기 ===== */
  create(code, cfg) {
    this.code = code; this.isHost = true; this.phase = 'lobby'; this.cfg = cfg; this.ro = [this.sid]; this.hostPh = 'L'; this.ep = 0;
    this.dirty = true; this.emitLobby();
  }
  join(code) {
    this.code = code; this.isHost = false; this.phase = 'join'; this.joinedAt = this.now(); this.dirty = true; this.emitLobby();
  }
  // 새로고침·복귀: 저장해 둔 판 정보로 바로 진행 상태로
  restore(snap) {
    this.code = snap.code; this.isHost = false; this.phase = 'play';
    this.game = { sd: snap.sd, cf: snap.cf, ro: snap.ro, ep: snap.ep, nk: snap.nk };
    this.ro = snap.ro.slice(); this.cfg = snap.cf; this.myIdx = this.ro.indexOf(this.sid);
    snap.streams.forEach((s, i) => { this.streams[i] = s.map(e => e.slice()); this.rebuildIndex(i); });
    this.dirty = true; this.genAt = this.now() - 60000;
    this.announceStart();
  }
  snapshot() {
    if (!this.game) return null;
    return { code: this.code, sid: this.sid, ...this.game, streams: this.streams.slice(0, this.game.ro.length).map(s => s.map(e => e.slice())) };
  }
  leave() {
    this.leaving = true; this.flush(true);
    this.phase = 'closed';
  }
  kick(sid) { if (this.isHost && this.phase === 'lobby' && sid !== this.sid) { this.ro = this.ro.filter(x => x !== sid); this.dirty = true; this.emitLobby(); } }

  /* ===== 시작(시드 합의) ===== */
  start() {
    if (!this.isHost || this.phase !== 'lobby') return false;
    this.ep++; this.phase = 'start'; this.hostPh = 'S'; this.startedAt = this.now(); this.dirty = true; this.emitLobby();
    return true;
  }

  /* ===== 받기 ===== */
  // list: [{ id, state }] — 다른 참가자들의 최신 상태 전부(전송 계층이 건네줌)
  receive(list) {
    const now = this.now(), seen = new Set();
    for (const it of list) {
      const st = cleanState(it && it.state);
      if (!st || st.s === this.sid) continue;
      // 같은 sid 를 두 곳에서 쓰면 먼저 자리 잡은 쪽만 인정한다(남의 sid 를 흉내 내는 것을 막고, 다시 들어온 쪽은 이전 연결이 사라지면 이어받는다)
      const bound = this.bind.get(st.s);
      if (bound && bound !== it.id && list.some(x => x.id === bound)) continue;
      this.bind.set(st.s, it.id);
      seen.add(st.s);
      const p = this.peers.get(st.s);
      if (!p) this.peers.set(st.s, { st, seenAt: now, gone: false });
      else {
        if (st.t < p.st.t && p.st.t - st.t < 30) { p.gone = false; continue; }   // 늦게 도착한 오래된 상태는 무시 (재시작하면 t 가 크게 줄어드니 그건 받는다)
        if (p.st.t !== st.t || p.gone) p.seenAt = now;
        p.st = st; p.gone = false;
      }
    }
    for (const [sid, p] of this.peers) if (!seen.has(sid)) p.gone = true;
    this.process();
  }
  isLive(sid) {
    if (sid === this.sid) return true;
    const p = this.peers.get(sid);
    return !!p && !p.gone && this.now() - p.seenAt < LIVE_MS && !p.st.lv;
  }
  nickOf(sid) { return sid === this.sid ? this.nick : (this.peers.get(sid)?.st.n || '손님'); }

  process() {
    if (this.phase === 'closed' || this.phase === 'idle') return;
    if (this.phase === 'join') this.processJoin();
    if (this.phase === 'lobby' && this.isHost) this.processHostLobby();
    if (this.phase === 'lobby' && !this.isHost) this.processGuestLobby();
    if (this.phase === 'start') this.processStart();
    if (this.phase === 'play') this.processPlay();
  }

  hostPeer() {
    // 방장 = 'cr' 표시를 단 참가자. 둘 이상이면 먼저 본 쪽
    let best = null;
    for (const p of this.peers.values()) if (p.st.cr && !p.gone && (!best || p.seenAt < best.seenAt)) best = p;
    return best;
  }
  processJoin() {
    const now = this.now();
    // 이미 진행 중인 판에서 내 자리를 되찾는 경우: 남들이 올린 g 중 가장 많은 쪽을 믿는다
    const gs = new Map();
    for (const p of this.peers.values()) if (p.st.g && !p.gone) { const k = JSON.stringify(p.st.g); gs.set(k, (gs.get(k) || 0) + 1); }
    if (gs.size) {
      const [k] = [...gs.entries()].sort((a, b) => b[1] - a[1])[0];
      const g = JSON.parse(k);
      if (g.ro.includes(this.sid)) { this.adoptGame(g); return; }
      this.reject('started'); return;
    }
    const h = this.hostPeer();
    if (!h) {
      if (now - this.joinedAt > FIND_TIMEOUT_MS) this.fail('nohost');
      return;
    }
    this.hostSeenAt = now;
    this.applyHost(h.st);
    if (h.st.ph !== 'L') { if (!h.st.ro.includes(this.sid)) this.reject('started'); return; }
    if (h.st.ro.includes(this.sid)) { this.phase = 'lobby'; this.rejected = null; this.emitLobby(); return; }
    if (h.st.ro.length >= h.st.cf.hu && now - this.joinedAt > 1500) this.reject('full');
    this.emitLobby();
  }
  applyHost(st) { this.cfg = st.cf; this.ro = st.ro.slice(); this.hostPh = st.ph; this.ep = st.ep; }
  processGuestLobby() {
    const h = this.hostPeer();
    if (!h || !this.isLive(h.st.s)) {
      if (this.now() - (h ? h.seenAt : this.hostSeenAt) > LIVE_MS || (h && h.st.lv)) this.fail('hostlost');
      return;
    }
    this.hostSeenAt = this.now();
    this.applyHost(h.st);
    if (!this.ro.includes(this.sid)) {
      if (!this.absentSince) this.absentSince = this.now();
      else if (this.now() - this.absentSince > 6000) this.reject('kicked');
      return;
    }
    this.absentSince = 0;
    if (h.st.ph === 'S' || h.st.ph === 'R') { this.phase = 'start'; this.startedAt = this.now(); }
    else if (h.st.ph === 'P' && h.st.g) this.adoptGame(h.st.g);
    else this.emitLobby();
  }
  processHostLobby() {
    let changed = false;
    // 입장 의사를 올린 사람을 정원 안에서 받는다
    for (const p of this.peers.values()) {
      const s = p.st;
      if (s.cr) { this.fail('collision'); return; }
      if (s.j && !s.lv && !this.ro.includes(s.s) && this.ro.length < this.cfg.hu && !p.gone) { this.ro.push(s.s); changed = true; }
    }
    // 나갔거나 오래 소식이 없는 사람은 명단에서 뺀다
    const keep = this.ro.filter(x => x === this.sid || this.isLive(x));
    if (keep.length !== this.ro.length) { this.ro = keep; changed = true; }
    if (changed) { this.dirty = true; this.emitLobby(); }
    else this.emitLobby();
  }
  processStart() {
    const now = this.now();
    const host = this.isHost ? null : this.hostPeer();
    const ph = this.isHost ? this.hostPh : (host ? host.st.ph : 'L');
    const ep = this.isHost ? this.ep : (host ? host.st.ep : this.ep);
    if (!this.isHost) {
      if (!host) { if (now - this.hostSeenAt > LIVE_MS) this.fail('hostlost'); return; }
      this.hostSeenAt = now; this.applyHost(host.st);
      if (ph === 'L') { this.phase = 'lobby'; this.myEp = -1; this.emitLobby(); return; }
    }
    const roster = this.ro;
    if (!roster.includes(this.sid)) return;
    // 1) 내 commit 올리기
    if (this.myEp !== ep) {
      this.secret = this.randHex(16); this.myEp = ep;
      this.commit = sha256(`${this.code}|${ep}|${this.sid}|${this.secret}`); this.dirty = true;
    }
    const cmOf = sid => (sid === this.sid ? [this.myEp, this.commit] : this.peers.get(sid)?.st.cm);
    const rvOf = sid => (sid === this.sid ? (this.revealOut ? [this.myEp, this.secret] : null) : this.peers.get(sid)?.st.rv);
    const allCm = roster.every(s => { const c = cmOf(s); return c && c[0] === ep; });
    // 2) 방장: commit 이 다 모이면 reveal 단계로
    if (this.isHost && this.hostPh === 'S' && allCm) { this.hostPh = 'R'; this.dirty = true; }
    // 3) 참가자: reveal 단계에서 값 공개
    if (ph === 'R' && !this.revealOut && allCm) { this.revealOut = true; this.dirty = true; }
    // 4) 모두 공개되면 시드 계산
    const allRv = roster.every(s => { const r = rvOf(s); return r && r[0] === ep; });
    if (allRv && allCm) {
      const secrets = [];
      for (const s of roster) {
        const c = cmOf(s), r = rvOf(s);
        if (sha256(`${this.code}|${ep}|${s}|${r[1]}`) !== c[1]) { this.fail('badreveal'); return; }
        secrets.push(r[1]);
      }
      const cf = this.cfg;
      const sd = sha256(`${APP}|${this.code}|${ep}|${JSON.stringify(cf)}|${roster.join(',')}|${secrets.join(',')}`);
      const nk = roster.map(s => this.nickOf(s));
      if (host && host.st.g && host.st.g.sd !== sd) { this.fail('seedmismatch'); return; }
      this.adoptGame({ sd, cf, ro: roster.slice(), ep, nk }, false);
      return;
    }
    if (!this.isHost && ph === 'P' && host.st.g) { this.adoptGame(host.st.g, false); return; } // 공개 값을 놓쳤으면 방장이 알려 준 값을 따른다
    if (this.isHost && now - this.startedAt > START_TIMEOUT_MS) { this.phase = 'lobby'; this.hostPh = 'L'; this.revealOut = false; this.myEp = -1; this.dirty = true; this.fail('startfail', true); }
    this.emitLobby();
  }
  // rejoin=true: 이미 진행 중인 판에 다시 들어온 경우 → 내 입력 기록을 되찾은 뒤에 시작 알림
  adoptGame(g, rejoin = true) {
    this.game = g; this.cfg = g.cf; this.ro = g.ro.slice(); this.ep = g.ep; this.myIdx = this.ro.indexOf(this.sid);
    this.phase = 'play'; this.hostPh = 'P'; this.dirty = true; this.genAt = this.now();
    if (rejoin) { this.syncing = true; this.syncSince = this.now(); }
    else this.announceStart();
  }
  announceStart() {
    if (this.started) return;
    this.started = true; this.syncing = false;
    this.onEvent('start', { ...this.game, code: this.code, myIdx: this.myIdx });
  }
  processPlay() {
    // 내 줄의 개수와 남들이 올린 창을 합친다
    let added = false, rewrote = false;
    for (const p of this.peers.values()) {
      const idx = this.ro.indexOf(p.st.s);
      if (idx >= 0) {
        for (const w of [p.st.e, p.st.c]) if (w) { const r = this.merge(idx, w, false); added ||= r.added; rewrote ||= r.rewrote; }
      }
      if (p.st.rl && p.st.rl.idx < this.ro.length) {
        const r = this.merge(p.st.rl.idx, p.st.rl, true); added ||= r.added;
      }
      // 해시 대조
      if (p.st.hs) for (const [k, h] of p.st.hs) {
        const mine = this.hashes.find(x => x[0] === k);
        if (mine && mine[1] !== h && !this.desync.has(k + ':' + p.st.s)) { this.desync.add(k + ':' + p.st.s); this.onEvent('desync', { k, peer: p.st.s, nick: p.st.n }); }
      }
    }
    if (this.syncing) {
      const ahead = Math.max(0, ...[...this.peers.values()].map(p => p.st.hv?.[this.myIdx] ?? 0));
      if (this.streams[this.myIdx].length >= ahead && (this.peers.size || this.now() - this.syncSince > 5000) || this.now() - this.syncSince > 8000) this.announceStart();
    }
    if (rewrote) this.onEvent('rewrite', null);
    if (added || rewrote) { this.dirty = true; this.notify(); }
  }

  /* ===== 입력 줄 ===== */
  merge(idx, w, relay) {
    const stream = this.streams[idx], out = { added: false, rewrote: false };
    if (idx === this.myIdx && !relay) return out;              // 내 줄은 내가 쓴다 (기록을 잃었을 때만 남이 전해 준 것으로 복구)
    if (w.from > stream.length) return out;                    // 사이가 비었음 — 앞 창을 기다린다
    for (let j = 0; j < w.list.length; j++) {
      const pos = w.from + j, e = w.list[j];
      if (pos < stream.length) {
        const old = stream[pos];
        if (old[0] === e[0] && old[1] === e[1] && old[2] === e[2]) continue;
        if (relay) continue;                                   // 대신 전해 준 값은 본인 값을 덮지 못한다
        stream.length = pos; stream.push(e.slice()); out.rewrote = true; out.added = true;
        for (let q = j + 1; q < w.list.length; q++) stream.push(w.list[q].slice());
        this.rebuildIndex(idx); return out;
      }
      stream.push(e.slice()); this.indexEntry(idx, e); out.added = true;
    }
    return out;
  }
  indexEntry(idx, e) {
    if (e[0] === 0 && !this.ansMap[idx].has(e[1])) this.ansMap[idx].set(e[1], e[2]);
    else if (e[0] === 1) { const f = this.floorMap.get(e[1]); if (f === undefined || e[2] < f) this.floorMap.set(e[1], e[2]); }
  }
  rebuildIndex(idx) {
    this.ansMap[idx] = new Map();
    this.floorMap = new Map();
    this.streams.forEach((s, i) => { if (i !== idx) { s.forEach(e => { if (e[0] === 1) { const f = this.floorMap.get(e[1]); if (f === undefined || e[2] < f) this.floorMap.set(e[1], e[2]); } }); } });
    for (const e of this.streams[idx]) this.indexEntry(idx, e);
  }
  notify() { for (const f of [...this.subs]) f(); }

  // Bridge 가 쓰는 입력 기록 저장소 모양
  get store() {
    const me = this;
    return {
      localSeat: () => me.myIdx,
      isLocal: s => s === me.myIdx,
      hasLocal: () => me.myIdx >= 0,
      hasEntries: () => me.streams.some(s => s.length),
      answerFor: (seat, k) => me.ansMap[seat]?.get(k),
      aiFloor: seat => me.floorMap.get(seat) ?? Infinity,
      propose: (type, a, b) => {
        if (me.myIdx < 0) return;
        const e = [type, a, b];
        me.streams[me.myIdx].push(e); me.indexEntry(me.myIdx, e); me.dirty = true; me.flush(); me.notify();
      },
      subscribe: f => { me.subs.add(f); return () => me.subs.delete(f); },
      reportHash: (k, h) => {
        const hh = h.slice(0, 16);
        if (!me.hashes.some(x => x[0] === k)) { me.hashes.push([k, hh]); if (me.hashes.length > 6) me.hashes.shift(); me.dirty = true; }
      },
      isLive: seat => me.isLive(me.ro[seat]),
      nick: seat => me.nickOf(me.ro[seat]),
    };
  }

  /* ===== 올리기 ===== */
  buildState() {
    const st = { a: APP, s: this.sid, n: this.nick, t: this.t };
    if (this.isHost) { st.cr = 1; st.ph = this.hostPh; st.ep = this.ep; st.cf = this.cfg; st.ro = this.ro; }
    if (this.phase === 'join') st.j = 1;
    if (this.phase === 'lobby' && !this.isHost) st.j = 1;
    if (this.leaving) st.lv = 1;
    if (this.phase === 'start' || (this.phase === 'play' && this.now() - this.genAt < 10000 && this.commit)) {
      if (this.myEp >= 0) st.cm = [this.myEp, this.commit];
      if (this.revealOut) st.rv = [this.myEp, this.secret];
      if (this.phase === 'start') st.j = 1;
    }
    if (this.phase === 'play' && this.game) {
      st.g = this.game;
      st.hv = this.ro.map((_, i) => this.streams[i].length);
      st.hs = this.hashes.slice(-3);
      this.addWindows(st);
    }
    return st;
  }
  have(sid, idx) { return this.peers.get(sid)?.st.hv?.[idx] ?? 0; }
  addWindows(st) {
    const size = o => JSON.stringify(o).length;
    let budget = MAX_STATE_BYTES - size(st) - 40;
    const take = (stream, from, cap) => {
      const w = [from]; let used = 8;
      for (let i = from; i < stream.length; i++) { const n = JSON.stringify(stream[i]).length + 1; if (used + n > cap) break; w.push(stream[i]); used += n; }
      return w;
    };
    // 내 줄: 최근 몇 개(tail)는 항상, 누군가 더 앞에서 모자라면 그 부분(catch-up)도 함께
    if (this.myIdx >= 0) {
      const mine = this.streams[this.myIdx];
      const others = this.ro.filter(s => s !== this.sid && this.isLive(s));
      const need = others.length ? Math.min(...others.map(s => this.have(s, this.myIdx))) : mine.length;
      if (need < mine.length) {
        const tailFrom = Math.max(0, mine.length - 10);
        const tail = take(mine, tailFrom, Math.floor(budget * 0.45));
        st.e = tail; budget -= size(tail);
        if (need < tailFrom) st.c = take(mine, need, Math.max(200, Math.floor(budget * 0.7)));
        budget -= st.c ? size(st.c) : 0;
      }
    }
    // 끊긴 사람의 줄을 내가 대신 전해 준다(그 사람 것을 못 받은 사람이 있을 때만)
    for (let i = 0; i < this.ro.length; i++) {
      const sid = this.ro[i];
      if (sid === this.sid || !this.streams[i].length) continue;
      // 그 사람이 끊겼거나, 접속은 했는데 자기 기록을 잃어버렸을 때(자기 줄 개수가 내가 가진 것보다 적을 때)
      const lost = !this.isLive(sid) || this.have(sid, i) < this.streams[i].length;
      if (!lost) continue;
      const lives = this.ro.filter(s => s !== sid && this.isLive(s));
      const need = Math.min(...lives.map(s => (s === this.sid ? this.streams[i].length : this.have(s, i))), this.isLive(sid) ? this.have(sid, i) : Infinity);
      if (need < this.streams[i].length) { st.rl = [i, ...take(this.streams[i], need, Math.max(200, budget - 20))]; break; }
    }
  }
  // 바뀐 것이 있으면(또는 생존 신호 시간이 되면) 올린다
  flush(force = false) {
    const now = this.now();
    const st = this.buildState();
    const key = JSON.stringify({ ...st, t: 0 });
    const changed = key !== this.lastKey;
    const again = this.repub.length && now >= this.repub[0];   // 바뀐 직후 두 번 더 올려서 메시지가 빠져도 곧 메워지게
    if (!force && !changed && !again && now - this.lastPubAt < BEAT_MS) return false;
    if (!force && changed && now - this.lastPubAt < MIN_PUB_MS) return false;
    if (again) this.repub.shift();
    if (changed) this.repub = [now + 400, now + 1200];
    this.t++; st.t = this.t; this.lastKey = key; this.lastPubAt = now; this.dirty = false;
    this.publishFn(st);
    return true;
  }
  tick() {
    this.process();
    this.flush();
  }

  /* ===== 화면용 ===== */
  emitLobby() {
    const v = this.view(), key = JSON.stringify(v);
    if (key !== this.notified) { this.notified = key; this.onEvent('lobby', v); }
  }
  fail(code, soft = false) {
    this.error = code; if (!soft) this.phase = 'closed';
    this.onEvent('error', { code });
  }
  reject(code) { this.rejected = code; this.phase = 'closed'; this.onEvent('error', { code }); }
  view() {
    return {
      phase: this.phase, code: this.code, isHost: this.isHost, cfg: this.cfg, hostPh: this.hostPh,
      members: this.ro.map((sid, i) => ({ sid, seat: i, nick: this.nickOf(sid), me: sid === this.sid, live: this.isLive(sid), host: i === 0 })),
      joined: this.ro.includes(this.sid), error: this.error,
    };
  }
}
