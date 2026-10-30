import { bumpGen, CFG, G, io, SKIP } from './state.js';
import { $ } from './util.js';
import { SFX } from './sound.js';
import { flushSave, hashState } from './save.js';
import { finishGame, movableLeads, P, resumeGame, startGame } from './rules.js';
import { animateMove, R } from './render.js';
import { UI } from './ui.js';
import { OnlineUI } from './net/online-ui.js';

/* =====================================================================
   22. 시작
   ===================================================================== */
// 화면 어댑터 연결: 규칙 코드는 io 를 통해서만 화면·소리를 부른다
io.ui = UI;
io.r = R;
io.sfx = SFX;
io.animateMove = animateMove;
UI.init();
R.init();
OnlineUI.init();
UI.buildTitle();
document.addEventListener('visibilitychange', () => {
  if (document.hidden) flushSave();
  else if (SFX.ctx && SFX.ctx.state === 'suspended') SFX.ctx.resume();
});
window.addEventListener('pagehide', flushSave);
// 오프라인 캐시(웹 서버에서 열었을 때만)
// (아티팩트용 단일 파일에서는 서비스 워커를 쓸 수 없어 빌드할 때 __SINGLE__ 을 켜서 뺀다)
if (typeof __SINGLE__ === 'undefined' && 'serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => {}); });
}


// 테스트·디버그용 손잡이 (브라우저 콘솔과 Playwright 테스트에서 사용)
Object.defineProperty(window, 'G', { get: () => G, configurable: true });
Object.defineProperty(window, 'SKIP', { get: () => SKIP, configurable: true });
Object.assign(window, { CFG, UI, R, P, $, startGame, resumeGame, finishGame, movableLeads, abortGame: bumpGen, OnlineUI, hashState });
