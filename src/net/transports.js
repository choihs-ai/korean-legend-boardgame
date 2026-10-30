// 전송 계층: 어디서 돌든 같은 모양으로 "내 상태 올리기 / 남들 상태 받기"만 한다.
//   open({ onPeers(list), onStatus(info) }) → Promise,  set(state),  close()
//   list = [{ id, state }]  (나를 뺀 모든 참가자의 최신 상태)
import { MqttConn } from './mqtt.js';

export const BROKERS = ['wss://broker.emqx.io:8084/mqtt', 'wss://broker.hivemq.com:8884/mqtt', 'wss://test.mosquitto.org:8081'];

/* ===== 같은 브라우저의 탭끼리 (테스트·개발용, 주소 끝 #local) ===== */
export class LocalTransport {
  constructor({ code, sid, BC = globalThis.BroadcastChannel }) { Object.assign(this, { code, sid, BC }); this.peers = new Map(); this.mine = null; this.name = 'local'; }
  async open(h) {
    this.h = h; this.ch = new this.BC(`augyut-aug1-${this.code}`);
    this.ch.onmessage = ev => {
      const m = ev.data;
      if (!m || m.from === this.sid || typeof m.from !== 'string') return;
      if (m.bye) this.peers.delete(m.from);
      else if (m.hello) { if (this.mine) this.post({ from: this.sid, state: this.mine }); return; }
      else if (m.state && m.state.s === m.from) this.peers.set(m.from, m.state);
      this.emit();
    };
    this.post({ from: this.sid, hello: 1 });
    h.onStatus({ connected: 1, total: 1 });
  }
  post(m) { try { this.ch.postMessage(m); } catch (e) { /* 무시 */ } }
  emit() { this.h.onPeers([...this.peers.entries()].map(([id, state]) => ({ id, state }))); }
  set(state) { this.mine = JSON.parse(JSON.stringify(state)); this.post({ from: this.sid, state: this.mine }); }
  close() { this.post({ from: this.sid, bye: 1 }); try { this.ch.close(); } catch (e) { /* 무시 */ } }
}

/* ===== Claude 아티팩트의 room 기능 ===== */
export class ClaudeRoomTransport {
  constructor({ claude, code }) { Object.assign(this, { claude, code }); this.name = 'room'; this.sent = new Set(); this.unsubs = []; }
  async open(h) {
    const room = await this.claude.use('room');
    if (!room) throw Object.assign(new Error('room 사용 불가'), { code: 'noroom' });
    let r;
    try { r = await room.join(`aug1-${this.code.toLowerCase()}`); }
    catch (e) { throw Object.assign(new Error('방 입장 실패'), { code: e && e.code === 'not_permitted' ? 'noroom' : 'joinfail' }); }
    this.r = r;
    const push = change => {
      const list = (change ? change.peers : r.peers()).filter(p => !p.sameTab && p.presence && Object.keys(p.presence).length).map(p => ({ id: p.peer, state: p.presence }));
      h.onPeers(list);
    };
    this.unsubs.push(r.onPeers(push, e => h.onStatus({ connected: 0, total: 1, error: e && e.code })));
    this.unsubs.push(r.onConnection(c => h.onStatus({ connected: c ? 1 : 0, total: 1 })));
    h.onStatus({ connected: r.connected() ? 1 : 0, total: 1 });
  }
  // presence 는 필드별로 합쳐지므로, 이번에 없는 필드는 null 로 지운다
  set(state) {
    const patch = { ...state };
    for (const k of this.sent) if (!(k in patch)) patch[k] = null;
    this.sent = new Set(Object.keys(state));
    this.r.presence(patch).catch(() => {});
  }
  close() { for (const u of this.unsubs) { try { u(); } catch (e) { /* 무시 */ } } if (this.r) this.r.leave().catch(() => {}); }
}

/* ===== 공개 MQTT 브로커 여러 곳에 동시에 붙어 우편함처럼 쓴다 ===== */
export class MqttTransport {
  constructor({ code, sid, brokers = BROKERS, WS = globalThis.WebSocket }) {
    Object.assign(this, { code, sid, brokers, WS }); this.name = 'mqtt'; this.peers = new Map(); this.conns = []; this.pending = false;
    this.prefix = `augyut/aug1/${code}/p/`;
  }
  async open(h) {
    this.h = h;
    const topic = this.prefix + this.sid;
    let first;
    const firstUp = new Promise((res, rej) => { first = { res, rej }; });
    this.conns = this.brokers.map((url, i) => new MqttConn({
      url, clientId: `augyut-${this.sid}-${Math.random().toString(36).slice(2, 6)}`, willTopic: topic, filters: [this.prefix + '+'], WS: this.WS,
      onMessage: (t, payload) => this.onMsg(t, payload),
      onStatus: () => { const n = this.conns.filter(c => c.ready).length; h.onStatus({ connected: n, total: this.conns.length }); if (n) first.res(); },
    }));
    this.conns.forEach(c => c.start());
    const timer = setTimeout(() => first.rej(Object.assign(new Error('브로커에 연결하지 못함'), { code: 'offline' })), 12000);
    try { await firstUp; } finally { clearTimeout(timer); }
  }
  onMsg(topic, payload) {
    if (!topic.startsWith(this.prefix)) return;
    const id = topic.slice(this.prefix.length);
    if (!id || id === this.sid || id.includes('/')) return;
    if (!payload.length) { if (this.peers.delete(id)) this.emitSoon(); return; }
    let state;
    try { state = JSON.parse(new TextDecoder().decode(payload)); } catch (e) { return; }
    if (!state || state.s !== id) return;                       // 자기 주소가 아닌 곳에 올린 상태는 버린다
    this.peers.set(id, state); this.emitSoon();
  }
  emitSoon() {
    if (this.pending) return;
    this.pending = true;
    queueMicrotask(() => { this.pending = false; this.h.onPeers([...this.peers.entries()].map(([id, state]) => ({ id, state }))); });
  }
  set(state) {
    const payload = new TextEncoder().encode(JSON.stringify(state)), topic = this.prefix + this.sid;
    for (const c of this.conns) c.setMine(topic, payload);
  }
  close() { const topic = this.prefix + this.sid; for (const c of this.conns) c.close(topic); }
}

/* ===== 자동 선택 ===== */
// 주소 끝 #local → 탭끼리 / Claude 아티팩트(window.claude 가 있음) → room / 그 밖(GitHub Pages) → MQTT
export function chooseTransport({ code, sid, hash = '', win = globalThis }) {
  if (/#local/.test(hash)) return new LocalTransport({ code, sid });
  if (win.claude && typeof win.claude.use === 'function') return new ClaudeRoomTransport({ claude: win.claude, code });
  return new MqttTransport({ code, sid });
}
