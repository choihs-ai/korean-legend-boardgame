// Playwright 를 전역 설치본에서 불러온다(저장소에 의존성을 두지 않기 위해).
// ES 모듈은 file:// 에서 돌지 않으므로 GitHub Pages 와 같은 하위 경로로 저장소를 서빙한다.
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
export const { chromium } = require('playwright');
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const BASE = '/korean-legend-boardgame/';

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.woff2': 'font/woff2', '.css': 'text/css' };

// GAME_URL 을 주면 그 주소(예: 배포된 페이지)를 쓰고, 아니면 로컬 서버를 띄운다
export async function serve() {
  if (process.env.GAME_URL) return process.env.GAME_URL;
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
  server.unref();
  return `http://127.0.0.1:${server.address().port}${BASE}`;
}
