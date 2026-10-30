// 아주 작은 MQTT 3.1.1 클라이언트 (WebSocket 위). 외부 스크립트 없이 쓰려고 직접 만들었다.
// 지원: CONNECT(+유언), SUBSCRIBE(QoS 0), PUBLISH(QoS 0, retain), PINGREQ, DISCONNECT. 그 밖의 패킷은 무시한다.
const enc = new TextEncoder(), dec = new TextDecoder();

function varLen(n) { const out = []; do { let b = n % 128; n = Math.floor(n / 128); if (n > 0) b |= 128; out.push(b); } while (n > 0); return out; }
function cat(...parts) {
  let n = 0; for (const p of parts) n += p.length;
  const out = new Uint8Array(n); let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
const u16 = n => Uint8Array.of(n >> 8, n & 255);
const str = s => { const b = enc.encode(s); return cat(u16(b.length), b); };
const packet = (first, body) => cat(Uint8Array.of(first, ...varLen(body.length)), body);

export const encodeConnect = ({ clientId, keepalive = 40, willTopic, will = new Uint8Array(0) }) =>
  packet(0x10, cat(str('MQTT'), Uint8Array.of(4, 0x02 | 0x04 | 0x20), u16(keepalive), str(clientId), str(willTopic), u16(will.length), will));
export const encodeSubscribe = (pid, filter) => packet(0x82, cat(u16(pid), str(filter), Uint8Array.of(0)));
export const encodePublish = (topic, payload, retain) => packet(0x30 | (retain ? 1 : 0), cat(str(topic), payload));
export const PINGREQ = Uint8Array.of(0xc0, 0);
export const DISCONNECT = Uint8Array.of(0xe0, 0);

// 들어온 바이트를 이어 붙이며 완성된 패킷을 하나씩 꺼낸다
export class PacketReader {
  constructor() { this.buf = new Uint8Array(0); }
  push(chunk) {
    this.buf = cat(this.buf, chunk);
    const out = [];
    for (;;) {
      if (this.buf.length < 2) break;
      let mult = 1, len = 0, i = 1, b;
      do {
        if (i >= this.buf.length) return out;                  // 길이 바이트가 아직 덜 옴
        b = this.buf[i++]; len += (b & 127) * mult; mult *= 128;
        if (mult > 128 * 128 * 128 * 128) throw new Error('MQTT 길이 오류');
      } while (b & 128);
      if (this.buf.length < i + len) break;
      out.push({ first: this.buf[0], body: this.buf.slice(i, i + len) });
      this.buf = this.buf.slice(i + len);
    }
    return out;
  }
}
export function parsePublish(pk) {
  const tl = (pk.body[0] << 8) | pk.body[1];
  const topic = dec.decode(pk.body.slice(2, 2 + tl));
  const qos = (pk.first >> 1) & 3;
  const start = 2 + tl + (qos ? 2 : 0);
  return { topic, payload: pk.body.slice(start) };
}

// 연결 하나. 끊기면 지수 백오프로 다시 붙고, 붙을 때마다 구독과 내 상태를 다시 올린다.
export class MqttConn {
  constructor({ url, clientId, willTopic, filters, WS = globalThis.WebSocket, onMessage, onStatus, now = () => Date.now() }) {
    Object.assign(this, { url, clientId, willTopic, filters, WS, onMessage, onStatus, now });
    this.ws = null; this.ready = false; this.closed = false; this.tries = 0; this.pid = 1; this.pingTimer = null; this.retryTimer = null; this.mine = null; this.connectTimer = null; this.lastRx = 0;
  }
  start() { this.closed = false; this.connect(); }
  connect() {
    if (this.closed) return;
    let ws;
    try { ws = new this.WS(this.url, 'mqtt'); } catch (e) { this.scheduleRetry(); return; }
    ws.binaryType = 'arraybuffer';
    this.ws = ws; const reader = new PacketReader();
    this.connectTimer = setTimeout(() => { if (!this.ready) { try { ws.close(); } catch (e) { /* 무시 */ } } }, 8000);
    ws.onopen = () => ws.send(encodeConnect({ clientId: this.clientId, willTopic: this.willTopic }));
    ws.onmessage = ev => {
      this.lastRx = this.now();
      let pks;
      try { pks = reader.push(new Uint8Array(ev.data)); } catch (e) { try { ws.close(); } catch (er) { /* 무시 */ } return; }
      for (const pk of pks) {
        const type = pk.first >> 4;
        if (type === 2) {                                     // CONNACK
          if (pk.body[1] !== 0) { try { ws.close(); } catch (e) { /* 무시 */ } return; }
          this.ready = true; this.tries = 0; clearTimeout(this.connectTimer);
          for (const f of this.filters) ws.send(encodeSubscribe(this.pid++ & 0xffff || 1, f));
          if (this.mine) this.publish(this.mine.topic, this.mine.payload, true);
          this.lastRx = this.now();
          clearInterval(this.pingTimer);
          this.pingTimer = setInterval(() => {
            // 폰이 잠들었다 깨면 연결이 죽었는데도 열려 있는 것처럼 보일 수 있다 → 오래 아무 소식이 없으면 끊고 다시 붙는다
            if (this.now() - this.lastRx > 50000) { try { ws.close(); } catch (e) { /* 무시 */ } return; }
            try { ws.send(PINGREQ); } catch (e) { /* 무시 */ }
          }, 15000);
          this.onStatus(true);
        } else if (type === 3) {
          const m = parsePublish(pk);
          this.onMessage(m.topic, m.payload);
        }
      }
    };
    const down = () => {
      if (this.ws !== ws) return;
      const was = this.ready; this.ready = false; this.ws = null;
      clearInterval(this.pingTimer); clearTimeout(this.connectTimer);
      if (was) this.onStatus(false);
      this.scheduleRetry();
    };
    ws.onclose = down; ws.onerror = () => { try { ws.close(); } catch (e) { /* 무시 */ } };
  }
  // 앱이 다시 화면에 나왔을 때: 끊겨 있으면 바로 다시 붙고, 붙어 있으면 연결이 살아 있는지 확인하고 내 상태를 다시 올린다
  wake() {
    if (this.closed) return;
    if (!this.ready) { clearTimeout(this.retryTimer); this.tries = 0; if (!this.ws) this.connect(); return; }
    this.lastRx = Math.min(this.lastRx, this.now() - 35000);   // 곧 확인 핑이 가도록 (15초 안에 응답이 없으면 끊고 다시 붙음)
    try { this.ws.send(PINGREQ); } catch (e) { /* 무시 */ }
    if (this.mine) this.publish(this.mine.topic, this.mine.payload, true);
  }
  scheduleRetry() {
    if (this.closed) return;
    const wait = Math.min(15000, 1000 * 2 ** Math.min(this.tries++, 4));
    clearTimeout(this.retryTimer); this.retryTimer = setTimeout(() => this.connect(), wait);
  }
  publish(topic, payload, retain) {
    if (!this.ready || !this.ws) return false;
    try { this.ws.send(encodePublish(topic, payload, retain)); return true; } catch (e) { return false; }
  }
  // 내 상태: 붙을 때마다 다시 올릴 수 있게 기억해 둔다
  setMine(topic, payload) { this.mine = { topic, payload }; this.publish(topic, payload, true); }
  close(clearTopic) {
    this.closed = true; clearTimeout(this.retryTimer); clearInterval(this.pingTimer); clearTimeout(this.connectTimer);
    const ws = this.ws;
    if (ws) {
      try { if (this.ready && clearTopic) ws.send(encodePublish(clearTopic, new Uint8Array(0), true)); if (this.ready) ws.send(DISCONNECT); } catch (e) { /* 무시 */ }
      setTimeout(() => { try { ws.close(); } catch (e) { /* 무시 */ } }, 150);
    }
    this.ws = null; this.ready = false;
  }
}
