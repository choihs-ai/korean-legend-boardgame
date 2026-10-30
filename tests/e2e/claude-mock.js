// 브라우저 안에서 window.claude.use('room') 를 흉내 낸다(같은 브라우저 컨텍스트의 탭끼리 BroadcastChannel 로 이어 줌).
// 문서의 규칙을 따른다: presence 는 필드별 병합·null 은 삭제·합쳐서 4KiB 이하·키는 식별자 모양, 새로 온 사람에게 모두의 presence 전달,
// onPeers 는 프레임당 한 번, peers() 에는 나 자신(sameTab)도 들어감, 나가면 presence 사라짐.
(() => {
  window.__mock = { maxBytes: 0, violations: 0, drop: 0 };
  const peer = 'peer' + Math.random().toString(36).slice(2, 10);
  window.claude = {
    use: async name => {
      if (name !== 'room' || window.__mock.signedOut) return null;
      return {
        async join(roomName) {
          if (!/^[a-z0-9][a-z0-9_.-]{0,47}$/.test(roomName)) { const e = new Error('이름 형식'); e.code = 'invalid_argument'; throw e; }
          const ch = new BroadcastChannel('mockroom-' + roomName);
          const others = new Map(); let mine = {}; const handlers = new Set(); let timer = null;
          const view = () => [{ peer, by: null, isMe: true, sameTab: true, kind: 'viewer', guest: false, presence: Object.freeze({ ...mine }), updatedAt: Date.now() },
            ...[...others.entries()].map(([p, presence]) => ({ peer: p, by: null, isMe: false, sameTab: false, kind: 'viewer', guest: false, presence: Object.freeze({ ...presence }), updatedAt: Date.now() }))];
          const fire = () => { if (timer) return; timer = setTimeout(() => { timer = null; const peers = view(); for (const h of handlers) h({ peers, joined: [], left: [], updated: [] }); }, 16); };
          ch.onmessage = ev => {
            const m = ev.data;
            if (m.from === peer) return;
            if (m.bye) others.delete(m.from);
            else if (m.hello) ch.postMessage({ from: peer, presence: mine });
            else others.set(m.from, m.presence);
            fire();
          };
          ch.postMessage({ from: peer, hello: 1 });
          return {
            name: roomName,
            async emit() {}, on: () => () => {},
            async presence(patch) {
              const next = { ...mine };
              for (const [k, v] of Object.entries(patch)) { if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(k)) { window.__mock.violations++; const e = new Error('키 형식'); e.code = 'invalid_argument'; throw e; } if (v === null) delete next[k]; else next[k] = v; }
              const bytes = new TextEncoder().encode(JSON.stringify(next)).length;
              window.__mock.maxBytes = Math.max(window.__mock.maxBytes, bytes);
              if (bytes > 4096) { window.__mock.violations++; const e = new Error('4KiB 초과'); e.code = 'invalid_argument'; throw e; }
              if (window.__mock.drop && Math.random() < window.__mock.drop) return;
              mine = next; ch.postMessage({ from: peer, presence: mine }); fire();
            },
            peers: view,
            onPeers(h) { handlers.add(h); queueMicrotask(fire); return () => handlers.delete(h); },
            connected: () => true,
            onConnection(h) { queueMicrotask(() => h(true)); return () => {}; },
            async leave() { ch.postMessage({ from: peer, bye: 1 }); ch.close(); },
          };
        },
      };
    },
  };
})();
