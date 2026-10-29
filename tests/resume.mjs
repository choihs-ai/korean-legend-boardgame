// 이어하기 검증(Node): 게임 도중 저장 → 저장 문자열만으로 복원 → 같은 상태인지, 끝까지 진행되는지.
// 사용: node tests/resume.mjs [판 수=30]
import { state, rules, save, errors, runOneGame, race, summarize, useStorage, seed } from './lib/engine.mjs';

const KEY = 'augyut-save-v1';
const N = Number(process.argv[2] || 30);
let ok = 0;
const fails = [];
for (let i = 0; i < N; i++) {
  const s = 5000 + i;
  // 3라운드 이후 첫 저장을 가로챈다
  const store = useStorage(new Map());
  let snap = null;
  const set = globalThis.localStorage.setItem;
  globalThis.localStorage.setItem = (k, v) => { if (k === KEY && !snap && JSON.parse(v).G.round >= 3) snap = v; set(k, v); };
  await runOneGame({ n: 2 + (i % 3), slots: ['ai', 'ai', 'ai', 'ai'], chaos: i % 2 === 1 }, { seed: s });
  globalThis.localStorage.setItem = set;
  if (!snap) { fails.push({ seed: s, why: '3라운드 전에 끝나 저장 시점 없음' }); continue; }
  if (store.has(KEY)) { fails.push({ seed: s, why: '끝난 판의 저장이 지워지지 않음' }); continue; }
  // 새로고침에 해당: 저장소에 저장 문자열만 두고 불러온다
  useStorage(new Map([[KEY, snap]]));
  seed(s + 1);
  errors.length = 0;
  const parsed = save.readSave();
  if (!parsed) { fails.push({ seed: s, why: '저장 문자열을 읽지 못함' }); continue; }
  save.restoreSnap(parsed);
  if (save.serializeGame() !== snap) { fails.push({ seed: s, why: '복원한 상태가 저장한 상태와 다름' }); continue; }
  const r = await race(rules.gameLoop(), 30000);
  if (r !== 'done') { fails.push({ seed: s, why: '이어한 판이 끝나지 않음' }); continue; }
  if (errors.length) { fails.push({ seed: s, why: '이어한 판에서 예외', err: errors[0].slice(0, 300) }); continue; }
  if (!summarize(state.G).winner) { fails.push({ seed: s, why: '이어한 판이 승자 없이 끝남' }); continue; }
  ok++;
}
console.log(`이어하기 ${ok}/${N} 통과`);
if (fails.length) { console.log(JSON.stringify(fails.slice(0, 8), null, 1)); process.exit(1); }
