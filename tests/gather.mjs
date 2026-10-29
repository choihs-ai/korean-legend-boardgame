// 모여서 하기 모드: 사람이 2명 이상이면 비밀 투표·지목 증강이 선택지에 나오지 않는지 확인.
// 사용: node tests/gather.mjs
import { loadGame } from './lib/load-game.mjs';

const SECRET = ['getdown', 'detective', 'delivery', 'plan', 'whoami'];
function sample(slots, gather) {
  const g = loadGame({ seed: 77 });
  const { ctx } = g;
  Object.assign(g.api.CFG, { n: 4, slots, gather });
  ctx.newGame();
  const seen = new Set();
  for (let i = 0; i < 3000; i++) for (const cat of ['start', 'mid', 'end']) for (const id of ctx.drawOptions(g.api.P(0), cat, new Set())) seen.add(id);
  return SECRET.filter(id => seen.has(id));
}
const cases = [
  ['사람 2명, 모여서 하기 켬', ['human', 'human', 'ai', 'ai'], true, 0],
  ['사람 2명, 모여서 하기 끔', ['human', 'human', 'ai', 'ai'], false, SECRET.length],
  ['사람 1명, 모여서 하기 켬', ['human', 'ai', 'ai', 'ai'], true, SECRET.length],
];
let fail = 0;
for (const [name, slots, gather, expect] of cases) {
  const got = sample(slots, gather);
  const ok = got.length === expect;
  if (!ok) fail++;
  console.log(`${ok ? '통과' : '실패'}: ${name} → 비밀 증강 ${got.length}종 등장 (기대 ${expect})`);
}
process.exit(fail ? 1 : 0);
