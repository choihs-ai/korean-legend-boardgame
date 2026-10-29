// AI 차례 중 판을 탭하면 남은 연출을 건너뛰는지 확인.
// 사용: node tests/e2e/skip.mjs
import { chromium, PAGE_URL } from './pw.mjs';

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true })).newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.goto(PAGE_URL);
await page.evaluate(() => localStorage.clear());
await page.reload();
// 사람 1 + AI 3, 일반 속도. 증강 선택은 바로 첫 카드로.
await page.evaluate(() => { Object.assign(CFG, { n: 4, slots: ['human', 'ai', 'ai', 'ai'], fast: false, chaos: false }); startGame(); });
// 사람에게 오는 선택(증강 카드, 가림막, 선택지, 칸 고르기)은 무엇이든 첫 항목으로 답한다
const pickCard = async () => {
  if (await page.isVisible('#blind')) { await page.click('#blind'); return; }
  if (await page.isVisible('#mbox .augcard:not([disabled])')) { await page.click('#mbox .augcard:not([disabled])'); return; }
  if (await page.isVisible('#mbox .mbtn:not([disabled]):not(.ghost)')) { await page.click('#mbox .mbtn:not([disabled]):not(.ghost)'); return; }
  await page.evaluate(() => { if (UI.pick) { const r = UI.pick.res, n = [...UI.pick.set][0]; UI.endPick(); r(n); } });
};
// 내 차례가 올 때까지 증강 선택 처리 후, 첫 차례에 윷을 던지고 말을 움직여 AI 차례로 넘긴다
for (let i = 0; i < 200; i++) {
  await pickCard();
  const st = await page.evaluate(() => ({ wait: !!UI.wait, tl: G.T && G.T.throwsLeft, chips: G.T ? G.T.chips.length : 0, pid: G.T && G.T.pid }));
  if (st.wait && st.tl > 0) { await page.click('#throwBtn'); continue; }
  if (st.wait && st.chips) { await page.evaluate(() => { const p = UI.wait.p; const l = movableLeads(p, G.T.chips[UI.sel ?? 0])[0]; UI.submit({ type: 'move', chip: UI.sel ?? 0, piece: l }); }); continue; }
  if (st.wait) { await page.evaluate(() => UI.submit({ type: 'end' })); continue; }
  if (st.pid != null && st.pid !== 0) break;
  await page.waitForTimeout(100);
}
// 지금은 AI 차례: 판을 탭해 건너뛰고, 다음 사람 입력까지 걸린 시간을 잰다
let can = false;
for (let i = 0; i < 100 && !can; i++) {
  can = await page.evaluate(() => UI.canSkip());
  if (!can) { await pickCard(); await page.waitForTimeout(100); }
}
if (!can) {
  const st = await page.evaluate(() => ({ wait: !!UI.wait, pick: !!UI.pick, modal: !$('#modal').hidden, modalTitle: $('#mbox').textContent.slice(0, 60), blind: !$('#blind').hidden, T: G.T && G.T.pid, turnIdx: G.turnIdx, draft: !!G.draft, over: G.over, SKIP, log: G.log.slice(-4) }));
  console.log('건너뛸 수 있는 상태가 오지 않음', JSON.stringify(st));
  await browser.close();
  process.exit(1);
}
const box = await page.locator('#board').boundingBox();
const t0 = Date.now();
await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
const skipped = await page.evaluate(() => SKIP);
await page.waitForFunction(() => (UI.wait && UI.wait.p.id === 0) || !$('#modal').hidden || G.over, null, { timeout: 15000 });
const ms = Date.now() - t0;
const reset = await page.evaluate(() => SKIP);
await browser.close();
console.log(JSON.stringify({ skipped, msUntilMyInput: ms, skipResetForHuman: reset === false, errors }));
// AI 3명이 연출 없이 두면 수 초 안에 사람 차례가 돌아와야 한다
if (!skipped || reset !== false || ms > 6000 || errors.length) process.exit(1);
console.log('AI 연출 건너뛰기 통과');
