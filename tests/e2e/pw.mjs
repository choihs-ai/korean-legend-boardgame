// Playwright 를 전역 설치본에서 불러온다(저장소에 의존성을 두지 않기 위해).
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
export const { chromium } = require('playwright');
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const PAGE_URL = process.env.GAME_URL || 'file://' + path.join(ROOT, 'index.html');
