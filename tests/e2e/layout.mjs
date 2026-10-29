// 화면 점검: 아이폰 SE, 아이폰 15, 아이패드 가로에서 스크린샷을 찍고
// 가로 스크롤, 44px 미만 터치 영역, 13px 미만 글씨를 찾는다.
// 사용: node tests/e2e/layout.mjs [--strict]
import fs from 'node:fs';
import { chromium, serve } from './pw.mjs';

const PAGE_URL = await serve();

const STRICT = process.argv.includes('--strict');
const OUT = 'tests/e2e/out';
fs.mkdirSync(OUT, { recursive: true });
const VIEWPORTS = { 'iphone-se': { width: 375, height: 667 }, 'iphone-15': { width: 390, height: 844 }, 'ipad-landscape': { width: 1180, height: 820 } };

const AUDIT = () => {
  const vis = el => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.05; };
  const inView = el => { const r = el.getBoundingClientRect(); return r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth; };
  const name = el => (el.id ? '#' + el.id : el.className ? '.' + String(el.className).split(' ')[0] : el.tagName) + ' "' + (el.textContent || '').trim().slice(0, 18) + '"';
  const small = [];
  for (const el of document.querySelectorAll('button, a[href], input:not([type=hidden]), select, label.switch-row, [role=button], .pcard')) {
    if (!vis(el) || el.closest('[hidden]')) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 44 - 0.5 || r.height < 44 - 0.5) small.push(`${name(el)} ${Math.round(r.width)}x${Math.round(r.height)}`);
  }
  const tiny = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const seen = new Set();
  while (walker.nextNode()) {
    const t = walker.currentNode;
    if (!t.textContent.trim()) continue;
    const el = t.parentElement;
    if (!el || seen.has(el) || el.closest('script,style,[hidden]') || !vis(el) || !inView(el)) continue;
    seen.add(el);
    const fs = parseFloat(getComputedStyle(el).fontSize);
    if (fs < 13 - 0.01) tiny.push(`${name(el)} ${fs}px`);
  }
  const hscroll = [document.documentElement, document.body, ...document.querySelectorAll('.screen, .mbox')]
    .filter(el => vis(el) && el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX !== 'hidden')
    .map(el => `${name(el)} ${el.scrollWidth}>${el.clientWidth}`);
  if (document.documentElement.scrollWidth > innerWidth + 1) hscroll.push(`page ${document.documentElement.scrollWidth}>${innerWidth}`);
  return { small, tiny, hscroll };
};

// 게임 화면을 사람 차례(결과 칩, 대기 말, 액티브 증강이 보이는 상태)로 만든다
const SETUP_GAME = async () => {
  Object.assign(CFG, { n: 4, slots: ['human', 'ai', 'human', 'ai'], fast: true });
  startGame().catch(() => {});
  await new Promise(r => setTimeout(r, 300));
  abortGame(); UI.closeAll(); G.needDraft = false; G.draft = null; G.round = 5;
  const P0 = P(0);
  P0.augs = ['shield', 'hand', 'sniper', 'grail'].map(id => ({ id, used: false, disabled: false, catUntil: 0 }));
  P(1).augs = [{ id: 'coup' }, { id: 'fisher' }, { id: 'queen', used: true }];
  P(2).augs = [{ id: 'demon' }, { id: 'score' }];
  P0.pieces[0].pos = 3; P0.pieces[1].pos = 8; P(1).pieces[0].pos = 12; P(2).pieces[0].pos = 22; P(3).pieces[0].pos = 18;
  G.log.push('[5R] P2이(가) P1의 말 1개를 잡았습니다!', '[5R] P3: 윷 — 한 번 더!', '[5R] P4: 개');
  G.T = { pid: 0, throwsLeft: 0, chips: [4, -1, 2], counts: {}, fresh: false, aiTried: new Set() };
  UI.wait = { p: P0, res: () => {} }; UI.sel = 0; UI.refresh();
};

const browser = await chromium.launch();
const report = {};
let problems = 0;
for (const [vpName, vp] of Object.entries(VIEWPORTS)) {
  const page = await (await browser.newContext({ viewport: vp, deviceScaleFactor: 2, hasTouch: true })).newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(PAGE_URL);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForTimeout(400);
  const screens = {};
  await page.screenshot({ path: `${OUT}/${vpName}-title.png` });
  screens.title = await page.evaluate(AUDIT);
  await page.evaluate(SETUP_GAME);
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/${vpName}-game.png` });
  screens.game = await page.evaluate(AUDIT);
  await page.evaluate(() => { UI.wait = null; UI.draftPick(P(0), ['cannon', 'four', 'kim'], false, { k: 0, times: 1, cat: 'start' }); });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/${vpName}-draft.png` });
  screens.draft = await page.evaluate(AUDIT);
  await page.click('#mbox [data-peek]');
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/${vpName}-draft-peek.png` });
  await page.evaluate(() => { UI.closeModal(); UI.book(); });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/${vpName}-book.png` });
  screens.book = await page.evaluate(AUDIT);
  await page.evaluate(() => { UI.closeInfo(); G.moments = [{ score: 30, round: 5, text: '5라운드, P2이(가) 잡기로 P1·P3의 말 3개를 한 번에 잡음' }]; P(1).st.capt = 3; P(0).st.lost = 2; finishGame(); });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/${vpName}-results.png` });
  screens.results = await page.evaluate(AUDIT);
  for (const [k, v] of Object.entries(screens)) problems += v.small.length + v.tiny.length + v.hscroll.length;
  report[vpName] = { errors, screens };
  await page.close();
}
await browser.close();
for (const [vpName, r] of Object.entries(report)) {
  console.log(`== ${vpName}${r.errors.length ? ' 오류: ' + r.errors.join(' / ') : ''}`);
  for (const [sc, v] of Object.entries(r.screens)) {
    console.log(`  ${sc}: 가로스크롤 ${v.hscroll.length}, 44px 미만 ${v.small.length}, 13px 미만 ${v.tiny.length}`);
    for (const x of [...v.hscroll, ...v.small.slice(0, 6), ...v.tiny.slice(0, 6)]) console.log('     - ' + x);
  }
}
console.log(problems ? `문제 ${problems}건` : '문제 0건');
if (STRICT && problems) process.exit(1);
