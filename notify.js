/* ═══════════════════════════════════════════════
   toronhaja — notify.js
   인앱 알림: 벨 버튼 + 드롭다운 패널 + 실시간 + 브라우저 알림.
   index.html 의 #notifBtn 을 찾아 동작한다(없으면 조용히 종료).
   의존: supabase.js(DB) · icons.js(icon/relTime/thjToast) · app.js(openDetail)
   로드 순서: app.js 다음, pwa.js 앞.
   ═══════════════════════════════════════════════ */

'use strict';

(function () {
  const btn = document.getElementById('notifBtn');
  if (!btn || !window.DB) return;
  const badge = document.getElementById('notifBadge');

  let panel = null, open = false, rtCh = null, markTimer = null;

  const KIND = {
    like:     { ic: 'like',    cls: 'like' },
    reply:    { ic: 'comment', cls: 'reply' },
    announce: { ic: 'flag',    cls: 'announce' },
  };

  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  /* ── 패널 생성 (1회) ── */
  function buildPanel() {
    panel = document.createElement('div');
    panel.className = 'notif-panel';
    panel.innerHTML =
      `<div class="notif-head"><b>알림</b><button class="nh-read" type="button">모두 읽음</button></div>
       <div class="notif-perm" hidden><span>새 댓글·공감 브라우저 알림 받기</span><button type="button">켜기</button></div>
       <div class="notif-list"></div>`;
    document.body.appendChild(panel);

    panel.querySelector('.nh-read').addEventListener('click', async (e) => {
      e.stopPropagation();
      await DB.markAllRead();
      await renderList();
      refreshBadge();
    });
    panel.querySelector('.notif-perm button').addEventListener('click', async (e) => {
      e.stopPropagation();
      try { await Notification.requestPermission(); } catch (_) {}
      updatePerm();
    });
    panel.addEventListener('click', (e) => {
      const it = e.target.closest('.notif-item');
      if (!it) return;
      const did = it.dataset.did;
      closePanel();
      if (did && typeof openDetail === 'function') openDetail(did);
    });
  }

  function updatePerm() {
    if (!panel) return;
    const row = panel.querySelector('.notif-perm');
    row.hidden = !('Notification' in window) || Notification.permission !== 'default';
  }

  function place() {
    const r = btn.getBoundingClientRect();
    panel.style.top = (r.bottom + 8) + 'px';
    panel.style.right = Math.max(12, Math.round(window.innerWidth - r.right)) + 'px';
  }

  /* ── 목록 렌더 ── */
  async function renderList() {
    const list = panel.querySelector('.notif-list');
    let items = [];
    try { items = await DB.notifications(30); } catch (_) {}
    if (!items.length) {
      list.innerHTML = `<div class="notif-empty">아직 알림 없음.<br>토론 참여하면 공감·새 댓글 알림 온다.</div>`;
      return;
    }
    list.innerHTML = items.map(n => {
      const k = KIND[n.kind] || KIND.reply;
      const t = (typeof relTime === 'function' && n.created_at) ? relTime(n.created_at) : '';
      return `<div class="notif-item ${n.read ? '' : 'unread'}" ${n.debateId ? `data-did="${esc(n.debateId)}"` : ''}>
        <div class="ni-ic ${k.cls}">${icon(k.ic, 17)}</div>
        <div class="ni-tx">
          <div class="ni-title">${esc(n.title)}</div>
          <div class="ni-body">${esc(n.body)}</div>
          <div class="ni-time">${t}</div>
        </div>
      </div>`;
    }).join('');
  }

  /* ── 배지(안읽음 수) ── */
  async function refreshBadge() {
    let n = 0;
    try { n = await DB.unreadCount(); } catch (_) {}
    if (n > 0) { badge.hidden = false; badge.textContent = n > 99 ? '99+' : String(n); }
    else { badge.hidden = true; }
  }

  /* ── 열기/닫기 ── */
  async function openPanel() {
    if (!panel) buildPanel();
    updatePerm();
    place();
    await renderList();
    panel.classList.add('show');
    btn.classList.add('is-on');
    open = true;
    // 벨을 열면 잠시 후 모두 읽음 처리(배지 비움) — 화면의 unread 강조는 그대로 유지
    clearTimeout(markTimer);
    markTimer = setTimeout(async () => { await DB.markAllRead(); refreshBadge(); }, 900);
  }
  function closePanel() {
    if (!panel) return;
    panel.classList.remove('show');
    btn.classList.remove('is-on');
    open = false;
    clearTimeout(markTimer);
  }

  btn.addEventListener('click', (e) => { e.stopPropagation(); open ? closePanel() : openPanel(); });
  document.addEventListener('click', (e) => {
    if (open && panel && !panel.contains(e.target) && !btn.contains(e.target)) closePanel();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && open) closePanel(); });
  window.addEventListener('resize', () => { if (open) place(); });

  /* ── 실시간 수신 ── */
  function onIncoming(n) {
    refreshBadge();
    if (open) renderList();
    const kind = (n && n.kind) || 'reply';
    const body = (n && n.body) || '새 알림';
    if ('Notification' in window && Notification.permission === 'granted' && document.hidden) {
      try { new Notification(kind === 'announce' ? '토론하자 공지' : '토론하자', { body, icon: 'favicon-180.png', tag: String((n && n.id) || Date.now()) }); } catch (_) {}
    } else if (!document.hidden && typeof thjToast === 'function') {
      const ic = kind === 'like' ? 'like' : kind === 'announce' ? 'flag' : 'comment';
      thjToast(body, kind === 'announce' ? 'warn' : 'info', ic);
    }
  }

  /* ── 시작: 배지 + 폴링 + 실시간 ── */
  refreshBadge();
  setInterval(() => { if (!document.hidden) refreshBadge(); }, 45000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshBadge(); });
  if (DB.subscribeNotifications) rtCh = DB.subscribeNotifications(onIncoming);
})();
