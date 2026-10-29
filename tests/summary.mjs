// 결과 요약·전적 검증: 여러 판을 같은 저장소에서 돌린 뒤 요약 데이터와 전적이 맞는지.
// 사용: node tests/summary.mjs [판 수=30]
import { loadGame, runOneGame } from './lib/load-game.mjs';

const N = Number(process.argv[2] || 30);
const storage = new Map();
const fails = [];
let momentsSeen = 0;
for (let i = 0; i < N; i++) {
  const g = loadGame({ seed: 900 + i, storage });
  const r = await runOneGame(g, { n: 2 + (i % 3), slots: ['ai', 'ai', 'ai', 'ai'], chaos: i % 2 === 0, fast: true });
  if (r !== 'done') { fails.push(`${i}: 끝나지 않음`); continue; }
  const sum = g.ctx.buildSummary();
  if (sum.players.length !== g.api.G.players.length) fails.push(`${i}: 요약 인원 불일치`);
  for (const p of sum.players) for (const k of ['capt', 'lost', 'yuts', 'mos']) if (!Number.isInteger(p[k]) || p[k] < 0) fails.push(`${i}: ${p.name} ${k}=${p[k]}`);
  const capt = sum.players.reduce((a, p) => a + p.capt, 0), lost = sum.players.reduce((a, p) => a + p.lost, 0);
  if (capt > lost) fails.push(`${i}: 잡은 말(${capt})이 잡힌 말(${lost})보다 많음`);
  if (sum.moments.length > 2 || sum.moments.some(t => typeof t !== 'string' || !t)) fails.push(`${i}: 결정적 순간 형식 오류`);
  momentsSeen += sum.moments.length ? 1 : 0;
  if (g.errors.length) fails.push(`${i}: 예외 ${g.errors[0].slice(0, 200)}`);
}
const rec = JSON.parse(storage.get('augyut-records-v1'));
if (rec.games !== N) fails.push(`전적 판 수 ${rec.games} ≠ ${N}`);
if (rec.humanGames !== 0) fails.push('AI만 둔 판이 사람 판으로 기록됨');
if (!rec.seen.length) fails.push('본 증강 기록 없음');
if (storage.has('augyut-save-v1')) fails.push('끝난 판의 이어하기 저장이 남음');
console.log(`요약 ${N}판 확인, 결정적 순간이 있는 판 ${momentsSeen}, 전적 ${rec.games}판, 본 증강 ${rec.seen.length}종`);
if (fails.length) { console.log(fails.slice(0, 10).join('\n')); process.exit(1); }
console.log('결과 요약·전적 통과');
