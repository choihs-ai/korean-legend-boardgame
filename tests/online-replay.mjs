// 온라인 대전의 핵심 약속 검증(네트워크 없이): 같은 시드 + 같은 입력 기록이면 어느 기기에서든 같은 판이 나온다.
//  1) 라이브로 한 판 진행하며 입력을 기록  2) 기록만으로 처음부터 재생  3) 최종 상태·로그가 같은지 비교
//  4) 도중에 한 좌석을 AI 로 바꾸는 명령을 넣은 판도 같은 방식으로 비교
// 사용: node tests/online-replay.mjs [판 수=40]
import { state, errors } from './lib/engine.mjs';
import { headlessUI, headlessR } from './lib/headless.mjs';
import { MemStore } from './lib/memstore.mjs';
import { Bridge } from '../src/net/bridge.js';
import { hashState } from '../src/save.js';
import { sha256 } from '../src/net/sha256.js';

const N = Number(process.argv[2] || 40);
const noop = () => {};
const sfx = { play: noop, init: noop };
const make = (store, extra = {}) => new Bridge({ store, ui: headlessUI, r: headlessR, sfx, animateMove: () => Promise.resolve(), alwaysInstant: true, ...extra });
const info = (i, humans, chaos) => ({
  cf: { n: 4, ch: chaos ? 1 : 0, df: ['easy', 'normal', 'hard'][i % 3], ef: 0 },
  ro: ['a', 'b', 'c', 'd'].slice(0, humans), nicks: ['가', '나', '다', '라'].slice(0, humans), sd: sha256('seed' + i),
});
async function runTo(br, inf, ms = 60000) {
  let timer; const timeout = new Promise(res => { timer = setTimeout(() => res('timeout'), ms); });
  const r = await Promise.race([br.run(inf).then(() => 'done'), timeout]);
  clearTimeout(timer);
  if (r === 'timeout') br.stop();
  return r;
}
const snap = () => ({ h: hashState(), log: state.G.log.slice(), round: state.G.round, over: state.G.over, ranks: state.G.players.map(p => p.rank) });

let ok = 0; const fails = []; const shapes = { 던지기: 0, 이동: 0, 증강행동: 0, 알까기: 0, 선택: 0, AI대체: 0 };
for (let i = 0; i < N; i++) {
  const humans = 1 + (i % 4), chaos = i % 2 === 1, inf = info(i, humans, chaos);
  errors.length = 0;
  // 1) 라이브
  const live = new MemStore({ localSeats: [...Array(humans).keys()] });
  let takeoverAt = null;
  if (i % 4 === 3 && humans >= 2) { // 4번에 1번은 도중에 1번 좌석을 AI 로 바꾼다
    takeoverAt = 6 + (i % 5);
    let count = 0;
    live.intercept = (type, a, b, seat) => {
      if (type === 0 && a === takeoverAt && seat !== 0) return [[1, seat, a, 0]]; // 0번 좌석 사람이 "seat 를 AI 로" 명령
      return null;
    };
  }
  const b1 = make(live, { auto: true });
  const r1 = await runTo(b1, inf);
  if (r1 !== 'done' || errors.length) { fails.push({ i, why: 'live ' + r1, err: errors[0] }); b1.stop(); continue; }
  const s1 = snap(); b1.stop();
  for (const st of live.streams) for (const [t, a, b] of st) {
    if (t === 1) shapes.AI대체++;
    else if (b === 't') shapes.던지기++;
    else if (typeof b === 'string' && b[0] === 'm') shapes.이동++;
    else if (typeof b === 'string' && b[0] === 'a') shapes.증강행동++;
    else if (typeof b === 'string' && /^\d+,-?\d+,-?\d+$/.test(b)) shapes.알까기++;
    else shapes.선택++;
  }
  // 2) 재생
  const replay = new MemStore({ localSeats: [], streams: live.streams });
  const b2 = make(replay, { auto: false });
  errors.length = 0;
  const r2 = await runTo(b2, inf);
  if (r2 !== 'done' || errors.length) { fails.push({ i, why: 'replay ' + r2, err: errors[0] }); b2.stop(); continue; }
  const s2 = snap(); b2.stop();
  if (b2.collectCount !== 0) { fails.push({ i, why: '재생 중 화면 입력을 받으려 함' }); continue; }
  if (s1.h !== s2.h || JSON.stringify(s1.log) !== JSON.stringify(s2.log)) { fails.push({ i, why: '라이브와 재생 결과가 다름', a: s1.h, b: s2.h, takeoverAt }); continue; }
  if (!s1.over) { fails.push({ i, why: '끝나지 않음' }); continue; }
  ok++;
}
console.log(`온라인 재생 일치 ${ok}/${N}판 (사람 1~4명, 일반·혼돈, 난이도 섞음, 4판에 1번 AI 대체)`);
console.log('기록된 입력 종류:', JSON.stringify(shapes));
if (fails.length) { console.log(JSON.stringify(fails.slice(0, 5), null, 1)); process.exit(1); }
