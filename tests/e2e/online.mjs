// 온라인 대전 화면 시험: 같은 브라우저의 탭(#local)을 서로 다른 기기처럼 써서
// 방 만들기 → 참가 → 정원 초과 거절 → 시작 → 한 판 끝까지 → 모든 탭의 판이 같은지, 도중 나가기·새로고침 후 이어하기까지 확인한다.
// 사용: node tests/e2e/online.mjs
import { chromium, serve } from './pw.mjs';

const base = (await serve()).replace(/#.*$/, '');
const URL_LOCAL = base + '#local';
const browser = await chromium.launch();
const fails = [];
const check = (c, m, x) => { if (!c) fails.push({ m, ...x }); return c; };
const errors = [];

async function newPlayer(ctx, nick, { auto = true, takeoverMs = 0 } = {}) {
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(`${nick}: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error') errors.push(`${nick}: ${m.text()}`); });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(URL_LOCAL);
  await page.evaluate(([a, t]) => { OnlineUI.session.auto = a; OnlineUI.session.alwaysInstant = true; OnlineUI.session.autoTakeoverMs = t; }, [auto, takeoverMs]);
  await page.click('#onlineBtn');
  await page.fill('#onNick', nick);
  return page;
}
const lobbyCount = page => page.evaluate(() => document.querySelectorAll('.mem').length);
const gameOver = page => page.evaluate(() => !!(window.G && G.over));
const snapshotOf = page => page.evaluate(() => ({ h: hashState(), log: G.log.join('\n'), round: G.round, names: G.players.map(p => p.name + ':' + (p.ai ? 'ai' : 'h')) }));
async function waitAll(pages, fn, ms = 120000) {
  const t = Date.now();
  while (Date.now() - t < ms) { if ((await Promise.all(pages.map(fn))).every(Boolean)) return true; await new Promise(r => setTimeout(r, 300)); }
  return false;
}

async function scenario(name, { humans, ai, chaos, df }) {
  const ctx = await browser.newContext();
  const nicks = ['가나', '다라', '마바', '사아'].slice(0, humans);
  const pages = [];
  pages.push(await newPlayer(ctx, nicks[0]));
  await pages[0].click(`[data-act="hu"][data-v="${humans}"]`);
  if (ai) await pages[0].click(`[data-act="ai"][data-v="${ai}"]`);
  if (ai) await pages[0].click(`[data-act="df"][data-v="${df}"]`);
  if (chaos) await pages[0].click('label[for="onCh"]');
  await pages[0].click('[data-act="create"]');
  await pages[0].waitForSelector('.code-big');
  const code = (await pages[0].textContent('.code-big')).trim();
  check(/^[A-HJ-NP-Z2-9]{4}$/.test(code), `${name}: 방 코드 형식`, { code });
  for (let i = 1; i < humans; i++) {
    const p = await newPlayer(ctx, nicks[i]);
    await p.fill('#onCode', code);
    await p.click('[data-act="join"]');
    await p.waitForSelector('.code-big', { timeout: 15000 });
    pages.push(p);
  }
  check(await waitAll(pages, async p => (await lobbyCount(p)) >= humans, 20000), `${name}: 모든 대기실에 ${humans}명`, {});
  // 정원 초과
  const extra = await newPlayer(ctx, '넷째');
  await extra.fill('#onCode', code); await extra.click('[data-act="join"]');
  check(await extra.waitForSelector('.on-err', { timeout: 15000 }).then(() => true, () => false), `${name}: 정원 초과 거절 메시지`, {});
  check(/자리가 다 찬|이미 시작/.test(await extra.textContent('.on-err')), `${name}: 거절 문구`, {});
  await extra.close();
  // 시작
  await pages[0].click('[data-act="start"]');
  check(await waitAll(pages, async p => p.evaluate(() => !!window.G && !document.querySelector('#game').hidden), 40000), `${name}: 모두 게임 화면으로`, {});
  check(await waitAll(pages, gameOver, 180000), `${name}: 한 판 끝까지`, { overs: await Promise.all(pages.map(gameOver)) });
  const snaps = await Promise.all(pages.map(snapshotOf));
  check(snaps.every(s => s.h === snaps[0].h && s.log === snaps[0].log), `${name}: 모든 탭의 판 상태·기록이 같음`, { hs: snaps.map(s => s.h), rounds: snaps.map(s => s.round) });
  check(snaps[0].names.filter(n => n.endsWith(':h')).length === humans, `${name}: 사람 좌석 수`, { names: snaps[0].names });
  console.log(`  ${name}: ${snaps[0].round}라운드, 로그 ${snaps[0].log.split('\n').length}줄, 탭 ${pages.length}개 일치=${snaps.every(s => s.h === snaps[0].h)}`);
  await ctx.close();
}


// 도중에 일어나는 일: 한 명이 메뉴로 나가기 / 탭이 갑자기 닫힘 / 새로고침 뒤 이어하기
async function fault(kind) {
  const name = { leave: '도중 나가기', crash: '갑자기 닫힘', reload: '새로고침 후 이어하기' }[kind];
  const ctx = await browser.newContext();
  const nicks = ['가나', '다라', '마바'];
  const GATE = () => { OnlineUI.session.gate = k => ((k >= 25 && !window.__go) ? (window.__gp = window.__gp || new Promise(r => { window.__rel = r; })) : undefined); };
  const pages = [await newPlayer(ctx, nicks[0], { takeoverMs: 2000 })];
  await pages[0].click('[data-act="hu"][data-v="3"]');
  await pages[0].click('[data-act="create"]');
  await pages[0].waitForSelector('.code-big');
  const code = (await pages[0].textContent('.code-big')).trim();
  for (let i = 1; i < 3; i++) { const p = await newPlayer(ctx, nicks[i], { takeoverMs: 2000 }); await p.fill('#onCode', code); await p.click('[data-act="join"]'); await p.waitForSelector('.code-big'); pages.push(p); }
  await Promise.all(pages.map(p => p.evaluate(GATE)));
  check(await waitAll(pages, async p => (await lobbyCount(p)) >= 3, 20000), `${name}: 대기실 3명`, {});
  await pages[0].click('[data-act="start"]');
  // 입력 25번째 근처에서 멈춘 상태까지 기다림
  const stalled = async () => (await Promise.all(pages.map(p => p.evaluate(() => (OnlineUI.session.bridge ? OnlineUI.session.bridge.k : 0))))).some(k => k >= 26);
  let t0 = Date.now(); while (!(await stalled()) && Date.now() - t0 < 60000) await new Promise(r => setTimeout(r, 200));
  check(await stalled(), `${name}: 중간 지점에 도달`, {});
  await new Promise(r => setTimeout(r, 1500));
  const hint = (await Promise.all(pages.map(p => p.textContent('#chips')))).join('|');
  check(/두는 중|증강을 고르는/.test(hint), `${name}: 대기 안내 문구`, { hint });
  check((await Promise.all(pages.map(p => p.textContent('#netBadge')))).every(t => /^\d\/3$/.test(t.trim())), `${name}: 접속 배지`, {});
  if (kind === 'leave') await pages[0].screenshot({ path: 'tests/e2e/out/online-waiting.png' });
  let alive = pages.slice(), victim = pages[2];
  if (kind === 'leave') {
    await victim.click('#menuBtn'); await victim.click('button[data-info="quit"]'); await victim.click('button[data-info="quit"]');
    check(await victim.waitForSelector('#title:not([hidden])', { timeout: 15000 }).then(() => true, () => false), `${name}: 나간 사람은 타이틀로`, {});
    alive = pages.slice(0, 2);
  } else if (kind === 'crash') {
    await victim.close(); alive = pages.slice(0, 2);
  } else if (kind === 'reload') {
    const b = pages[1];
    await b.evaluate(() => OnlineUI.session.saveNow(true));
    await b.reload();
    await b.evaluate(() => { OnlineUI.session.auto = true; OnlineUI.session.alwaysInstant = true; OnlineUI.session.autoTakeoverMs = 2000; });
    await b.evaluate(GATE);
    await b.click('#onlineBtn');
    check(await b.waitForSelector('[data-act="resume"]', { timeout: 10000 }).then(() => true, () => false), `${name}: 이어하기 카드`, {});
    await b.click('[data-act="resume"]');
    check(await b.waitForSelector('#game:not([hidden])', { timeout: 20000 }).then(() => true, () => false), `${name}: 게임 화면 복귀`, {});
    await new Promise(r => setTimeout(r, 2500));
  }
  await Promise.all(alive.map(p => p.evaluate(() => { window.__go = true; if (window.__rel) window.__rel(); })));
  const ok = await waitAll(alive, gameOver, 200000);
  check(ok, `${name}: 남은 사람들이 끝까지`, { overs: await Promise.all(alive.map(gameOver)) });
  const snaps = await Promise.all(alive.map(snapshotOf));
  check(snaps.every(x => x.h === snaps[0].h && x.log === snaps[0].log), `${name}: 판 상태 일치`, { hs: snaps.map(x => x.h) });
  if (kind !== 'reload') check(/AI가 대신 둡니다/.test(snaps[0].log), `${name}: 나간 자리는 AI 가 이어 둠`, {});
  console.log(`  ${name}: ${snaps[0].round}라운드, 살아남은 탭 ${alive.length}개 일치=${snaps.every(x => x.h === snaps[0].h)}`);
  await ctx.close();
}
await fault('leave');
await fault('crash');
await fault('reload');

await scenario('사람 2명', { humans: 2, ai: 0, chaos: false });
await scenario('사람 3명 + 혼돈', { humans: 3, ai: 0, chaos: true });
await scenario('사람 2명 + AI 2명(어려움)', { humans: 2, ai: 2, chaos: false, df: 'hard' });

console.log(errors.length ? '콘솔 오류:\n' + [...new Set(errors)].slice(0, 5).join('\n') : '콘솔 오류 없음');
if (errors.length) fails.push({ m: '콘솔 오류', errors: errors.slice(0, 3) });
await browser.close();
if (fails.length) { console.log('실패', JSON.stringify(fails, null, 1)); process.exit(1); }
console.log('온라인 화면 시험 통과');
