// 오프라인 캐시 검증: 하위 경로(/korean-legend-boardgame/)로 서빙 → 서비스 워커 등록 → 오프라인에서 새로고침해도 열리는지.
// 사용: node tests/e2e/offline.mjs
import { chromium, serve } from './pw.mjs';

const url = await serve();
const browser = await chromium.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.goto(url);
const swOk = await page.evaluate(async () => { const r = await navigator.serviceWorker.ready; return !!r.active; });
await page.reload();
await page.waitForTimeout(500);
await ctx.setOffline(true);
await page.reload();
const title = await page.title();
const startVisible = await page.isVisible('#startBtn');
const manifest = await page.evaluate(() => document.querySelector('link[rel=manifest]').href);
await browser.close();
console.log(JSON.stringify({ swOk, offlineTitle: title, startVisible, manifest, errors }));
if (!swOk || !startVisible || errors.length) process.exit(1);
console.log('오프라인 캐시 통과');
