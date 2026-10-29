// 이어하기 검증(브라우저): 게임 도중 저장 → 새로고침 → 이어하기 → 같은 상태인지 확인.
// 사용: node tests/e2e/resume.mjs
import { chromium, serve } from './pw.mjs';

const PAGE_URL = await serve();

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.goto(PAGE_URL);
await page.evaluate(() => localStorage.clear());
await page.reload();
// AI 4명, 빠르게
await page.evaluate(() => { Object.assign(CFG, { n: 4, slots: ['ai', 'ai', 'ai', 'ai'], fast: true, chaos: false }); startGame(); });
await page.waitForFunction(() => G && G.round >= 3 && localStorage.getItem('augyut-save-v1'), null, { timeout: 180000 });
const saved = await page.evaluate(() => localStorage.getItem('augyut-save-v1'));
await page.reload();
const visible = await page.isVisible('#resumeBtn');
const label = visible ? (await page.textContent('#resumeBtn')).trim() : '';
await page.click('#resumeBtn');
await page.waitForFunction(() => window.__resumeCheck, null, { timeout: 5000 });
const same = await page.evaluate(s => window.__resumeCheck === s, saved);
const round = await page.evaluate(() => G.round);
await page.screenshot({ path: 'tests/e2e/out/resume.png' }).catch(() => {});
await browser.close();
console.log(JSON.stringify({ resumeButton: visible, label, sameState: same, round, errors }));
if (!visible || !same || errors.length) process.exit(1);
console.log('브라우저 이어하기 통과');
