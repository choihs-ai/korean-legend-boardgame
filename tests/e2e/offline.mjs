// 오프라인 캐시 검증: 하위 경로(/korean-legend-boardgame/)로 서빙 → 서비스 워커 등록 → 오프라인에서 새로고침해도 열리는지.
// 사용: node tests/e2e/offline.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium, ROOT } from './pw.mjs';

const BASE = '/korean-legend-boardgame/';
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.woff2': 'font/woff2', '.css': 'text/css' };
const server = http.createServer((req, res) => {
  let u = decodeURIComponent(req.url.split('?')[0]);
  if (!u.startsWith(BASE)) { res.writeHead(404); return res.end(); }
  u = u.slice(BASE.length) || 'index.html';
  const f = path.join(ROOT, u);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}${BASE}`;
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
server.close();
console.log(JSON.stringify({ swOk, offlineTitle: title, startVisible, manifest, errors }));
if (!swOk || !startVisible || errors.length) process.exit(1);
console.log('오프라인 캐시 통과');
