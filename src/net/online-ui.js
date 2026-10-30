// 온라인 대전 화면: 방 만들기 / 참가 / 대기실. 게임 화면은 기존 UI 를 그대로 쓴다.
import { $, esc, PCOL } from '../util.js';
import { UI } from '../ui.js';
import { R, animateMove } from '../render.js';
import { SFX } from '../sound.js';
import { Session, ERROR_TEXT } from './session.js';
import { normCode } from './room.js';

const DF_NAME = { easy: '쉬움', normal: '보통', hard: '어려움' };
const TX_NAME = { room: 'Claude 방', mqtt: '공개 MQTT 중계 서버', local: '같은 브라우저의 탭' };

export const OnlineUI = {
  session: null,
  form: { hu: 2, ai: 0, df: 'normal', ch: false, ef: false },
  view: null, notice: '', error: '', busy: '', codeDraft: '', nickDraft: null,

  init() {
    const s = this.session = new Session({
      ui: UI, r: R, sfx: SFX, animateMove,
      on: {
        lobby: v => { this.view = v; if (this.shown()) this.render(); },
        status: () => { if (this.shown() && this.view) this.render(); UI.netBadge(); },
        error: e => this.onError(e),
        start: () => { this.hide(); },
        over: () => {},
        rebuild: () => UI.toast('다른 기기와 기록을 맞추는 중이에요'),
        desync: () => UI.toast('다른 참가자의 화면과 판 상태가 달라진 것 같아요. 계속 어긋나면 방을 다시 만들어 주세요.', '#e66'),
      },
    });
    UI.net = s;
    UI.openOnline = () => this.open();
    $('#onBack').addEventListener('click', () => this.back());
    const body = $('#onBody');
    body.addEventListener('click', e => this.onClick(e));
    body.addEventListener('input', e => {
      if (e.target.id === 'onNick') this.nickDraft = e.target.value;
      if (e.target.id === 'onCode') { const v = normCode(e.target.value); e.target.value = v; this.codeDraft = v; }
    });
    body.addEventListener('change', e => { const o = e.target.dataset && e.target.dataset.opt; if (o) { this.form[o] = e.target.checked; } });
    body.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.id === 'onCode') this.doJoin(); });
    const hide = () => { if (document.hidden) s.saveNow(true); else s.wake(); };
    document.addEventListener('visibilitychange', hide);
    window.addEventListener('pagehide', () => s.saveNow(true));
    // 초대 링크(#join-ABCD)로 열면 참가 화면을 미리 채워서 보여 준다
    const m = /^#join-([A-Za-z0-9]{4})$/.exec(location.hash || '');
    if (m) { this.codeDraft = normCode(m[1]); setTimeout(() => this.open(), 0); }
  },
  shown() { return !$('#online').hidden; },
  open() {
    $('#title').hidden = true; $('#online').hidden = false;
    if (!this.session.active) { this.view = null; this.error = ''; this.notice = ''; }
    this.render();
    $('#online').scrollTop = 0;
  },
  hide() { $('#online').hidden = true; },
  async back() {
    SFX.play('click');
    if (this.session.active) await this.session.leave();
    this.view = null; this.error = ''; this.busy = '';
    this.hide(); $('#title').hidden = false; UI.buildTitle();
  },

  /* ----- 그리기 ----- */
  render() {
    const v = this.view;
    $('#onTitle').textContent = v && v.phase !== 'closed' ? '대기실' : '온라인 대전';
    $('#onBody').innerHTML = (v && v.phase !== 'closed' && this.session.active) ? this.lobbyHtml(v) : this.formHtml();
  },
  seg(act, cur, items) {
    return `<div class="seg">${items.map(([v, label]) => `<button type="button" data-act="${act}" data-v="${v}" class="${String(cur) === String(v) ? 'on' : ''}">${label}</button>`).join('')}</div>`;
  },
  formHtml() {
    const f = this.form, s = this.session, saved = s.savedGame();
    const maxAi = 4 - f.hu;
    if (f.ai > maxAi) f.ai = maxAi;
    const nick = this.nickDraft != null ? this.nickDraft : s.nick;
    return `
      ${this.error ? `<p class="on-err" role="alert">${esc(this.error)}</p>` : ''}
      <section class="setup-card"><div class="sc-head">내 이름</div>
        <input id="onNick" class="field" maxlength="10" value="${esc(nick)}" autocomplete="off" autocapitalize="off" aria-label="내 이름"></section>
      ${saved ? `<section class="setup-card"><div class="sc-head">진행 중이던 판</div>
        <p class="on-note">방 코드 ${esc(saved.code)} · ${saved.ro.length}명 · 이 기기에 저장된 기록으로 이어서 합니다. 방에 다른 사람이 남아 있어야 이어갈 수 있어요.</p>
        <div class="row2"><button type="button" class="mbtn primary" data-act="resume">이어하기</button><button type="button" class="mbtn ghost" data-act="discard">지우기</button></div></section>` : ''}
      <section class="setup-card"><div class="sc-head">방 코드로 참가</div>
        <input id="onCode" class="field code" maxlength="4" value="${esc(this.codeDraft)}" placeholder="코드 4자리" autocomplete="off" autocapitalize="characters" spellcheck="false" aria-label="방 코드">
        <button type="button" class="mbtn primary" data-act="join" ${this.busy ? 'disabled' : ''}>${this.busy === 'join' ? '방을 찾는 중…' : '참가'}</button></section>
      <section class="setup-card"><div class="sc-head">방 만들기</div>
        <div class="sc-note">사람 수</div>${this.seg('hu', f.hu, [[2, '2명'], [3, '3명'], [4, '4명']])}
        <div class="sc-note">AI 자리 (남는 자리를 AI 가 채웁니다)</div>${this.seg('ai', f.ai, [[0, '없음'], [1, '1명'], [2, '2명']].filter(([v]) => v <= maxAi))}
        ${f.ai ? `<div class="sc-note">AI 난이도</div>${this.seg('df', f.df, [['easy', '쉬움'], ['normal', '보통'], ['hard', '어려움']])}` : ''}
        <label class="switch-row" for="onCh"><span><b>혼돈 모드</b><small>증강을 2번씩 선택</small></span><input type="checkbox" id="onCh" data-opt="ch" ${f.ch ? 'checked' : ''}><i class="sw"></i></label>
        <label class="switch-row" for="onEf"><span><b>1위가 나오면 바로 종료</b><small>끄면 마지막 순위까지 겨룹니다</small></span><input type="checkbox" id="onEf" data-opt="ef" ${f.ef ? 'checked' : ''}><i class="sw"></i></label>
        <button type="button" class="mbtn primary" data-act="create" ${this.busy ? 'disabled' : ''}>${this.busy === 'create' ? '방을 여는 중…' : '방 만들기'}</button></section>
      <p class="on-note">${this.transportNote()}</p>`;
  },
  transportNote() {
    const w = window;
    if (/#local/.test(location.hash)) return '지금은 같은 브라우저의 탭끼리 연결하는 시험 모드예요.';
    if (w.claude && typeof w.claude.use === 'function') return 'Claude 에 로그인한 사람끼리 이 페이지 안의 방으로 연결돼요. 상대도 이 페이지를 열어 둔 상태여야 해요.';
    return '서버 없이 공개 MQTT 중계 서버를 거쳐 연결돼요. 같은 와이파이가 아니어도 되고, 방 코드를 아는 사람만 들어올 수 있게 코드를 친구에게만 알려 주세요.';
  },
  lobbyHtml(v) {
    const cfg = v.cfg, s = this.session;
    const finding = v.phase === 'join' || !v.cfg;
    const mem = v.members.map(m => `<div class="mem"><i class="sdot" style="background:${PCOL[m.seat]}"></i><b>${esc(m.nick)}${m.me ? ' (나)' : ''}</b>${m.host ? '<span class="tag">방장</span>' : ''}<span class="tag ${m.live ? 'ok' : 'off'}">${m.live ? '연결됨' : '끊김'}</span>${v.isHost && !m.me ? `<button type="button" data-act="kick" data-sid="${esc(m.sid)}" aria-label="${esc(m.nick)} 내보내기">내보내기</button>` : ''}</div>`).join('');
    const empty = cfg ? Array.from({ length: Math.max(0, cfg.hu - v.members.length) }, () => '<div class="mem"><i class="sdot" style="background:var(--line)"></i><b style="color:var(--muted)">비어 있음</b></div>').join('') : '';
    const aiN = cfg ? cfg.n - cfg.hu : 0;
    const startable = v.isHost && v.members.length >= 2 && v.phase === 'lobby';
    const link = `${location.href.split('#')[0]}#join-${v.code}`;
    const st = s.status || {};
    return `
      ${this.notice ? `<p class="on-err" role="alert">${esc(this.notice)}</p>` : ''}
      <section class="setup-card"><div class="sc-head">방 코드</div>
        <div class="code-big" aria-label="방 코드 ${esc(v.code.split('').join(' '))}">${esc(v.code)}</div>
        <div class="row2"><button type="button" class="mbtn" data-act="copy" data-t="${esc(v.code)}">코드 복사</button><button type="button" class="mbtn" data-act="copy" data-t="${esc(link)}">초대 링크 복사</button></div>
        <p class="on-note">${finding ? '방을 찾는 중이에요…' : `사람 ${cfg.hu}명${aiN ? ` + AI ${aiN}명(${DF_NAME[cfg.df]})` : ''}${cfg.ch ? ' · 혼돈' : ''}${cfg.ef ? ' · 1위 나오면 종료' : ''}`}</p></section>
      ${finding ? '' : `<section class="setup-card"><div class="sc-head">참가자 ${v.members.length}/${cfg.hu}</div><div>${mem}${empty}</div></section>`}
      ${v.phase === 'start' ? '<p class="on-note">모두의 시작 값을 모으는 중이에요… (방장도 시작 값을 고를 수 없게 모두가 함께 정해요)</p>' : ''}
      ${v.isHost ? `<button type="button" class="start-btn" data-act="start" ${startable ? '' : 'disabled'}>${v.phase === 'start' ? '준비 중…' : '시작'}</button>${v.members.length < 2 ? '<p class="on-note">한 명 이상 더 들어오면 시작할 수 있어요.</p>' : ''}` : (finding ? '' : `<p class="on-note">방장이 시작하기를 기다리는 중이에요.</p>`)}
      <button type="button" class="mbtn ghost" data-act="leave">방 나가기</button>
      <p class="on-note">연결: ${esc(TX_NAME[s.tx && s.tx.name] || '')}${st.total ? ` (${st.connected}/${st.total})` : ''}</p>`;
  },

  /* ----- 동작 ----- */
  async onClick(e) {
    const b = e.target.closest('button[data-act]');
    if (!b || b.disabled) return;
    SFX.init(); SFX.play('click');
    const act = b.dataset.act, f = this.form, s = this.session;
    if (act === 'hu') { f.hu = +b.dataset.v; this.render(); }
    else if (act === 'ai') { f.ai = +b.dataset.v; this.render(); }
    else if (act === 'df') { f.df = b.dataset.v; this.render(); }
    else if (act === 'create') this.doCreate();
    else if (act === 'join') this.doJoin();
    else if (act === 'resume') { this.error = ''; this.busy = 'resume'; const ok = await s.resume(); this.busy = ''; if (!ok) this.render(); }
    else if (act === 'discard') { s.clearSaved(); this.render(); UI.buildTitle(); }
    else if (act === 'start') { this.notice = ''; s.start(); }
    else if (act === 'leave') { await s.leave(); this.view = null; this.notice = ''; this.render(); }
    else if (act === 'kick') s.kick(b.dataset.sid);
    else if (act === 'copy') this.copy(b.dataset.t);
  },
  saveNick() {
    const el = $('#onNick');
    if (el) { this.session.nick = el.value; this.nickDraft = null; }
  },
  async doCreate() {
    this.saveNick(); this.error = ''; this.busy = 'create'; this.render();
    const f = this.form;
    const code = await this.session.create({ n: f.hu + f.ai, hu: f.hu, ch: f.ch ? 1 : 0, df: f.ai ? f.df : 'normal', ef: f.ef ? 1 : 0 });
    this.busy = '';
    if (code) { this.view = this.session.core.view(); this.render(); } else this.render();
  },
  async doJoin() {
    this.saveNick();
    const code = normCode(($('#onCode') || {}).value || this.codeDraft);
    this.codeDraft = code;
    if (code.length !== 4) { this.error = '방 코드 4자리를 입력해 주세요.'; this.render(); return; }
    this.error = ''; this.busy = 'join'; this.render();
    const ok = await this.session.join(code);
    this.busy = '';
    if (ok) { this.view = this.session.core.view(); }
    this.render();
  },
  copy(text) {
    const done = () => UI.toast('복사했어요');
    const fail = () => UI.toast('복사하지 못했어요. 코드를 직접 알려 주세요.');
    try { navigator.clipboard.writeText(text).then(done, fail); } catch (e) { fail(); }
  },
  onError(e) {
    const msg = ERROR_TEXT[e.code] || (e.code === 'engine' ? '게임 진행 중 오류가 났어요.' : '연결에 문제가 생겼어요.');
    if (e.code === 'startfail') { this.notice = msg; if (this.shown()) this.render(); return; }
    this.busy = '';
    if (!this.session.active) this.view = null;
    this.error = msg;
    if (!$('#game').hidden) { UI.toast(msg, '#e66'); if (!this.session.active && e.code !== 'engine') { UI.toTitle(); } return; }
    if (!this.shown()) this.open(); else this.render();
  },
};
