// 프로토콜 코어 시험용 가짜 네트워크: 가상 시계, 지연·유실·중복·끊김·재시작을 낸다.
import { RoomCore, makeCode } from '../../src/net/room.js';

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export class SimNet {
  constructor({ seed = 1, loss = 0.2, dup = 0.05, minDelay = 30, maxDelay = 400 } = {}) {
    this.rnd = mulberry32(seed); Object.assign(this, { loss, dup, minDelay, maxDelay });
    this.now = 1_000_000; this.q = []; this.nodes = new Map(); this.cut = new Set(); this.maxBytes = 0; this.published = 0;
  }
  rint(n) { return Math.floor(this.rnd() * n); }
  rhex(bytes) { return Array.from({ length: bytes }, () => this.rint(256).toString(16).padStart(2, '0')).join(''); }
  addNode(name, { restore = null } = {}) {
    const sid = name.padEnd(8, 'x').replace(/[^A-Za-z2-9]/g, 'k');
    const node = { name, sid, view: new Map(), events: [], core: null, down: false };
    node.core = new RoomCore({
      sid, nick: name, now: () => this.now, randHex: b => this.rhex(b), randInt: n => this.rint(n),
      publish: st => this.publish(node, st), onEvent: (type, data) => node.events.push({ type, data, at: this.now }),
    });
    this.nodes.set(name, node);
    node.nextTick = this.now + this.rint(250);
    if (restore) node.core.restore(restore);
    return node;
  }
  link(a, b) { return [a, b].sort().join('|'); }
  partition(a, b) { this.cut.add(this.link(a, b)); }
  heal(a, b) { this.cut.delete(this.link(a, b)); }
  isolate(name) { node: for (const n of this.nodes.keys()) if (n !== name) this.partition(name, n); }
  rejoinAll(name) { for (const n of this.nodes.keys()) if (n !== name) this.heal(name, n); }
  publish(from, st) {
    const bytes = JSON.stringify(st).length; this.maxBytes = Math.max(this.maxBytes, bytes); this.published++;
    const copy = JSON.parse(JSON.stringify(st));
    for (const to of this.nodes.values()) {
      if (to === from) continue;
      const copies = this.rnd() < this.dup ? 2 : 1;
      for (let c = 0; c < copies; c++) {
        if (this.rnd() < this.loss) continue;
        this.q.push({ at: this.now + this.minDelay + this.rint(this.maxDelay - this.minDelay), from, to, st: copy });
      }
    }
  }
  deliver() {
    this.q.sort((a, b) => a.at - b.at);
    while (this.q.length && this.q[0].at <= this.now) {
      const m = this.q.shift();
      if (m.to.down || m.from.down || this.cut.has(this.link(m.from.name, m.to.name))) continue;
      m.to.view.set(m.from.sid, m.st);
      m.to.core.receive([...m.to.view.entries()].map(([id, state]) => ({ id, state })));
    }
  }
  // 한 단계(ms) 진행
  step(ms = 50) {
    this.now += ms;
    this.deliver();
    for (const n of this.nodes.values()) if (!n.down && this.now >= n.nextTick) { n.nextTick = this.now + 200 + this.rint(100); n.core.tick(); }
  }
  run(ms, fn) { const end = this.now + ms; while (this.now < end) { fn && fn(); this.step(); } }
  kill(name) { const n = this.nodes.get(name); n.down = true; }
  // 사라진 참가자를 목록에서 지운다(전송 계층이 "나갔음"을 알리는 것과 같음)
  forget(name) { const sid = this.nodes.get(name).sid; for (const n of this.nodes.values()) { n.view.delete(sid); } }
}
