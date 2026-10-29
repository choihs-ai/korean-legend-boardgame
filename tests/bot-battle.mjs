// AI 4명 봇 대전: 일반/혼돈 모드 각 N판을 돌려 예외, 무한 루프, 승자 없는 종료를 찾는다.
// 사용: node tests/bot-battle.mjs [판 수=200] [시작 시드=1]
import { loadGame, runOneGame, summarize } from './lib/load-game.mjs';

const GAMES = Number(process.argv[2] || 200);
const SEED0 = Number(process.argv[3] || 1);
const failures = [];
const stats = { normal: { games: 0, rounds: 0, maxRound: 0 }, chaos: { games: 0, rounds: 0, maxRound: 0 } };
const wins = {};
const started = Date.now();

for (const mode of ['normal', 'chaos']) {
  for (let i = 0; i < GAMES; i++) {
    const seed = SEED0 + i + (mode === 'chaos' ? 100000 : 0);
    const game = loadGame({ seed });
    const cfg = { n: 4, slots: ['ai', 'ai', 'ai', 'ai'], chaos: mode === 'chaos', endOnFirst: false, fast: true };
    const r = await runOneGame(game, cfg);
    const G = game.api.G;
    const sum = G ? summarize(G) : null;
    const st = stats[mode];
    st.games++;
    if (G) { st.rounds += G.round; st.maxRound = Math.max(st.maxRound, G.round); }
    const bad = [];
    if (r === 'timeout') bad.push('무한 루프/시간 초과');
    if (game.errors.length) bad.push('예외: ' + game.errors[0].split('\n').slice(0, 3).join(' | '));
    if (r === 'done' && sum && !sum.winner) bad.push('승자 없는 종료');
    if (G) {
      const early = G.log.find(l => /^\[[12]R\].*특수 승리/.test(l));
      if (early) bad.push('3라운드 전 특수 승리: ' + early);
    }
    if (bad.length) failures.push({ mode, seed, bad, sum, log: G ? G.log.slice(-6) : [] });
    if (G) for (const p of G.players) if ((p.outReason || '').startsWith('특수 승리')) wins[p.outReason] = (wins[p.outReason] || 0) + 1;
  }
}

for (const [mode, st] of Object.entries(stats)) {
  console.log(`${mode}: ${st.games}판, 평균 ${(st.rounds / st.games).toFixed(1)}라운드, 최장 ${st.maxRound}라운드`);
}
console.log('특수 승리 종류:', Object.keys(wins).length);
console.log(`소요 ${((Date.now() - started) / 1000).toFixed(1)}초`);
if (failures.length) {
  console.log(`실패 ${failures.length}건`);
  for (const f of failures.slice(0, 10)) console.log(JSON.stringify(f, null, 1));
  process.exit(1);
}
console.log('실패 0건');
