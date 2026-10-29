// 윷 모양 앱 아이콘(PNG)을 캔버스로 그려 icons/ 에 저장한다.
// 사용: node tools/make_icons.mjs   (전역 Playwright 필요)
import fs from 'node:fs';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');

const draw = (S) => {
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const x = c.getContext('2d');
  x.fillStyle = '#1d1c1a';
  x.fillRect(0, 0, S, S);
  // 단청 오방색 띠
  const cols = ['#2f64a8', '#b5341f', '#d6a21f', '#ece6d6', '#111'];
  const bw = S * 0.62 / 5;
  cols.forEach((col, i) => { x.fillStyle = col; x.fillRect(S * 0.19 + i * bw, S * 0.83, bw, S * 0.045); });
  // 윷가락 4개: 평평한 면(한지)과 둥근 면(나무)을 번갈아
  const w = S * 0.11, h = S * 0.56, r = w / 2;
  const xs = [0.27, 0.42, 0.58, 0.73], rots = [-12, -4, 4, 12];
  xs.forEach((cx, i) => {
    x.save();
    x.translate(S * cx, S * 0.47);
    x.rotate(rots[i] * Math.PI / 180);
    x.beginPath();
    x.moveTo(-w / 2 + r, -h / 2); x.arcTo(w / 2, -h / 2, w / 2, h / 2, r); x.arcTo(w / 2, h / 2, -w / 2, h / 2, r);
    x.arcTo(-w / 2, h / 2, -w / 2, -h / 2, r); x.arcTo(-w / 2, -h / 2, w / 2, -h / 2, r); x.closePath();
    const flat = i % 2 === 1;
    x.fillStyle = flat ? '#e7dec6' : '#6b4424';
    x.fill();
    x.lineWidth = S * 0.018; x.strokeStyle = '#111'; x.stroke();
    if (flat) {
      x.strokeStyle = '#5a4f40'; x.lineWidth = S * 0.012;
      for (const yy of [-0.12, 0.12]) { x.beginPath(); x.moveTo(-w * 0.32, S * yy - w * 0.2); x.lineTo(w * 0.32, S * yy + w * 0.2); x.stroke(); }
    }
    x.restore();
  });
  return c.toDataURL('image/png');
};

const browser = await chromium.launch();
const page = await browser.newPage();
fs.mkdirSync('icons', { recursive: true });
for (const S of [180, 192, 512]) {
  const url = await page.evaluate(draw, S);
  fs.writeFileSync(`icons/icon-${S}.png`, Buffer.from(url.split(',')[1], 'base64'));
  console.log(`icons/icon-${S}.png`);
}
await browser.close();
