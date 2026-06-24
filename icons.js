/* ═══════════════════════════════════════════════
   toronhaja — icons.js
   공용 SVG 스프라이트를 모든 페이지에 주입.
   다른 스크립트보다 먼저 로드하세요.
   ═══════════════════════════════════════════════ */

(function () {
  const SPRITE = `
  <svg xmlns="http://www.w3.org/2000/svg" style="display:none" aria-hidden="true">
    <symbol id="ic-search"  viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></symbol>
    <symbol id="ic-fire"    viewBox="0 0 24 24" fill="currentColor"><path d="M12 23c4 0 7-2.7 7-6.5 0-2.3-1.2-4.3-2.5-5.8-.4 1.2-1.2 2-2 2 .6-2.4-.5-5-2.5-6.7-.3 2-1.5 3.2-2.8 4.4C7 11.4 5 13.4 5 16.5 5 20.3 8 23 12 23z"/></symbol>
    <symbol id="ic-comment" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.9-.9L3 21l1.9-5.6A8.5 8.5 0 1 1 21 11.5z"/></symbol>
    <symbol id="ic-users"   viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-3-3.87M9 7a4 4 0 1 1 0 8 4 4 0 0 1 0-8zM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></symbol>
    <symbol id="ic-user"    viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></symbol>
    <symbol id="ic-clock"   viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v4l3 2"/></symbol>
    <symbol id="ic-plus"    viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></symbol>
    <symbol id="ic-send"    viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></symbol>
    <symbol id="ic-like"    viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 22V11M2 13v7a2 2 0 0 0 2 2h13.3a2 2 0 0 0 2-1.7l1.4-9A2 2 0 0 0 18.7 9H14V5a2.5 2.5 0 0 0-2.5-2.5L7 11"/></symbol>
    <symbol id="ic-report"  viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 22V4"/><path d="M4 4h13l-2 4 2 4H4"/></symbol>
    <symbol id="ic-trophy"  viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 21h8M12 17v4M7 4h10v4a5 5 0 0 1-10 0V4zM7 5H4v2a3 3 0 0 0 3 3M17 5h3v2a3 3 0 0 0-3 3"/></symbol>
    <symbol id="ic-arrow-r" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></symbol>
    <symbol id="ic-arrow-up" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></symbol>
    <symbol id="ic-arrow-dn" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></symbol>
    <symbol id="ic-x"       viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></symbol>
    <symbol id="ic-share"   viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></symbol>
    <symbol id="ic-grid"    viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/></symbol>
    <symbol id="ic-gavel"   viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 13l-7 7M3 21h8M12.5 3.5l4 4M9 7l8 8M14 2l8 8-3 3-8-8z"/></symbol>
    <symbol id="ic-flag"    viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 22V4"/><path d="M4 4h13l-2 4 2 4H4"/></symbol>
    <symbol id="ic-bell"    viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></symbol>
    <symbol id="ic-chart"   viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="M7 14l3-3 3 3 5-6"/></symbol>
    <symbol id="ic-shield"  viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></symbol>
    <symbol id="ic-check"   viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></symbol>
    <symbol id="ic-eye"     viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></symbol>
    <symbol id="ic-ban"     viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><line x1="5" y1="5" x2="19" y2="19"/></symbol>
    <symbol id="ic-database" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 1.66 3.58 3 8 3s8-1.34 8-3V5"/><path d="M4 11v6c0 1.66 3.58 3 8 3s8-1.34 8-3v-6"/></symbol>
    <symbol id="ic-trash"    viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></symbol>
    <symbol id="ic-link"    viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></symbol>
    <symbol id="ic-copy"    viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></symbol>
    <symbol id="ic-edit"    viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></symbol>
    <symbol id="ic-dice"    viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 3h5v5"/><path d="M4 20L21 3"/><path d="M21 16v5h-5"/><path d="M15 15l6 6"/><path d="M4 4l5 5"/></symbol>
    <symbol id="ic-scale"   viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v18"/><path d="M5 7h14"/><path d="M5 7l-3 6a3 3 0 0 0 6 0z"/><path d="M19 7l3 6a3 3 0 0 1-6 0z"/><path d="M8 21h8"/></symbol>
    <symbol id="ic-sparkle" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l1.9 6.1L20 10l-6.1 1.9L12 18l-1.9-6.1L4 10l6.1-1.9z"/></symbol>
    <symbol id="ic-arrow-lr" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></symbol>
    <symbol id="ic-home"    viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5L12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M9.5 21v-6h5v6"/></symbol>
    <symbol id="ic-ballot"  viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/></symbol>
    <symbol id="ic-target"  viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/></symbol>
    <symbol id="ic-medal"   viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2l3 6M16 2l-3 6"/><circle cx="12" cy="15" r="6"/><path d="M12 12.5l1 2 2 .2-1.5 1.4.4 2-1.9-1-1.9 1 .4-2L9 14.7l2-.2z"/></symbol>
    <symbol id="ic-bolt"    viewBox="0 0 24 24" fill="currentColor"><path d="M13 2L4 14h6l-1 8 9-12h-6z"/></symbol>
    <symbol id="ic-flame"   viewBox="0 0 24 24" fill="currentColor"><path d="M12 23c4 0 7-2.7 7-6.5 0-2.3-1.2-4.3-2.5-5.8-.4 1.2-1.2 2-2 2 .6-2.4-.5-5-2.5-6.7-.3 2-1.5 3.2-2.8 4.4C7 11.4 5 13.4 5 16.5 5 20.3 8 23 12 23z"/></symbol>
  </svg>`;

  function inject() {
    if (document.getElementById('thj-sprite')) return;
    const wrap = document.createElement('div');
    wrap.id = 'thj-sprite';
    wrap.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
    wrap.innerHTML = SPRITE;
    document.body.appendChild(wrap);
  }
  if (document.body) inject();
  else document.addEventListener('DOMContentLoaded', inject);
})();

/* 헬퍼: 숫자 포맷 + 카운트업 (모든 페이지 공용) */
function fmt(n) { return Number(n).toLocaleString('en-US'); }
function animateCount(el, target, duration = 1000) {
  const start = performance.now();
  (function tick(now) {
    const p = Math.min(1, (now - start) / duration);
    const e = 1 - Math.pow(1 - p, 3);
    el.textContent = fmt(Math.round(target * e));
    if (p < 1) requestAnimationFrame(tick);
  })(performance.now());
  /* rAF 가 멈춘 탭/iframe 에서도 최종값 보장 */
  setTimeout(() => { el.textContent = fmt(target); }, duration + 60);
}
function icon(name, size = 16, extra = '') {
  return `<svg width="${size}" height="${size}" ${extra}><use href="#ic-${name}"/></svg>`;
}

/* 상대 시간 ("3분 전") */
function relTime(iso) {
  const d = new Date(iso), s = Math.max(0, (Date.now() - d.getTime()) / 1000);
  if (s < 60) return '방금 전';
  if (s < 3600) return Math.floor(s / 60) + '분 전';
  if (s < 86400) return Math.floor(s / 3600) + '시간 전';
  return Math.floor(s / 86400) + '일 전';
}

/* 종료까지 카운트다운 ("03:24:11" / "1일 4시간") */
function fmtCountdown(iso) {
  if (!iso) return '진행중';
  let s = (new Date(iso).getTime() - Date.now()) / 1000;
  if (s <= 0) return '종료됨';
  const d = Math.floor(s / 86400); s -= d * 86400;
  const h = Math.floor(s / 3600); s -= h * 3600;
  const m = Math.floor(s / 60); const ss = Math.floor(s - m * 60);
  if (d > 0) return `${d}일 ${h}시간`;
  const p = n => String(n).padStart(2, '0');
  return `${p(h)}:${p(m)}:${p(ss)}`;
}
const CAT_COLOR = {
  정치: 'var(--cat-politics)', 축구: 'var(--cat-soccer)', 연예: 'var(--cat-ent)',
  게임: 'var(--cat-game)', 사회: 'var(--cat-society)', 경제: 'var(--cat-econ)',
};
function catStyle(cat) {
  const c = CAT_COLOR[cat] || 'var(--subtext)';
  return `color:${c};background:color-mix(in oklab,${c} 16%,transparent)`;
}

/* ── 공용 토스트 (모든 페이지) ──────────────────
   thjToast('메시지', 'success'|'info'|'warn'|'error', 'icon이름?') */
function thjToast(msg, type = 'success', ic) {
  let t = document.getElementById('thj-toast');
  if (!t) { t = document.createElement('div'); t.id = 'thj-toast'; document.body.appendChild(t); }
  const def = { success: 'check', info: 'sparkle', warn: 'flag', error: 'ban' };
  const name = ic || def[type] || 'check';
  t.className = 'thj-toast ' + type;
  t.innerHTML = `<span class="tt-ic">${icon(name, 16)}</span><span class="tt-msg"></span>`;
  t.querySelector('.tt-msg').textContent = msg;     // XSS 안전
  void t.offsetWidth;                                // reflow → 트랜지션 재생
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), 2400);
}
