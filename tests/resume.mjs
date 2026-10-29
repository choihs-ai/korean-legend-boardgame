// 이어하기 검증(Node): 게임 도중 저장 → 새 런타임에서 불러오기 → 같은 상태인지, 끝까지 진행되는지.
// 사용: node tests/resume.mjs [판 수=30]
import { loadGame, runOneGame, summarize } from './lib/load-game.mjs';

const N = Number(process.argv[2] || 30);
let ok = 0;
const fails = [];
for (let i = 0; i < N; i++) {
  const seed = 5000 + i;
  const a = loadGame({ seed });
  // 3라운드 이후 첫 저장 시점을 잡는다
  let snap = null;
  const orig = a.api.checkpoint;
  a.ctx.checkpoint = function () { orig(); if (!snap && a.api.G && a.api.G.round >= 3 && a.api.lastSnap) snap = a.api.lastSnap; };
  await runOneGame(a, { n: 2 + (i % 3), slots: ['ai', 'ai', 'ai', 'ai'], chaos: i % 2 === 1, fast: true });
  if (!snap) { fails.push({ seed, why: '3라운드 전에 끝나 저장 시점 없음' }); continue; }
  // 새 런타임(새로고침에 해당)에 저장 문자열만 넘겨 이어하기
  const store = new Map([['augyut-save-v1', snap]]);
  const b = loadGame({ seed: seed + 1, storage: store });
  const parsed = b.api.parseSave(snap);
  if (!parsed) { fails.push({ seed, why: '저장 문자열을 읽지 못함' }); continue; }
  b.api.restoreSnap(parsed);
  const again = b.api.serializeGame();
  if (again !== snap) { fails.push({ seed, why: '복원한 상태가 저장한 상태와 다름' }); continue; }
  const r = await Promise.race([b.api.gameLoop().then(() => 'done'), new Promise(res => setTimeout(() => res('timeout'), 30000))]);
  if (r !== 'done') { b.api.abort(); fails.push({ seed, why: '이어한 판이 끝나지 않음' }); continue; }
  if (b.errors.length) { fails.push({ seed, why: '이어한 판에서 예외', err: b.errors[0].slice(0, 300) }); continue; }
  if (!summarize(b.api.G).winner) { fails.push({ seed, why: '이어한 판이 승자 없이 끝남' }); continue; }
  if (store.has('augyut-save-v1')) { fails.push({ seed, why: '끝난 판의 저장이 지워지지 않음' }); continue; }
  ok++;
}
console.log(`이어하기 ${ok}/${N} 통과`);
if (fails.length) { console.log(JSON.stringify(fails.slice(0, 8), null, 1)); process.exit(1); }
