// 온라인 동시 증강 선택과 제한 시간을 실제 화면으로 확인한다(사람이 직접 누르듯이).
// 1) 증강 선택창이 두 기기에 동시에 뜬다  2) 한 명이 먼저 고르면 "고르는 중" 안내가 뜨고, 둘 다 고르면 진행된다
// 3) 제한 시간이 지나면 AI 가 그 차례를 대신 두고 기록에 남는다
// 사용: node tests/e2e/online-sim.mjs
import { chromium, serve } from './pw.mjs';

const base = (await serve()).replace(/#.*$/, '');
const browser = await chromium.launch();
const ctx = await browser.newContext();
const fails = [], errors = [];
const check = (c, m, x) => { if (!c) fails.push({ m, ...x }); return c; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function player(nick) {
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(`${nick}: ${e.message}`));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(base + '#local');
  await page.evaluate(() => { OnlineUI.session.auto = false; CFG.fast = true; });
  await page.click('#onlineBtn'); await page.fill('#onNick', nick);
  return page;
}
const a = await player('가나'), b = await player('다라');
await a.evaluate(() => { OnlineUI.form.tl = 4; });                 // 시험용으로 짧게(화면 선택지는 30초부터)
await a.click('[data-act="create"]'); await a.waitForSelector('.code-big');
const code = (await a.textContent('.code-big')).trim();
await b.fill('#onCode', code); await b.click('[data-act="join"]'); await b.waitForSelector('.code-big');
await a.waitForFunction(() => document.querySelectorAll('.mem').length >= 2);
check(/제한 4초/.test(await a.textContent('#onBody')), '대기실에 제한 시간 표시', {});
await a.click('[data-act="start"]');

const modalUp = p => p.evaluate(() => !document.querySelector('#modal').hidden && !!document.querySelector('#modal .augcard'));
const waitFor = async (fn, ms = 30000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await sleep(100); } return false; };
check(await waitFor(async () => (await modalUp(a)) && (await modalUp(b))), '증강 선택창이 두 기기에 동시에 뜸', {});
console.log('dbg-state', JSON.stringify(await Promise.all([a,b].map(p => p.evaluate(() => ({ g: !!window.G, phase: OnlineUI.session.core && OnlineUI.session.core.phase, host: OnlineUI.session.core && OnlineUI.session.core.hostPh, err: OnlineUI.error, notice: OnlineUI.notice }))))));
check(await a.evaluate(() => !document.querySelector('#timerBadge').hidden && /초/.test(document.querySelector('#timerBadge').textContent)), '제한 시간 표시(상단)', {});
check(await a.evaluate(() => !!document.querySelector('#modal .mtimer') && /초/.test(document.querySelector('#modal .mtimer').textContent)), '제한 시간 표시(선택창 안)', {});
await a.screenshot({ path: 'tests/e2e/out/online-sim-draft.png' });
// A 가 먼저 고른다 → A 는 "고르는 중" 안내, B 의 선택창은 그대로
console.log('debug0', JSON.stringify(await a.evaluate(() => ({ G: !!window.G, title: !document.querySelector('#title').hidden, online: !document.querySelector('#online').hidden, err: OnlineUI.error, body: document.querySelector('#onBody').textContent.slice(0, 120) }))));
console.log('debug', JSON.stringify(await a.evaluate(() => G && ({ hidden: document.querySelector('#modal').hidden, cards: document.querySelectorAll('#modal .augcard').length, sheet: document.querySelector('#modal').className, draft: !!G.draft, log: G.log.slice(-3), mbox: document.querySelector('#mbox').innerHTML.slice(0, 200) }))));
await a.click('#modal [data-card="0"]', { timeout: 5000 });
check(await waitFor(async () => /고르는 중/.test(await a.textContent('#chips'))), '먼저 고른 사람에게 "고르는 중" 안내', { chips: await a.textContent('#chips') });
check(await modalUp(b), '아직 안 고른 사람의 선택창은 그대로', {});
await a.screenshot({ path: 'tests/e2e/out/online-sim-waiting.png' });
await b.click('#modal [data-card="1"]');
// 고른 증강에 따라 추가 선택·확인창이 뜰 수 있으니(거머리·내려 등) 뜨는 대로 첫 선택지를 눌러 준다
const clickThrough = p => p.evaluate(() => { const m = document.querySelector('#modal'); if (m.hidden) return false; const x = m.querySelector('[data-i]:not([disabled]), .mbtn.primary:not([disabled])'); if (x) { x.click(); return true; } return false; });
const drafted = await waitFor(async () => { await clickThrough(a); await clickThrough(b); return (await a.evaluate(() => !G.draft)) && (await b.evaluate(() => !G.draft)); });
check(drafted, '둘 다 고르면 증강 선택이 끝남', { st: drafted ? null : await Promise.all([a, b].map(p => p.evaluate(() => ({ draft: !!G.draft, k: OnlineUI.session.bridge.k, pend: [...OnlineUI.session.bridge.pendings.values()], modal: !document.querySelector('#modal').hidden, log: G.log.slice(-3), chips: document.querySelector('#chips').textContent })))) });
const got = await Promise.all([a, b].map(p => p.evaluate(() => G.players.map(q => q.augs.length).join('/'))));
check(got[0] === got[1] && /^[1-9]\/[1-9]/.test(got[0]), '양쪽 판에 같은 증강이 들어감', { got });

// 제한 시간: 아무도 안 누르면 AI 가 대신 둔다
check(await waitFor(async () => (await a.evaluate(() => G.log.some(l => /시간 초과/.test(l)))), 25000), '제한 시간이 지나면 시간 초과 기록', {});
const logs = await Promise.all([a, b].map(p => p.evaluate(() => ({ h: hashState(), t: G.log.filter(l => /시간 초과/.test(l)).length }))));
await sleep(1500);
const hs = await Promise.all([a, b].map(p => p.evaluate(() => G.log.join('\n'))));
check(hs[0].split('\n').filter(l => /시간 초과/.test(l)).length === hs[1].split('\n').filter(l => /시간 초과/.test(l)).length, '두 기기의 시간 초과 기록이 같음', {});
check(!errors.length, '콘솔 오류 없음', { errors: errors.slice(0, 3) });
console.log(`동시 선택·제한 시간 화면 시험: 시간 초과 기록 ${hs[0].split('\n').filter(l => /시간 초과/.test(l)).length}번`);
await browser.close();
if (fails.length) { console.log('실패', JSON.stringify(fails, null, 1)); process.exit(1); }
console.log('동시 선택·제한 시간 화면 시험 통과');
