// window.claude.use('room') 의 모의 구현 (문서에 적힌 규칙대로: presence 는 필드별 병합, null 은 삭제, 합쳐서 4KiB 이하,
// 새로 들어온 사람에게는 모두의 presence 전달, onPeers 는 프레임당 한 번, 나가면 presence 삭제).
export class MockRoomHub {
  constructor() { this.rooms = new Map(); this.n = 0; this.violations = []; this.maxBytes = 0; this.drop = 0; this.rnd = Math.random; }
  newClient({ signedIn = true } = {}) {
    const hub = this, peer = 'peer' + (++this.n).toString(36).padStart(6, '0');
    return {
      peer,
      use: async name => {
        if (name !== 'room' || !signedIn) return null;
        return {
          async join(roomName) {
            if (!/^[a-z0-9][a-z0-9_.-]{0,47}$/.test(roomName)) { const e = new Error('이름 형식'); e.code = 'invalid_argument'; throw e; }
            let room = hub.rooms.get(roomName); if (!room) hub.rooms.set(roomName, room = new Map());
            const me = { peer, presence: {}, updatedAt: Date.now(), handlers: new Set(), connHandlers: new Set(), timer: null };
            room.set(peer, me);
            const view = () => [...room.values()].map(m => Object.freeze({ peer: m.peer, by: null, isMe: m.peer === peer, sameTab: m.peer === peer, kind: 'viewer', guest: false, presence: Object.freeze({ ...m.presence }), updatedAt: m.updatedAt }));
            const fire = (m) => { if (m.timer) return; m.timer = setTimeout(() => { m.timer = null; const peers = view(); for (const h of m.handlers) h({ peers, joined: [], left: [], updated: [] }); }, 16); };
            const fireAll = () => { for (const m of room.values()) fire(m); };
            me.fire = fire;
            fireAll();
            return {
              name: roomName,
              async emit() {},
              on: () => () => {},
              async presence(patch) {
                const next = { ...me.presence };
                for (const [k, v] of Object.entries(patch)) { if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(k)) { const e = new Error('키 형식'); e.code = 'invalid_argument'; throw e; } if (v === null) delete next[k]; else next[k] = v; }
                const bytes = new TextEncoder().encode(JSON.stringify(next)).length;
                hub.maxBytes = Math.max(hub.maxBytes, bytes);
                if (bytes > 4096) { hub.violations.push(bytes); const e = new Error('4KiB 초과'); e.code = 'invalid_argument'; throw e; }
                if (hub.drop && hub.rnd() < hub.drop) return;            // 가끔 전달이 빠지는 상황
                me.presence = next; me.updatedAt = Date.now(); fireAll();
              },
              peers: view,
              onPeers(h) { me.handlers.add(h); queueMicrotask(() => fire(me)); return () => me.handlers.delete(h); },
              connected: () => true,
              onConnection(h) { queueMicrotask(() => h(true)); return () => {}; },
              async leave() { room.delete(peer); clearTimeout(me.timer); fireAll(); },
            };
          },
        };
      },
    };
  }
}
