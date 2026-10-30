// DOM 없이 규칙 모듈만 돌리기 위한 화면 대역. 모든 선택은 AI 가 하고, 연출은 즉시 끝낸다.
import { G, io, setInstant } from '../../src/state.js';
import { AI } from '../../src/ai.js';
import { ALK } from '../../src/alkkagi.js';

const noop = () => {};
const pickAi = (o, fallback) => (o && o.ai ? o.ai() : fallback);

export const headlessUI = {
  sel: null,
  async choose(p, title, options, o = {}) { return pickAi(o, (options.find(x => !x.disabled) || {}).value); },
  async choosePlayer(p, title, cands, o = {}) { return pickAi(o, cands[0]); },
  async pickNode(p, nodes, msg, o = {}) { return pickAi(o, nodes[0]); },
  async pickStack(p, stacks, msg, o = {}) { return pickAi(o, stacks[0]); },
  async pickPiece(p, cands, msg, o = {}) { return pickAi(o, cands[0]); },
  async cover() {},
  async alert() {},
  async draftPick(p, opts, forced) { return AI.pickAug(p, opts, forced); },
  async waitAction(p) { throw new Error(`사람 차례(${p.name})는 헤드리스에서 진행할 수 없습니다`); },
  async alkShot(p, discs) { return ALK.shotAI(p, discs); },
  async showThrow() {},
  async flyStick() {},
  refresh: noop, flash: noop, toast: noop, banner: noop, hideBanner: noop, ticker: noop,
  closeAll: noop, enterGame: noop, buildTitle: noop, results: noop,
};

export const headlessR = {
  dirty: false,
  fxText: noop, fxRing: noop, fxBoom: noop,
  async fxShot() {}, async fxNova() {}, async fxDiagBlast() {},
  async animRotate() {}, async animFold() {},
  // 알까기는 결과를 미리 계산해 두므로 재생 없이 끝 상태로
  async wait(pred) {
    if (G && G.alk && G.alk.phase === 'sim') ALK.finish();
    if (!pred()) throw new Error('R.wait: 조건이 충족되지 않음');
  },
};

export function installHeadless() {
  io.ui = headlessUI;
  io.r = headlessR;
  io.sfx = { play: noop, init: noop };
  io.animateMove = () => Promise.resolve();
  setInstant(true);
}
