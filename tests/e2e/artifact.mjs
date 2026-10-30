// 아티팩트용 단일 파일 시험: 빌드한 한 파일을 열고, 모의 Claude room 으로 두세 탭이 방을 만들어 한 판을 끝까지 둔다.
// 외부로 나가는 요청이 없는지, room 의 presence 한도(4KiB)를 지키는지도 본다.
// 사용: node tests/e2e/artifact.mjs   (먼저 node tools/build_single.mjs)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { chromium, ROOT } from './pw.mjs';

execFileSync('node', [path.join(ROOT, 'tools', 'build_single.mjs')], { stdio: 'inherit' });
const body = fs.readFileSync(path.join(ROOT, 'dist', 'augyut-single.html'), 'utf8');
// 게시 도구가 감싸 주는 문서 틀을 흉내 낸다
const doc = `<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><style>:root{color-scheme:light;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0;font:14px system-ui}[hidden]{display:none!important}</style></head><body>${body}</body></html>`;
const server = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(doc); });
await new Promise(r => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/`;

const browser = await chromium.launch();
const fails = [], errors = [], external = [];
const check = (c, m, x) => { if (!c) fails.push({ m, ...x }); return c; };
const ctx = await browser.newContext();
await ctx.addInitScript({ path: path.join(ROOT, 'tests', 'e2e', 'claude-mock.js') });
async function player(nick) {
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(`${nick}: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error') errors.push(`${nick}: ${m.text()}`); });
  page.on('request', r => { if (!r.url().startsWith(url) && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) external.push(r.url()); });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(url);
  await page.evaluate(() => { OnlineUI.session.auto = true; OnlineUI.session.alwaysInstant = true; });
  await page.click('#onlineBtn'); await page.fill('#onNick', nick);
  return page;
}
const waitAll = async (pages, fn, ms = 120000) => { const t = Date.now(); while (Date.now() - t < ms) { if ((await Promise.all(pages.map(fn))).every(Boolean)) return true; await new Promise(r => setTimeout(r, 300)); } return false; };

const a = await player('가나'); const b = await player('다라'); const c = await player('마바');
check((await a.evaluate(() => document.querySelector('#onBody').textContent)).includes('Claude 에 로그인'), '아티팩트 안내 문구', {});
await a.click('[data-act="hu"][data-v="3"]'); await a.click('[data-act="create"]');
await a.waitForSelector('.code-big');
const code = (await a.textContent('.code-big')).trim();
for (const p of [b, c]) { await p.fill('#onCode', code); await p.click('[data-act="join"]'); await p.waitForSelector('.code-big', { timeout: 15000 }); }
check(await a.evaluate(() => OnlineUI.session.tx.name) === 'room', '아티팩트에서는 room 전송 선택', {});
check(await waitAll([a, b, c], async p => (await p.evaluate(() => document.querySelectorAll('.mem').length)) >= 3, 20000), '대기실 3명', {});
await a.click('[data-act="start"]');
const pages = [a, b, c];
check(await waitAll(pages, p => p.evaluate(() => !!(window.G && G.over)), 180000), '한 판 끝까지', {});
const snaps = await Promise.all(pages.map(p => p.evaluate(() => ({ h: hashState(), log: G.log.join('\n'), round: G.round, mock: window.__mock }))));
check(snaps.every(s => s.h === snaps[0].h && s.log === snaps[0].log), '세 탭의 판 상태 일치', { hs: snaps.map(s => s.h) });
check(snaps.every(s => s.mock.violations === 0), 'presence 한도·키 형식 위반 없음', { v: snaps.map(s => s.mock.violations) });
const maxBytes = Math.max(...snaps.map(s => s.mock.maxBytes));
check(external.length === 0, '외부 요청 없음', { external: external.slice(0, 3) });
// 로그인 안 한 경우
const lone = await ctx.newPage();
await lone.addInitScript(() => { window.__mock.signedOut = true; });
await lone.goto(url); await lone.evaluate(() => { window.__mock.signedOut = true; });
await lone.click('#onlineBtn'); await lone.fill('#onCode', 'ABCD'); await lone.click('[data-act="join"]');
check(await lone.waitForSelector('.on-err', { timeout: 10000 }).then(() => true, () => false) && /로그인/.test(await lone.textContent('.on-err')), '로그인 안 한 보기: 안내 문구', {});
check(!errors.length, '콘솔 오류 없음', { errors: errors.slice(0, 3) });
console.log(`아티팩트 단일 파일: 3탭 ${snaps[0].round}라운드 완주, 일치=${snaps.every(s => s.h === snaps[0].h)}, presence 최대 ${maxBytes}바이트, 외부 요청 ${external.length}건`);
await browser.close(); server.close();
if (fails.length) { console.log('실패', JSON.stringify(fails, null, 1)); process.exit(1); }
console.log('아티팩트 시험 통과');
process.exit(0);
