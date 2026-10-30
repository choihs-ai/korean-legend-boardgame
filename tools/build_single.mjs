#!/usr/bin/env node
// 아티팩트용 단일 파일 만들기: 모듈·글꼴·화면을 한 파일(dist/augyut-single.html)로 묶는다.
// Claude 아티팩트는 외부 파일과 외부 연결을 막으므로 글꼴은 data URI 로, 스크립트는 한 덩어리로 넣는다.
// 사용: (cd tools/build && npm install) && node tools/build_single.mjs
// 출력은 <title>·<style>·본문·<script> 만 담는다(문서·head·body 태그는 게시 도구가 감싼다).
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const req = createRequire(path.join(ROOT, 'tools', 'build', 'package.json'));
const esbuild = req('esbuild');

const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const title = /<title>([^<]*)<\/title>/.exec(html)[1];
let css = /<style>([\s\S]*?)<\/style>/.exec(html)[1];
let body = /<body[^>]*>([\s\S]*)<\/body>/.exec(html)[1].replace(/<script[^>]*src="src\/main\.js"[^>]*><\/script>/, '').trim();

// 글꼴 파일 → data URI
css = css.replace(/url\((fonts\/[^)]+\.woff2)\)/g, (m, f) => `url(data:font/woff2;base64,${fs.readFileSync(path.join(ROOT, f)).toString('base64')})`);

const out = esbuild.buildSync({
  entryPoints: [path.join(ROOT, 'src', 'main.js')], bundle: true, format: 'iife', write: false, minify: true, target: 'es2020',
  define: { __SINGLE__: 'true' }, legalComments: 'none', charset: 'utf8',
});
const js = out.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');

const page = `<title>${title}</title>
<meta name="claude:viewport-fit-sides" content="cover">
<style>
${css}
</style>
${body}
<script>
${js}
</script>
`;
fs.mkdirSync(path.join(ROOT, 'dist'), { recursive: true });
const file = path.join(ROOT, 'dist', 'augyut-single.html');
fs.writeFileSync(file, page);
console.log(`${path.relative(ROOT, file)} ${(page.length / 1024).toFixed(0)}KB (스크립트 ${(js.length / 1024).toFixed(0)}KB, 글꼴 포함)`);
