/* ═══════════════════════════════════════════════
   toronhaja — onboard.js
   첫 방문 환영 모달 + 닉네임 직접 설정.
   ── 전부 브라우저 안에서만 동작 (서버 통신 없음) ──
   닉네임은 localStorage(thj_nick)에 저장되고, 이미 유저 행이 있으면
   DB.setNick 이 서버 users.nickname 도 1회 갱신한다.
   ═══════════════════════════════════════════════ */

'use strict';

const SIDE_TONE = { adj: ['푸른', '침착한', '날쌘', '강철', '신중한', '냉철한', '단단한', '조용한', '단호한', '뜨거운'] };

function _esc(s) { return String(s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c])); }

/* 모달 공통 셸 */
function thjModal(innerHTML, opts = {}) {
  const ov = document.createElement('div');
  ov.className = 'thj-modal-ov';
  ov.innerHTML = `<div class="thj-modal" role="dialog" aria-modal="true">${innerHTML}</div>`;
  document.body.appendChild(ov);
  void ov.offsetWidth;
  ov.classList.add('show');
  const close = () => { ov.classList.remove('show'); setTimeout(() => ov.remove(), 220); };
  if (!opts.persistent) ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
  return { ov, close };
}

/* 닉네임 에디터 본문 (온보딩/재설정 공용) */
function _nickEditorBody(current, emoji, { title, sub, cta }) {
  return `
    <div class="ob-avatar" id="obAvatar">${emoji}</div>
    <h2 class="ob-title">${title}</h2>
    <p class="ob-sub">${sub}</p>
    <div class="ob-nick">
      <input id="obNick" type="text" maxlength="10" value="${_esc(current)}" autocomplete="off" spellcheck="false" />
      <button id="obDice" class="ob-dice" title="랜덤 닉네임">${icon('dice', 17)}</button>
    </div>
    <button id="obGo" class="ob-go">${cta}</button>`;
}

function _wireNickEditor(ov, close) {
  const input = ov.querySelector('#obNick');
  const avatar = ov.querySelector('#obAvatar');
  const sync = () => { avatar.textContent = DB.emojiFor(input.value.trim() || '익명'); };
  ov.querySelector('#obDice').addEventListener('click', () => { input.value = DB.genNick(); sync(); input.focus(); });
  input.addEventListener('input', sync);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') ov.querySelector('#obGo').click(); });
  ov.querySelector('#obGo').addEventListener('click', async () => {
    const v = input.value.trim();
    if (v.length < 2) { thjToast('2자 이상 입력해', 'warn'); input.focus(); return; }
    await DB.setNick(v);
    localStorage.setItem('thj_onboarded', '1');
    if (typeof window.refreshMeChip === 'function') window.refreshMeChip();
    close();
    thjToast(`${v} 어서 와`, 'success');
  });
  setTimeout(() => input.focus(), 60);
}

/* 첫 방문 환영 (3-스텝 설명 + 닉네임) */
function thjOnboard() {
  const nick = DB.myNick(), emoji = DB.emojiFor(nick);
  const steps = [
    ['scale', '입장을 고른다', '찬성이냐 반대냐, 한쪽에 선다'],
    ['comment', '근거로 부딪친다', '같은 편끼리 화력을 모은다'],
    ['chart', '실시간으로 갈린다', '여론이 즉시 %로 쪼개진다'],
  ].map(([ic, t, d]) => `
    <div class="ob-step"><span class="ob-step-ic">${icon(ic, 18)}</span><div><b>${t}</b><span>${d}</span></div></div>`).join('');

  const { ov, close } = thjModal(`
    <div class="ob-brand"><span class="l1">토론</span><span class="l2">하자</span><span class="dot">.</span></div>
    <div class="ob-steps">${steps}</div>
    <div class="ob-divider"></div>
    ${_nickEditorBody(nick, emoji, {
      title: '닉네임 정하기',
      sub: '전부 익명이다. 이름 정하거나 주사위 굴려.',
      cta: '토론 시작하기',
    })}`, { persistent: true });
  _wireNickEditor(ov, close);
}

/* 닉네임만 다시 바꾸기 (헤더 칩에서 호출) */
function thjEditNick() {
  const nick = DB.myNick(), emoji = DB.emojiFor(nick);
  const { ov, close } = thjModal(_nickEditorBody(nick, emoji, {
    title: '닉네임 바꾸기',
    sub: '바꾸면 다음 댓글부터 적용된다.',
    cta: '저장하기',
  }));
  _wireNickEditor(ov, close);
}
window.thjEditNick = thjEditNick;

/* 첫 방문이면 자동 실행 */
function _maybeOnboard() {
  if (localStorage.getItem('thj_onboarded')) return;
  if (typeof DB === 'undefined' || !DB.live) return;   // 서버 미연결 시 생략
  thjOnboard();
}
if (document.readyState !== 'loading') setTimeout(_maybeOnboard, 300);
else document.addEventListener('DOMContentLoaded', () => setTimeout(_maybeOnboard, 300));
