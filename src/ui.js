import { bumpGen, CFG, G, GEN, NET, setG, setSkip, SKIP } from './state.js';
import { $, DONE, DRAFT_ROUNDS, esc, HOME, KIM_TURNS, noEmoji, PCNAME, PCOL, pick, resName, sleep, TYPE_ICON, TYPE_NAME, WIN_FROM_ROUND } from './util.js';
import { AUG_BY, AUGS, CAT_NAME, KIND_NAME } from './augs.js';
import { SFX } from './sound.js';
import { loadRecords, readSave } from './save.js';
import { aug, availableActions, buildSummary, canon, computePath, doneCount, has, isBound, modValue, movableLeads, needPieces, onBoard, P, pieceLabel, piecesAt, resumeGame, stackOf, startGame, stickCount } from './rules.js';
import { AI } from './ai.js';
import { R } from './render.js';

/* =====================================================================
   20. UI
   ===================================================================== */
export const UI = {
  sel: null, wait: null, pick: null, modalRes: null, _ft: 0, confirmQuit: false,
  remote: null,   // 온라인: 지금 입력을 기다리는 다른 사람의 좌석(플레이어)
  net: null,      // 온라인 세션 (main.js 에서 연결)
  init() {
    $('#countSeg').addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      CFG.n = +b.dataset.n; this.saveCfg(); this.buildTitle();
    });
    $('#slots').addEventListener('click', e => {
      const b = e.target.closest('button[data-slot]'); if (!b) return;
      CFG.slots[+b.dataset.slot] = b.dataset.v; this.saveCfg(); this.buildTitle();
    });
    $('#diffSeg').addEventListener('click', e => {
      const b = e.target.closest('button[data-d]'); if (!b) return;
      CFG.difficulty = b.dataset.d; this.saveCfg(); this.buildTitle();
    });
    for (const [id, key] of [['#optChaos', 'chaos'], ['#optFirst', 'endOnFirst'], ['#optFast', 'fast'], ['#optGather', 'gather']]) {
      $(id).addEventListener('change', e => { CFG[key] = e.target.checked; this.saveCfg(); });
    }
    $('#optSound').addEventListener('change', e => { SFX.on = e.target.checked; CFG.sound = SFX.on; this.saveCfg(); });
    $('#startBtn').addEventListener('click', () => { SFX.init(); SFX.play('aug'); startGame(); });
    $('#resumeBtn').addEventListener('click', () => { SFX.init(); SFX.play('aug'); resumeGame(); });
    $('#onlineBtn').addEventListener('click', () => { SFX.init(); SFX.play('click'); if (this.openOnline) this.openOnline(); });
    $('#rulesBtn1').addEventListener('click', () => this.rules());
    $('#bookBtn1').addEventListener('click', () => this.book());
    $('#chips').addEventListener('click', e => {
      const t = e.target.closest('button[data-take]');
      if (t && this.net) { SFX.play('click'); this.net.takeover(+t.dataset.take); return; }
      const b = e.target.closest('button[data-ci]'); if (!b || b.disabled) return;
      this.sel = +b.dataset.ci; SFX.play('click'); this.refresh();
    });
    $('#throwBtn').addEventListener('click', () => { SFX.init(); if (this.wait && G.T && G.T.throwsLeft > 0) this.submit({ type: 'throw' }); });
    $('#homeRow').addEventListener('click', e => {
      const b = e.target.closest('button[data-pc]'); if (!b || b.disabled || !this.wait || this.sel == null) return;
      const p = this.wait.p, pc = p.pieces.find(x => x.id === +b.dataset.pc);
      if (pc) this.submit({ type: 'move', chip: this.sel, piece: pc });
    });
    $('#actives').addEventListener('click', e => {
      const b = e.target.closest('button[data-key]'); if (!b || !this.wait) return;
      SFX.play('click'); this.submit({ type: 'action', key: b.dataset.key });
    });
    $('#endBtn').addEventListener('click', () => { if (this.wait) this.submit({ type: 'end' }); });
    $('#ticker').addEventListener('click', () => this.logView());
    $('#players').addEventListener('click', e => {
      const b = e.target.closest('[data-pid]'); if (!b || !G) return;
      if (G.mask) { this.toast('지금은 정보가 감춰져 있어요'); return; }
      this.playerDetail(P(+b.dataset.pid));
    });
    $('#sndBtn').addEventListener('click', () => { SFX.init(); SFX.on = !SFX.on; CFG.sound = SFX.on; $('#optSound').checked = SFX.on; this.saveCfg(); this.refresh(); SFX.play('click'); });
    $('#bookBtn').addEventListener('click', () => this.book());
    $('#menuBtn').addEventListener('click', () => this.menu());
    $('#info').addEventListener('click', e => {
      if (e.target.id === 'info') { this.closeInfo(); return; }
      const b = e.target.closest('button[data-info]'); if (!b) return;
      SFX.play('click');
      const a = b.dataset.info;
      if (a === 'close') this.closeInfo();
      else if (a === 'book') this.book();
      else if (a === 'rules') this.rules();
      else if (a === 'log') this.logView();
      else if (a === 'quit') {
        if (!this.confirmQuit) { this.confirmQuit = true; b.textContent = '한 번 더 누르면 타이틀로 나갑니다'; b.classList.add('primary'); return; }
        this.toTitle();
      }
    });
    this.loadCfg();
    this.buildTitle();
  },
  loadCfg() {
    try {
      const s = JSON.parse(localStorage.getItem('augyut-cfg') || 'null');
      if (s) { Object.assign(CFG, { n: s.n || 4, slots: s.slots || CFG.slots, chaos: !!s.chaos, endOnFirst: !!s.endOnFirst, fast: !!s.fast, difficulty: ['easy', 'normal', 'hard'].includes(s.difficulty) ? s.difficulty : 'normal', gather: s.gather !== false }); if (s.sound === false) SFX.on = false; }
    } catch (e) { /* 저장소를 못 쓰면 기본값 사용 */ }
    $('#optGather').checked = CFG.gather;
    $('#optChaos').checked = CFG.chaos; $('#optFirst').checked = CFG.endOnFirst; $('#optFast').checked = CFG.fast; $('#optSound').checked = SFX.on;
  },
  saveCfg() { try { localStorage.setItem('augyut-cfg', JSON.stringify({ ...CFG, sound: SFX.on })); } catch (e) { /* 무시 */ } },
  buildTitle() {
    const snap = readSave(), rb = $('#resumeBtn');
    rb.hidden = !snap;
    if (snap) rb.innerHTML = `이어하기<small>${snap.G.round}라운드 · ${snap.G.players.length}인${snap.G.chaos ? ' · 혼돈' : ''}</small>`;
    $('#startBtn').textContent = snap ? '새 게임' : '판 펼치기';
    const og = this.net && this.net.savedGame ? this.net.savedGame() : null;
    $('#onlineBtn').innerHTML = og ? `온라인 대전<small>진행 중이던 방 ${esc(og.code)}이 있어요</small>` : '온라인 대전<small>방 코드로 친구와 함께 · 2~4명</small>';
    const rec = loadRecords(), seenN = AUGS.filter(a => rec.seen.includes(a.id)).length;
    $('#recordsLine').textContent = `전적 ${rec.games}판` + (rec.humanGames ? ` · 사람 승률 ${Math.round(rec.humanWins / rec.humanGames * 100)}% (${rec.humanWins}/${rec.humanGames})` : '') + ` · 증강 수집 ${seenN}/${AUGS.length}`;
    $('#bookBtn1').textContent = `증강 도감 ${seenN}/${AUGS.length}`;
    document.querySelectorAll('#countSeg button').forEach(b => b.classList.toggle('on', +b.dataset.n === CFG.n));
    document.querySelectorAll('#diffSeg button').forEach(b => b.classList.toggle('on', b.dataset.d === CFG.difficulty));
    $('#diffNote').textContent = { easy: '자주 실수하고 증강을 아무 때나 씁니다.', normal: '대체로 좋은 수를 두지만 가끔 빈틈이 있습니다.', hard: '말 위험도와 증강 효과를 끝까지 계산합니다.' }[CFG.difficulty];
    $('#slots').innerHTML = [0, 1, 2, 3].map(i => `<div class="slot"${i >= CFG.n ? ' hidden' : ''}>
      <i class="sdot" style="background:${PCOL[i]}"></i>
      <div class="sname">P${i + 1} ${PCNAME[i]}<small>${CFG.slots[i] === 'ai' ? '스마트 AI가 둡니다' : '이 기기를 터치해서 둡니다'}</small></div>
      <div class="seg"><button type="button" data-slot="${i}" data-v="human" class="${CFG.slots[i] === 'human' ? 'on' : ''}">사람</button><button type="button" data-slot="${i}" data-v="ai" class="${CFG.slots[i] === 'ai' ? 'on' : ''}">AI</button></div>
    </div>`).join('');
  },
  enterGame() {
    $('#title').hidden = true; $('#online').hidden = true; $('#game').hidden = false;
    $('#chaosBadge').hidden = !G.chaos;
    requestAnimationFrame(() => { R.resize(); this.refresh(); });
  },
  toTitle() {
    if (this.net && this.net.active) { const n = this.net; this.net = null; n.leave().finally(() => { this.net = n; }); }
    bumpGen();
    this.closeAll();
    setG(null);
    $('#game').hidden = true; $('#title').hidden = false;
    this.buildTitle();
  },
  closeAll() {
    this.closeModal(); this.closeInfo();
    $('#blind').hidden = true; $('#blind').onclick = null;
    this.hideBanner(); $('#sticks').hidden = true; $('#flash').hidden = true;
    this.wait = null; this.pick = null; this.sel = null;
    R.hl = null; R.movable = null; R.rot = null; R.fold = null;
  },
  toast(msg, color) {
    const t = document.createElement('div');
    t.className = 'toast'; if (color) t.style.setProperty('--tc', color);
    t.textContent = noEmoji(msg);
    const box = $('#toasts');
    const st = $('#stage'), bn = $('#banner');
    const below = !bn.hidden ? bn.getBoundingClientRect().bottom + 6 : (st ? st.getBoundingClientRect().top + 6 : 8);
    box.style.top = (!$('#game').hidden && st) ? Math.max(8, below) + 'px' : '';
    box.appendChild(t);
    while (box.children.length > 2) box.firstChild.remove();
    setTimeout(() => { t.classList.add('bye'); setTimeout(() => t.remove(), 320); }, 2200);
  },
  flash(text, color) {
    const f = $('#flash');
    f.innerHTML = '<span></span>';
    f.firstChild.textContent = noEmoji(text);
    f.firstChild.style.setProperty('--fc', color || '#b5341f');
    f.hidden = false; f.classList.remove('show'); void f.offsetWidth; f.classList.add('show');
    clearTimeout(this._ft); this._ft = setTimeout(() => { f.hidden = true; }, 1350);
  },
  ticker(msg) { const t = $('#ticker'); if (t) t.textContent = msg; },
  banner(msg, cancellable, onCancel) {
    $('#bannerTxt').textContent = msg;
    const b = $('#bannerCancel'); b.hidden = !cancellable; b.onclick = () => { SFX.play('click'); if (onCancel) onCancel(); };
    $('#banner').hidden = false;
  },
  hideBanner() { $('#banner').hidden = true; },

  /* ----- 화면 갱신 ----- */
  refresh() {
    if (!G || $('#game').hidden) return;
    this.topbar(); this.playersView(); this.controls(); this.sideView();
  },
  topbar() {
    $('#roundLbl').textContent = `${G.round}R`;
    const max = Math.max(DRAFT_ROUNDS[2] + 3, G.round + 1);
    let gh = '';
    for (let r = 1; r <= max; r++) gh += `<i class="${DRAFT_ROUNDS.includes(r) ? 'aug' : ''} ${r < G.round ? 'past' : ''} ${r === G.round ? 'now' : ''}"></i>`;
    $('#rGauge').innerHTML = gh;
    let tl = '';
    if (G.over) tl = '게임 종료';
    else if (G.draft) tl = `${G.round}라운드 증강 선택 중`;
    else if (G.T) { const p = P(G.T.pid); tl = `<i style="background:${G.mask ? '#8d929e' : p.color}"></i>${G.mask ? '???' : p.name} 차례<small> 투척 ${Math.max(0, G.T.throwsLeft)}${G.echo && G.echo.active ? (G.echoSecond ? ' · 메아리 2/2' : ' · 메아리 1/2') : ''}</small>`; }
    $('#turnLbl').innerHTML = tl;
    $('#sndBtn').classList.toggle('off', !SFX.on);
    this.netBadge();
  },
  netBadge() {
    const b = $('#netBadge');
    if (!NET.online || !this.net || !this.net.core) { b.hidden = true; return; }
    const core = this.net.core, live = core.ro.filter(sid => core.isLive(sid)).length, st = this.net.status;
    b.hidden = false;
    b.textContent = `온라인 ${live}/${core.ro.length}`;
    b.classList.toggle('warn', live < core.ro.length || (st && st.total && !st.connected));
  },
  playersView() {
    const el = $('#players');
    el.className = G.n === 3 ? 'np3' : '';
    el.innerHTML = G.players.map(q => this.pcard(q)).join('');
  },
  stats(q) {
    const s = [];
    const add = (label, val) => s.push(`<span class="st"><b>${esc(label)}</b>${esc(val)}</span>`);
    if (G.murder) add('체력', Math.max(0, q.st.hp));
    if (q.skip) add('건너뜀', q.skip);
    if (has(q, 'doberman')) add('개코인', q.st.dogCoins);
    if (has(q, 'demon')) add('의식', `${q.st.ritual}/12`);
    if (has(q, 'coup')) add('처치', `${q.st.kills}/4`);
    if (has(q, 'cowback')) add('빽도잡기', `${q.st.cow}/2`);
    if (has(q, 'score')) s.push(`<span class="st stamps" aria-label="악보">${[-1, 1, 2, 3, 4, 5].map(k => `<i class="${q.st.seen[k] ? 'on' : ''}">${resName(k)[0]}</i>`).join('')}</span>`);
    const g = G.garlics.find(x => x.owner === q.id); if (g && has(q, 'bear')) add('마늘', `${g.got}/3`);
    if (has(q, 'queen') && q.pieces.some(x => x.type === 'queen' && onBoard(x))) add('중전', `${q.st.queenThrows}/12`);
    if (has(q, 'kim') && q.pieces.some(x => x.type === 'kim' && x.pos !== DONE)) add('김첨지', q.st.kimSpoiled ? '실패' : `${q.st.kimTurns}/${KIM_TURNS}`);
    if (has(q, 'fisher')) add('어부', `${q.st.fish}/2`);
    if (has(q, 'jajin')) add('장단', `${q.st.geol % 2}/2`);
    if (q.domainPiece) add('영역', `${q.st.domainTurns}/2`);
    if (has(q, 'nofriend')) { const need = G.players.filter(x => x.id !== q.id && !x.out); add('친구', `${need.filter(x => q.st.nofriend[x.id]).length}/${need.length}`); }
    if (G.duel && G.duel.target === q.id) add('승부', `${G.duel.turns}/3`);
    if (q.host != null) add('거머리', P(q.host).name);
    if (q.ally != null) add('동맹', P(q.ally).name);
    if (q.reverse) add('방향', '역');
    if (stickCount(q) !== 4) add('윷', stickCount(q));
    if (G.T && G.T.pid === q.id && G.T.poisoned) add('성배', '독');
    if (G.T && G.T.pid === q.id && G.T.lastDance) add('이동', '×2');
    return s.join('');
  },
  pcard(q) {
    const masked = !!G.mask;
    const turn = G.T && G.T.pid === q.id && !G.over;
    const col = masked ? '#8d929e' : q.color;
    const need = needPieces(q).length;
    const waiting = q.pieces.filter(x => x.pos === HOME);
    const rk = q.rank ? (q.elim ? '탈락' : `${q.rank}위`) : '';
    const name = masked ? '???' : q.name;
    const waitDots = masked ? '' : waiting.slice(0, 6).map(x => `<i class="${x.type !== 'normal' ? 'sp' : ''}"></i>`).join('');
    const augs = masked ? '' : (() => {
      const list = q.augs.slice(-4).map(a => {
        const cat = a.catUntil && G.round < a.catUntil;
        return `<span class="atag ${a.used ? 'used' : ''} ${a.disabled ? 'dis' : ''} ${cat ? 'catd' : ''}">${esc(cat ? '고양이?' : AUG_BY[a.id].name)}</span>`;
      }).join('');
      return list + (q.augs.length > 4 ? `<span class="atag more">+${q.augs.length - 4}</span>` : '');
    })();
    const stats = masked ? '' : this.stats(q);
    const line = (stats ? `<span class="pc-stats">${stats}</span>` : '') + (augs ? `<span class="pc-augs">${augs}</span>` : '');
    return `<button type="button" class="pcard ${turn ? 'turn' : ''} ${q.out ? 'out' : ''}" style="--pc:${col}" data-pid="${q.id}" aria-label="${esc(name)} 상세">
      <div class="pc-top"><b>${esc(name)}</b><span class="who">${q.ai ? 'AI' : NET.online && q.id === NET.localSeat ? '나' : '사람'}</span><span class="waitdots" aria-label="대기 말">${waitDots}</span><span class="done">${masked ? '' : (rk ? esc(rk) + (q.badge ? ' ' + esc(q.badge) : '') + ' · ' : '') + (masked ? '' : `완주 ${doneCount(q)}/${need}`)}</span></div>
      <div class="pc-line">${line}</div>
    </button>`;
  },
  controls() {
    const T = G.T, p = T ? P(T.pid) : null;
    const human = !!(p && !p.ai && this.wait && this.wait.p === p);
    if (human && T.chips.length && (this.sel == null || this.sel >= T.chips.length)) this.sel = 0;
    if (!T || !T.chips.length) this.sel = null;
    let chips = '';
    if (T && T.chips.length) chips = T.chips.map((v, i) => `<button type="button" class="chip ${v < 0 ? 'neg' : ''} ${human && this.sel === i ? 'sel' : ''}" data-ci="${i}" ${human ? '' : 'disabled'}>${resName(v)}${modValue(p, v) !== v ? `<small> ${modValue(p, v)}칸</small>` : ''}</button>`).join('');
    else if (G.draft) chips = '<span class="hint">증강을 고르는 중…</span>';
    else if (p && p.ai) chips = `<span class="hint">${G.mask ? '???' : p.name} (AI) 두는 중${SKIP ? ' · 건너뛰는 중' : ' · 판을 탭하면 건너뛰기'}</span>`;
    else if (human && T.throwsLeft > 0) chips = '<span class="hint">윷을 던지세요</span>';
    else if (human) chips = '<span class="hint">증강을 쓰거나 턴을 마치세요</span>';
    if (this.remote && !this.remote.ai) {      // 온라인: 다른 사람의 입력을 기다리는 중
      const q = this.remote, live = !this.net || this.net.isLive(q.id);
      chips += `<span class="hint">${esc(q.name)}님이 ${G.draft ? '증강을 고르는' : '두는'} 중…${live ? '' : ' (연결이 끊긴 것 같아요)'}</span>` +
        (live ? '' : `<button type="button" class="mbtn" data-take="${q.id}">AI에게 맡기기</button>`);
    }
    $('#chips').innerHTML = chips;
    const tb = $('#throwBtn');
    tb.disabled = !(human && T.throwsLeft > 0);
    tb.textContent = T && T.throwsLeft > 1 ? `윷 던지기 ×${T.throwsLeft}` : '윷 던지기';
    const selV = human && this.sel != null ? T.chips[this.sel] : undefined;
    const movable = selV !== undefined ? movableLeads(p, selV) : [];
    let home = '';
    if (p && !G.mask) {
      const waiting = p.pieces.filter(x => x.pos === HOME);
      home = `<span class="hl">대기 ${waiting.length}</span>` + waiting.map(pc => {
        const ok = movable.includes(pc);
        return `<button type="button" class="token ${ok ? 'go' : ''}" style="--pc:${p.color}" data-pc="${pc.id}" ${ok ? '' : 'disabled'} aria-label="${esc(TYPE_NAME[pc.type])} 출발">${TYPE_ICON[pc.type] || ''}</button>`;
      }).join('') + `<span class="hl">완주 ${doneCount(p)}/${needPieces(p).length}</span>`;
    }
    $('#homeRow').innerHTML = home;
    const idleHuman = human && T.throwsLeft <= 0 && !T.chips.some(v => movableLeads(p, v).length);
    $('#endBtn').hidden = !idleHuman;
    $('#actives').innerHTML = human ? availableActions(p).map(a => `<button type="button" class="act ${a.fresh ? 'turnuse' : ''}" data-key="${a.key}">${esc(typeof a.label === 'function' ? a.label(p) : a.label)}${a.fresh ? ' · 차례 소모' : ''}</button>`).join('') : '';
    if (human && selV !== undefined) {
      const mv = new Map();
      for (const l of movable) {
        if (!onBoard(l)) continue;
        const r = computePath(l, modValue(p, selV), p, stackOf(l));
        mv.set(canon(l.pos), r.finished ? 'fin' : (r.path.length ? r.path[r.path.length - 1] : null));
      }
      R.movable = mv;
    } else R.movable = null;
  },

  /* ----- 차례 입력 ----- */
  sideView() {
    const el = $('#side');
    const p = G.T ? P(G.T.pid) : null;
    const logs = G.log.slice(-12).reverse().map(l => `<li>${esc(l.replace(/^\[\d+R\] /, ''))}</li>`).join('');
    let augs = '';
    if (p && !G.mask) {
      augs = p.augs.length ? p.augs.map(a => {
        const A = AUG_BY[a.id], cat = a.catUntil && G.round < a.catUntil;
        const st = a.disabled ? '무효' : cat ? '고양이로 착각 중' : a.used ? '사용함' : '';
        return `<div class="book-item"><div class="tags"><span class="tg ${A.kind}">${KIND_NAME[A.kind]}</span>${st ? `<span class="tg">${st}</span>` : ''}</div><b>${esc(A.name)}</b><p>${esc(A.desc)}</p><p class="h">${esc(A.how)}</p></div>`;
      }).join('') : '<p class="mdesc">아직 증강이 없습니다.</p>';
    }
    el.innerHTML = `<section><h3>최근 기록</h3><ol class="sidelog">${logs}</ol></section>` + (p && !G.mask ? `<section><h3>${esc(p.name)}의 증강</h3><div class="book-list">${augs}</div></section>` : '');
  },
  canSkip() {
    if (!G || G.over || SKIP || this.wait || this.pick || !$('#modal').hidden || !$('#blind').hidden) return false;
    if (G.alk) return G.alk.p.ai;
    if (G.T) return P(G.T.pid).ai;
    return G.draft ? true : P(G.turnIdx).ai; // 차례와 차례 사이에는 다음 차례 플레이어 기준
  },
  startSkip() {
    setSkip(true);
    if (G.anim) G.anim.t0 = -1e9;
    if (R.rot) R.rot.t0 = -1e9;
    if (R.fold) R.fold.t0 = -1e9;
    $('#sticks').hidden = true;
    this.toast('AI 연출을 건너뜁니다');
  },
  waitAction(p) {
    setSkip(false);
    return new Promise(res => {
      this.wait = { p, res };
      this.refresh();
    });
  },
  submit(act) {
    if (!this.wait) return;
    const w = this.wait;
    this.wait = null; R.movable = null;
    w.res(act);
    this.refresh();
  },
  tapNode(n) {
    if (n == null || !G) return;
    if (this.pick) {
      if (this.pick.set.has(n)) { const r = this.pick.res; this.endPick(); SFX.play('click'); r(n); }
      return;
    }
    if (this.wait && G.T && this.sel != null) {
      const p = this.wait.p, v = G.T.chips[this.sel];
      if (v === undefined) return;
      const leads = movableLeads(p, v).filter(x => onBoard(x) && canon(x.pos) === n);
      if (leads.length) this.submit({ type: 'move', chip: this.sel, piece: leads[0] });
      else if (piecesAt(n).some(x => x.owner === p.id)) this.toast(`그 말은 ${resName(v)}(으)로 움직일 수 없어요`);
    } else if (this.wait && G.T && G.T.throwsLeft > 0) this.toast('먼저 윷을 던지세요');
  },

  /* ----- 선택 도구 ----- */
  modal(o) {
    setSkip(false);
    return new Promise(res => {
      const box = $('#mbox'), m = $('#modal');
      m.classList.toggle('peek', !!o.peek);
      m.classList.toggle('sheet', !!o.sheet);
      m.classList.remove('lowered');
      let h = o.sheet
        ? `<div class="sheet-head"><h2 class="mtitle">${esc(o.title)}</h2><button type="button" class="mbtn ghost peekbtn" data-peek="1" aria-expanded="true">판 보기</button></div>`
        : `<h2 class="mtitle">${esc(o.title)}</h2>`;
      if (o.desc) h += `<p class="mdesc">${o.desc}</p>`;
      if (o.cards) h += `<div class="augcards">${o.cards.map((id, i) => this.augCard(id, i, o.locked && o.locked(id))).join('')}</div>`;
      if (o.html) h += o.html;
      if (o.options) h += `<div class="mopts ${o.grid ? 'grid' : ''}">${o.options.map((op, i) => `<button type="button" class="mbtn ${op.cls || ''}" data-i="${i}" ${op.disabled ? 'disabled' : ''}><span>${op.color ? `<i class="cdot" style="background:${op.color}"></i>` : ''}${esc(op.label)}</span>${op.sub ? `<small>${esc(op.sub)}</small>` : ''}</button>`).join('')}</div>`;
      if (o.cancel) h += `<div class="mopts"><button type="button" class="mbtn ghost" data-cancel="1">취소</button></div>`;
      box.innerHTML = h;
      m.hidden = false;
      box.scrollTop = 0;
      this.modalRes = res;
      const g = GEN;
      box.onclick = e => {
        const b = e.target.closest('button'); if (!b || b.disabled || g !== GEN) return;
        SFX.play('click');
        if (b.dataset.peek) {
          const low = m.classList.toggle('lowered');
          b.textContent = low ? '선택창 올리기' : '판 보기';
          b.setAttribute('aria-expanded', String(!low));
          return;
        }
        if (b.dataset.cancel) { this.closeModal(); res(null); return; }
        if (b.dataset.card != null) { this.closeModal(); res(o.cards[+b.dataset.card]); return; }
        if (b.dataset.i != null) { const op = o.options[+b.dataset.i]; this.closeModal(); res(op.value); }
      };
    });
  },
  closeModal() { $('#modal').classList.remove('sheet', 'lowered', 'peek'); $('#modal').hidden = true; $('#mbox').onclick = null; $('#mbox').innerHTML = ''; this.modalRes = null; },
  augCard(id, i, locked) {
    const a = AUG_BY[id];
    return `<button type="button" class="augcard" data-card="${i}" ${locked ? 'disabled' : ''}>
      <div class="tags"><span class="tg ${a.cat}">${CAT_NAME[a.cat]}</span><span class="tg ${a.kind}">${KIND_NAME[a.kind]}</span><span class="tg">No.${a.no}</span></div>
      <div class="an">${esc(a.name)}</div><div class="ad">${esc(a.desc)}</div><div class="ah">${esc(a.how)}</div></button>`;
  },
  async choose(p, title, options, o = {}) {
    if (p && p.ai) { await sleep(AI.delay(350)); return o.ai ? o.ai() : (options.find(x => !x.disabled) || {}).value; }
    if (o.blind) await this.cover(p);
    const v = await this.modal({ title, desc: o.desc, options, cancel: o.cancel, grid: o.grid, peek: o.peek });
    if (o.blind) await this.cover(null, '선택 완료! 기기를 다음 사람에게 넘겨주세요');
    return v;
  },
  async choosePlayer(p, title, cands, o = {}) {
    if (p && p.ai) { await sleep(AI.delay(350)); return o.ai ? o.ai() : cands[0]; }
    const opts = cands.map(q => ({ label: `${q.name} (${q.cname})`, sub: q.out ? (q.outReason || '') : `완주 ${doneCount(q)}/${needPieces(q).length} · 판 위 ${q.pieces.filter(onBoard).length}`, value: q.id, color: q.color }));
    const id = await this.choose(p, title, opts, { blind: o.blind, cancel: o.cancel });
    return id == null ? null : P(id);
  },
  pickNode(p, nodes, msg, o = {}) {
    if (p.ai) return sleep(AI.delay(380)).then(() => (o.ai ? o.ai() : nodes[0]));
    setSkip(false);
    const set = new Set(nodes.map(canon));
    return new Promise(res => {
      this.pick = { set, res };
      R.hl = set;
      this.banner(msg, o.cancel !== false, () => { this.endPick(); res(null); });
      this.refresh();
    });
  },
  endPick() { this.pick = null; R.hl = null; this.hideBanner(); },
  async pickStack(p, stacks, msg, o = {}) {
    if (p.ai) { await sleep(AI.delay(380)); return o.ai ? o.ai() : stacks[0]; }
    const n = await this.pickNode(p, stacks.map(s => s[0].pos), msg, { cancel: true });
    if (n == null) return null;
    return stacks.find(s => canon(s[0].pos) === n) || null;
  },
  async pickPiece(p, cands, msg, o = {}) {
    if (p.ai) { await sleep(AI.delay(380)); return o.ai ? o.ai() : cands[0]; }
    if (!cands.some(x => x.pos === HOME)) {
      const n = await this.pickNode(p, cands.map(x => x.pos), msg, { cancel: true });
      if (n == null) return null;
      return cands.find(x => canon(x.pos) === n) || null;
    }
    const opts = [], seenT = new Set();
    for (const pc of cands) {
      if (pc.pos === HOME) { if (seenT.has(pc.type)) continue; seenT.add(pc.type); }
      else if (opts.some(op => onBoard(op.pc) && canon(op.pc.pos) === canon(pc.pos))) continue;
      opts.push({ label: pieceLabel(pc), value: opts.length, pc });
    }
    const i = await this.modal({ title: msg, options: opts, cancel: true });
    return i == null ? null : opts[i].pc;
  },
  cover(p, text) {
    if (p && p.ai) return Promise.resolve();
    setSkip(false);
    return new Promise(res => {
      const b = $('#blind');
      $('#blindTxt').innerHTML = p ? `<span style="color:${p.color}">${esc(p.name)} (${p.cname})</span>님만<br>화면을 보세요.` : esc(text);
      $('#blindDot').style.background = p ? p.color : 'var(--ink3)';
      b.hidden = false; b.onclick = null;
      const g = GEN;
      setTimeout(() => { b.onclick = () => { b.hidden = true; b.onclick = null; SFX.init(); SFX.play('click'); if (g === GEN) res(); }; }, 280);
    });
  },
  // 알까기: 내 알을 당겼다 놓는 입력을 기다린다 (pointer 처리는 ALK.down/move/up)
  alkShot() { return new Promise(res => { G.alk.onShot = res; }); },
  async alert(title, html, p) {
    if (!G || G.players.every(q => q.ai) || (p && p.ai)) { await sleep(AI.delay(900)); return; }
    await this.modal({ title, html, options: [{ label: '확인', value: true, cls: 'primary' }] });
  },
  async draftPick(p, opts, forced, info) {
    if (p.ai) {
      await sleep(AI.delay(650));
      const id = AI.pickAug(p, opts, forced);
      await sleep(AI.delay(250));
      return id;
    }
    const title = `${p.name} (${p.cname}) · 증강 선택${info.times > 1 ? ` ${info.k + 1}/${info.times}` : ''}`;
    let desc = `${G.round}라운드 — ${CAT_NAME[info.cat]} 전용 + 범용 증강 중 하나를 고르세요.`;
    if (forced) desc += ' <b style="color:#e3b34a">고양이가 나왔습니다! 무조건 골라야 합니다.</b>';
    return this.modal({ title, desc, cards: opts, sheet: true, locked: id => forced && id !== 'cat' });
  },
  async showThrow(p, sets) {
    if (SKIP) return;
    const box = $('#sticks');
    box.innerHTML = sets.map((s, si) => {
      const row = s.flats ? `<div class="sk-row">${s.flats.map((f, i) => `<div class="stick toss ${f ? 'flat' : ''} ${i === 0 ? 'mark' : ''}" style="--r:${Math.round(Math.random() * 24 - 12)}deg;animation-delay:${i * 45 + si * 120}ms">${i === 0 ? '<i class="mk"></i>' : ''}</div>`).join('')}</div>` : '';
      return row + `<div class="sk-res" style="animation-delay:${s.flats ? 480 + si * 120 : 60}ms">${s.v === 'OUT' ? '탈락!' : resName(s.v)}</div>`;
    }).join('');
    box.hidden = false;
    await sleep(p.ai && CFG.fast ? 650 : 1100);
    box.hidden = true;
  },

  async flyStick(t) {
    if (SKIP) return;
    const card = document.querySelector(`#players [data-pid="${t.id}"]`);
    if (!card || $('#game').hidden || !document.body.animate) return;
    const r = card.getBoundingClientRect(), b = $('#throwBtn').getBoundingClientRect();
    const el = document.createElement('div');
    el.className = 'flystick';
    const x0 = b.left + b.width / 2, y0 = b.top, x1 = r.left + r.width / 2, y1 = r.top + r.height / 2;
    el.style.left = x0 + 'px'; el.style.top = y0 + 'px';
    document.body.appendChild(el);
    const anim = el.animate([
      { transform: 'translate(-50%,-50%) rotate(0deg)' },
      { transform: `translate(calc(-50% + ${x1 - x0}px), calc(-50% + ${y1 - y0}px)) rotate(900deg)` }
    ], { duration: 650, easing: 'cubic-bezier(.3,.6,.4,1)' });
    await new Promise(res => { anim.onfinish = res; setTimeout(res, 800); });
    el.remove();
    card.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-7px)' }, { transform: 'translateX(7px)' }, { transform: 'translateX(0)' }], { duration: 320 });
  },

  /* ----- 정보 레이어 (진행 중인 선택을 막지 않음) ----- */
  info(title, html) {
    this.confirmQuit = false;
    $('#ibox').innerHTML = `<h2 class="mtitle">${esc(title)}</h2>${html}<div class="mopts"><button type="button" class="mbtn" data-info="close">닫기</button></div>`;
    $('#info').hidden = false;
    $('#ibox').scrollTop = 0;
  },
  closeInfo() { $('#info').hidden = true; $('#ibox').innerHTML = ''; },
  menu() {
    this.info('메뉴', `<div class="mopts">
      <button type="button" class="mbtn" data-info="rules">룰북</button>
      <button type="button" class="mbtn" data-info="book">증강 도감 72</button>
      <button type="button" class="mbtn" data-info="log">게임 기록</button>
      <button type="button" class="mbtn" data-info="quit">${NET.online ? '온라인 방 나가기 (내 자리는 AI가 이어 둠)' : '새 게임 (타이틀로)'}</button></div>${NET.online && this.net ? `<p class="mdesc">방 코드 <b>${esc(this.net.code)}</b> · ${esc(this.net.tx ? ({ room: 'Claude 방', mqtt: '공개 MQTT 중계', local: '같은 브라우저 탭' }[this.net.tx.name] || '') : '')}</p>` : ''}`);
  },
  book() {
    const rec = loadRecords(), seen = new Set(rec.seen), got = new Set(rec.got);
    const item = a => seen.has(a.id)
      ? `<div class="book-item"><div class="tags"><span class="tg">No.${a.no}</span><span class="tg ${a.kind}">${KIND_NAME[a.kind]}</span>${got.has(a.id) ? '<span class="tg got">받아 봄</span>' : ''}</div><b>${esc(a.name)}</b><p>${esc(a.desc)}</p><p class="h">${esc(a.how)}</p></div>`
      : `<div class="book-item unseen"><div class="tags"><span class="tg">No.${a.no}</span></div><b>?</b><p class="h">아직 만나지 못한 증강입니다. 선택창에 나오거나 누군가 받으면 열립니다.</p></div>`;
    const sec = (cat, title) => { const list = AUGS.filter(a => a.cat === cat); return `<section class="book-sec"><h3>${title} · ${list.filter(a => seen.has(a.id)).length}/${list.length}</h3><div class="book-list">${list.map(item).join('')}</div></section>`; };
    const n = AUGS.filter(a => seen.has(a.id)).length;
    this.info('증강 도감', `<p class="records">수집률 ${n}/${AUGS.length} (${Math.round(n / AUGS.length * 100)}%) · 받아 본 증강 ${got.size}개</p>
      <div class="mopts"><button type="button" class="mbtn" data-info="rules">룰북 보기</button></div>
      ${sec('general', '범용 — 1·4·8라운드')}${sec('start', '시작 전용 — 1라운드')}${sec('mid', '중간 전용 — 4라운드')}${sec('end', '마무리 전용 — 8라운드')}`);
  },
  rules() {
    this.info('룰북', `<div class="rules">
      <h3>목표</h3><p>자기 말 4개를 모두 출발점(우하단 0번)에서 한 바퀴 돌려 다시 도착시키면 순위를 얻습니다. 증강의 특수 승리 조건을 이루면 그 즉시 승리합니다.</p>
      <h3>던지기</h3><ul><li>앞면(평평한 면) 개수: 1=도, 2=개, 3=걸, 4=윷, 0=모. 빨간 점이 찍힌 윷 하나만 앞면이면 빽도.</li><li>윷·모가 나오거나 상대 말을 잡으면 한 번 더 던집니다.</li><li>나온 결과는 아래 칩으로 쌓입니다. 칩을 고른 뒤 판 위의 말(또는 대기 말)을 터치해 움직이세요.</li></ul>
      <h3>길</h3><ul><li>5번·10번 모서리나 중앙(22번)에서 출발하면 지름길로 들어갑니다. 5번 지름길로 중앙을 지나면 15번 쪽으로 곧장, 중앙에 멈췄다 출발하면 출구 쪽으로 갑니다.</li><li>출구(0번)에 닿거나 지나면 완주. 빽도로 0번에 앉은 말은 다음 이동에 완주합니다.</li><li>내 말끼리 만나면 업고 함께 움직입니다. 상대 말 칸에 멈추면 잡습니다.</li></ul>
      <h3>라운드와 증강</h3><ul><li>모든 플레이어가 한 번씩 두면 1라운드.</li><li>1라운드(시작 전용+범용), 4라운드(중간 전용+범용), 8라운드(마무리 전용+범용) 시작에 3장 중 1장을 고릅니다. 혼돈 모드는 2번씩.</li><li>액티브 증강은 내 차례에 아래 금색 버튼으로 씁니다. 빨간 테두리 버튼은 차례를 통째로 씁니다.</li></ul>
      <h3>특수 승리 밸런스</h3><ul><li>증강의 특수 승리 조건은 ${WIN_FROM_ROUND}라운드 전에는 발동하지 않습니다. 조건을 먼저 채우면 기록해 두었다가 ${WIN_FROM_ROUND}라운드가 시작될 때 발동합니다.</li><li>김첨지는 ${KIM_TURNS}차례 안에, 내 다른 말보다 먼저(또는 함께) 완주해야 승리합니다.</li></ul>
      <h3>이어하기</h3><p>매 차례가 끝날 때 판이 이 기기에 저장됩니다. 앱을 닫았다가 타이틀의 ‘이어하기’를 누르면 그 차례의 처음부터 이어집니다.</p>
      <h3>순위</h3><ul><li>완주·특수 승리는 남은 가장 높은 순위, 탈락은 남은 가장 낮은 순위를 받습니다.</li><li>‘1위가 나오면 바로 종료’를 끄면 마지막 한 명이 남을 때까지 겨룹니다. 그 전에 끝나면 남은 사람은 진행도로 순위를 매깁니다.</li></ul>
      <h3>한 기기에서</h3><p>비밀 선택(계획대로·명탐정·배달·내려 투표·나 누구게?)은 가림막이 뜹니다. 해당 플레이어만 화면을 보고 터치하세요.</p>
      <h3>판 변형</h3><ul><li>게임 접어라: 출구가 있는 절반이 남고 반대편 칸은 거울 칸과 합쳐집니다. 출구와 겹친 모서리는 출구가 됩니다.</li><li>돌려돌려 돌림판: 판이 시계방향 90° 회전하고, 출구 자리는 그대로라 각 말의 남은 거리가 바뀝니다.</li><li>알까기: 판 위 말뭉치가 알이 됩니다. 내 알을 당겼다 놓으면 반대쪽으로 튕겨 나가고, 점선 밖으로 나간 알은 죽습니다.</li></ul>
      </div><div class="mopts"><button type="button" class="mbtn" data-info="book">증강 도감 보기</button></div>`);
  },
  logView() {
    if (!G) return;
    this.info('게임 기록', `<div class="loglist">${G.log.slice().reverse().map(l => `<div>${esc(l)}</div>`).join('')}</div>`);
  },
  playerDetail(q) {
    const pcs = q.pieces.map(pc => `<li>${esc(TYPE_NAME[pc.type])} — ${pc.pos === HOME ? '대기' : pc.pos === DONE ? '완주' : `${canon(pc.pos)}번 칸`}${pc.shield ? ' · 보호막' : ''}${isBound(pc) && onBoard(pc) ? ' · 속박' : ''}${pc.type === 'queen' ? ` · 목숨 ${pc.lives}` : ''}</li>`).join('');
    const augs = q.augs.length ? q.augs.map(a => {
      const A = AUG_BY[a.id], cat = a.catUntil && G.round < a.catUntil;
      const st = a.disabled ? '무효' : cat ? `고양이로 착각 중 (${a.catUntil - 1}R까지)` : a.used ? '사용함' : '';
      return `<div class="book-item"><div class="tags"><span class="tg ${A.cat}">${CAT_NAME[A.cat]}</span><span class="tg ${A.kind}">${KIND_NAME[A.kind]}</span>${st ? `<span class="tg">${st}</span>` : ''}</div><b>${esc(A.name)}</b><p>${esc(A.desc)}</p><p class="h">${esc(A.how)}</p></div>`;
    }).join('') : '<p class="mdesc">아직 증강이 없습니다.</p>';
    this.info(`${q.name} (${q.cname}) · ${q.ai ? 'AI' : '사람'}`, `<p class="mdesc">${q.rank ? `${q.elim ? '탈락' : q.rank + '위'} — ${esc(q.outReason)}` : '경기 중'} · 완주 ${doneCount(q)}/${needPieces(q).length}${q.badge ? ' · ' + esc(q.badge) : ''}</p>
      <p class="mdesc">${this.stats(q) || '특수 카운터 없음'}</p><ul class="rules">${pcs}</ul><div class="book-list">${augs}</div>`);
  },
  results(order) {
    const sum = buildSummary();
    const sumBy = Object.fromEntries(sum.players.map(x => [x.id, x]));
    const pw = G.planWinner;
    const winners = pw ? [pw] : order.filter(q => q.rank === 1 && !q.elim);
    const head = pw ? `계획대로! ${pw.name} 단독 승리` : winners.length ? `${winners.map(q => q.name).join(' · ')} 승리!` : '게임 종료';
    const rows = order.map(q => {
      const win = winners.includes(q);
      const medal = q.elim ? '✕' : String(q.rank);
      const col = { 1: '#e3b34a', 2: '#c9d1dc', 3: '#cd7f32' }[q.rank] || 'var(--muted)';
      return `<div class="res-row ${win ? 'win' : ''}"><span class="medal" style="color:${q.elim ? 'var(--muted)' : col}">${medal}</span>
        <span class="cdot" style="display:inline-block;width:14px;height:14px;border-radius:50%;background:${q.color}"></span>
        <span class="rn"><b>${esc(q.name)} (${q.cname})</b>${q.badge ? ' ' + esc(q.badge) : ''}<small>${esc(q.outReason || '')} · 완주 ${doneCount(q)}/${needPieces(q).length}</small>
        <small>잡음 ${sumBy[q.id].capt} · 잡힘 ${sumBy[q.id].lost} · 윷 ${sumBy[q.id].yuts} · 모 ${sumBy[q.id].mos}</small>
        <small>증강: ${sumBy[q.id].augs.length ? esc(sumBy[q.id].augs.join(', ')) : '없음'}</small></span></div>`;
    }).join('');
    const moments = sum.moments.length ? `<section class="moments"><h3>결정적 순간</h3>${sum.moments.map(t => `<p>${esc(t)}</p>`).join('')}</section>` : '';
    SFX.play('win');
    this.modal({ title: head, html: `${moments}<div class="book-list">${rows}</div>${pw ? '<p class="mdesc">계획대로 증강이 최종 순위를 모두 맞혀 기존 순위가 사라졌습니다.</p>' : ''}`,
      options: NET.online ? [{ label: '방 나가기', value: 'title', cls: 'primary' }] : [{ label: '같은 설정으로 다시', value: 'again', cls: 'primary' }, { label: '타이틀로', value: 'title' }] })
      .then(v => { if (v === 'again') startGame(); else if (v === 'title') this.toTitle(); });
  }
};
