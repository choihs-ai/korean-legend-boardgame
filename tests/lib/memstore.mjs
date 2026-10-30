// 테스트용 입력 기록 저장소: 한 프로세스 안에서 Bridge 를 돌릴 때 쓴다.
// 좌석마다 입력 줄(stream)이 따로 있고, 같은 좌석이 같은 k 에 여러 번 올리면 먼저 올린 것만 쓴다.
export class MemStore {
  constructor({ localSeats = [], streams = null } = {}) {
    this.local = new Set(localSeats);
    this.streams = streams ? streams.map(s => s.slice()) : [[], [], [], []];
    this.subs = new Set();
    this.hashes = [];
    this.intercept = null; // (type, a, b, seat) => 기록할 [type,a,b,seat] 목록을 바꿔치기
  }
  localSeat() { return this.local.size ? [...this.local][0] : -1; }
  isLocal(seat) { return this.local.has(seat); }
  hasLocal() { return this.local.size > 0; }
  hasEntries() { return this.streams.some(s => s.length); }
  answerFor(seat, k) {
    const s = this.streams[seat] || [];
    for (const e of s) if (e[0] === 0 && e[1] === k) return e[2];
    return undefined;
  }
  aiFloor(seat) {
    let f = Infinity;
    for (const s of this.streams) for (const e of s) if (e[0] === 1 && e[1] === seat && e[2] < f) f = e[2];
    return f;
  }
  propose(type, a, b, seat) {
    let list = [[type, a, b, seat]];
    if (this.intercept) list = this.intercept(type, a, b, seat) || list;
    for (const [t, x, y, s] of list) this.streams[s].push([t, x, y]);
    this.notify();
  }
  notify() { setImmediate(() => { for (const f of [...this.subs]) f(); }); }
  subscribe(f) { this.subs.add(f); return () => this.subs.delete(f); }
  reportHash(k, h) { this.hashes.push([k, h]); }
  total() { return this.streams.reduce((n, s) => n + s.length, 0); }
}
