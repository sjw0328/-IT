/* ═══════════════════════════════════════════════
   toronhaja — admin.js
   신고 목록 / KPI / 공지 — 전부 서버(Supabase) 구동
   ═══════════════════════════════════════════════ */

'use strict';

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* ── 신고 행 ─────────────────────────────────── */
function statusCell(r) {
  if (r.blinded) return `<span class="status live">${icon('eye', 11)}블라인드</span>`;
  return '<span class="status b">미처리</span>';
}
function reportRowHTML(r) {
  const side = r.comments.side || 'b';
  const target = r.comments.nickname || '알수없음';
  const blindAttr = r.blinded
    ? 'disabled style="height:28px;padding:0 9px;font-size:11.5px;opacity:.4;pointer-events:none"'
    : 'style="height:28px;padding:0 9px;font-size:11.5px"';
  return `
  <tr data-rid="${r.id}">
    <td><span class="nick ${side}" style="font-size:13px"><span class="nk-dot"></span>${esc(target)}</span></td>
    <td><span style="font-weight:600">${esc(r.reason) || '—'}</span></td>
    <td style="color:var(--subtext);max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.comments.content) || '—'}</td>
    <td style="color:var(--subtext);max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.topics.title)}</td>
    <td style="color:var(--muted);font-size:12px;white-space:nowrap">${esc(r.created_label)}</td>
    <td class="cell-status">${statusCell(r)}</td>
    <td style="text-align:right;white-space:nowrap">
      <button class="btn ghost act-blind" data-blind="${r.commentId || ''}" ${blindAttr}>${icon('eye', 12)}블라인드</button>
      <button class="btn act-delc" data-delc="${r.commentId || ''}" data-confirm="0" style="height:28px;padding:0 9px;font-size:11.5px;margin-left:6px;color:var(--b-bright);border-color:var(--b-border)">${icon('trash', 12)}삭제</button>
      <button class="btn danger act-ban" data-ban="${r.targetUserId || ''}" style="height:28px;padding:0 9px;font-size:11.5px;margin-left:6px">제재</button>
    </td>
  </tr>`;
}

function setKv(id, v) { const el = document.getElementById(id); if (el) animateCount(el, v, 700); }

async function renderReports() {
  const [reports, stats] = await Promise.all([DB.reports(), DB.adminStats()]);
  document.getElementById('reportRows').innerHTML = reports.length
    ? reports.map(reportRowHTML).join('')
    : `<tr><td colspan="7" style="padding:34px;text-align:center;color:var(--muted)">접수된 신고가 없습니다.</td></tr>`;
  document.getElementById('navBadge').textContent = reports.length;
  setKv('kpiTopics', stats.topics);
  setKv('kpiReports', stats.reports);
  setKv('kpiComments', stats.comments);
  setKv('kpiBanned', stats.banned);
}

/* ── 공지(announcements) ─────────────────────── */
async function renderAnnouncements() {
  const list = await DB.announcements();
  const box = document.getElementById('annList');
  if (!list.length) {
    box.innerHTML = `<div style="font-size:12.5px;color:var(--muted);padding:8px 2px">게시된 공지가 없습니다.</div>`;
    return;
  }
  box.innerHTML = list.map(a => `
    <div class="card" style="padding:12px 14px;${a.is_active ? '' : 'opacity:.5'}">
      <div style="font-size:13px;line-height:1.55;text-wrap:pretty;margin-bottom:9px">${esc(a.body)}</div>
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px">
        <span style="font-size:11px;color:var(--muted)">${a.is_active ? '<span style="color:var(--live);font-weight:800">● 게시중</span>' : '내림'} · ${relTime(a.created_at)}</span>
        <button class="btn ghost ann-toggle" data-id="${a.id}" data-on="${a.is_active ? '0' : '1'}" style="height:26px;padding:0 10px;font-size:11px">${a.is_active ? '내리기' : '다시 게시'}</button>
      </div>
    </div>`).join('');
}

document.getElementById('annPost').addEventListener('click', async () => {
  const ta = document.getElementById('annInput');
  const msg = document.getElementById('annMsg');
  const body = ta.value.trim();
  if (body.length < 2) { msg.style.color = 'var(--warn)'; msg.textContent = '공지 내용을 입력하세요'; return; }
  const btn = document.getElementById('annPost');
  btn.disabled = true; btn.textContent = '게시 중…';
  const res = await DB.addAnnouncement(body);
  btn.disabled = false; btn.innerHTML = `${icon('flag', 15)}공지 게시`;
  if (res && res.error) {
    msg.style.color = 'var(--b-bright)';
    msg.textContent = /relation|table|schema|find/i.test(res.error)
      ? 'announcements 테이블이 필요합니다 — announcements.sql 을 실행하세요'
      : '게시 실패: ' + res.error;
    return;
  }
  ta.value = '';
  msg.style.color = 'var(--live)'; msg.textContent = '공지가 메인 화면에 게시되었습니다 ✓';
  renderAnnouncements();
});

/* ── 토론 관리 ───────────────────────────────── */
function debateRowHTML(t) {
  const a = DB.ratio(t), b = 100 - a;
  const closed = t.status === 'closed';
  return `
  <tr data-did="${t.id}">
    <td style="max-width:300px"><div style="font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(t.title)}</div></td>
    <td><span class="tag" style="${catStyle(t.category)}"><span class="tag-dot" style="background:${CAT_COLOR[t.category] || 'var(--subtext)'}"></span>${esc(t.category)}</span></td>
    <td style="white-space:nowrap;font-variant-numeric:tabular-nums"><span style="color:var(--a-bright);font-weight:700">${a}%</span> <span style="color:var(--muted)">/</span> <span style="color:var(--b-bright);font-weight:700">${b}%</span></td>
    <td style="font-variant-numeric:tabular-nums">${fmt(t.comment_count)}</td>
    <td class="cell-dstatus">${closed ? '<span class="status warn">마감</span>' : '<span class="status live">진행중</span>'}</td>
    <td style="text-align:right;white-space:nowrap">
      <button class="btn ghost act-close" data-id="${t.id}" data-closed="${closed ? '1' : '0'}" style="height:28px;padding:0 11px;font-size:11.5px">${closed ? '재개' : '마감'}</button>
      <button class="btn danger act-del" data-id="${t.id}" data-confirm="0" style="height:28px;padding:0 10px;font-size:11.5px;margin-left:6px">삭제</button>
    </td>
  </tr>`;
}
async function renderDebates() {
  const list = await DB.topics();
  document.getElementById('debateRows').innerHTML = list.length
    ? list.map(debateRowHTML).join('')
    : `<tr><td colspan="6" style="padding:34px;text-align:center;color:var(--muted)">등록된 토론이 없습니다.</td></tr>`;
  document.getElementById('debCount').textContent = list.length + '개';
}

/* ── 데이터 관리 (storage) ─────────────────── */
function fmtBytes(b) {
  if (b == null) return '–';
  const mb = b / 1048576;
  if (mb < 1) return Math.max(1, Math.round(b / 1024)) + ' KB';
  if (mb < 1024) return mb.toFixed(1) + ' MB';
  return (mb / 1024).toFixed(2) + ' GB';
}

async function renderStorage() {
  const hint = document.getElementById('dbHint');
  const s = await DB.storageStats();
  if (!s || s.error) {
    document.getElementById('dbUsed').textContent = '–';
    document.getElementById('dbFill').style.width = '0%';
    hint.style.color = 'var(--b-bright)';
    hint.textContent = (s && /function|does not exist|find|schema|404/i.test(s.error || ''))
      ? 'cleanup.sql 을 Supabase SQL Editor 에서 실행하세요 — 정리 함수가 아직 없습니다.'
      : '통계를 불러오지 못했습니다' + (s && s.error ? ' — ' + s.error : '');
    return;
  }
  const LIMIT = 500 * 1048576;
  const used = s.bytes_total || 0;
  const mb = used / 1048576;
  const pct = Math.min(100, used / LIMIT * 100);
  document.getElementById('dbUsed').textContent = mb < 10 ? mb.toFixed(2) : mb.toFixed(1);
  const fill = document.getElementById('dbFill');
  fill.style.width = Math.max(pct, 1.5) + '%';
  fill.style.background = pct > 85 ? 'var(--b-bright)' : pct > 60 ? 'var(--warn)' : 'var(--live)';
  hint.style.color = 'var(--muted)';
  const est = s.estimated;
  hint.textContent = (est ? '⚠ 추정치 모드 (정확한 용량은 cleanup.sql 실행 후) · ' : `전체 ${pct.toFixed(1)}% 사용 · `)
    + `댓글 ${fmtBytes(s.bytes_comments)} · 투표 ${fmtBytes(s.bytes_votes)} · 정리 가능: 종료 토론 ${fmt(s.debates_closed || 0)}개`
    + (est ? '' : `, 고아 계정 ${fmt(s.orphan_users || 0)}개`);

  setKv('stTopics', s.debates || 0);
  setKv('stComments', s.comments || 0);
  setKv('stVotes', s.votes || 0);
  setKv('stUsers', s.users || 0);
  document.getElementById('stClosed').textContent = fmt(s.debates_closed || 0);
  document.getElementById('stOrphan').textContent = fmt(s.orphan_users || 0);
}

/* ── 탭 전환 ─────────────────────────────────── */
/* ── 사용자 현황 (DAU/WAU · 관리자가 열 때만 집계) ── */
let _usersPresenceStarted = false;
async function renderUsers() {
  const s = await DB.userStats();
  const hint = document.getElementById('usHint');
  const ids = ['usTotal', 'usDau', 'usWau', 'usNew', 'usCToday', 'usVToday'];
  const put = (id, v) => { const el = document.getElementById(id); if (el) { if (v == null) el.textContent = '–'; else animateCount(el, v, 700); } };
  if (!s || s.error) {
    ids.forEach(id => { const el = document.getElementById(id); if (el) el.textContent = '–'; });
    hint.style.color = 'var(--b-bright)';
    hint.textContent = '통계를 불러오지 못했습니다' + (s && s.error ? ' — ' + s.error : '');
  } else {
    put('usTotal', s.total_users); put('usDau', s.active_today); put('usWau', s.active_week);
    put('usNew', s.new_today); put('usCToday', s.comments_today); put('usVToday', s.votes_today);
    hint.style.color = 'var(--muted)';
    if (s.estimated) {
      hint.innerHTML = '⚠ 추정 모드 — <b style="color:var(--warn)">analytics.sql</b> 을 실행하면 정확한 DAU/WAU(서로 다른 활동 사용자)가 집계됩니다. 현재 DAU/WAU 칸은 비워두고 오늘 <b>댓글·투표 수</b>만 표시 중입니다.';
    } else {
      const parts = ['누적 ' + fmt(s.total_users || 0) + '명'];
      if (s.banned_users != null) parts.push('제재 ' + fmt(s.banned_users) + '명');
      parts.push('DAU·WAU = 댓글/투표를 한 서로 다른 사용자 수(KST 기준)');
      if (s.votes_has_ts === false) parts.push('votes에 created_at 없음 → 댓글 기준으로만 집계');
      hint.textContent = parts.join(' · ');
    }
  }
  if (!_usersPresenceStarted) {
    _usersPresenceStarted = true;
    const el = document.getElementById('usOnline');
    if (el && DB.presence) DB.presence('global', n => { el.textContent = fmt(Math.max(n, 1)); });
  }
}
document.getElementById('usersRefresh').addEventListener('click', renderUsers);

const ADMIN_VIEWS = ['view-reports', 'view-debates', 'view-users', 'view-storage'];
document.querySelectorAll('.admin-side .nav-item[data-view]').forEach(item => {
  item.addEventListener('click', () => {
    document.querySelectorAll('.admin-side .nav-item').forEach(n => n.classList.remove('on'));
    item.classList.add('on');
    const view = item.dataset.view;
    ADMIN_VIEWS.forEach(v => { const el = document.getElementById(v); if (el) el.style.display = v === view ? 'flex' : 'none'; });
    if (view === 'view-debates') renderDebates();
    else if (view === 'view-users') renderUsers();
    else if (view === 'view-storage') renderStorage();
    else renderReports();
  });
});

/* ── 정리 실행 (두 번 눌러 확인) ─────────────── */
document.getElementById('storageRefresh').addEventListener('click', renderStorage);
document.addEventListener('click', async (e) => {
  const run = e.target.closest('.cl-run');
  if (!run) return;
  if (run.dataset.confirm !== '1') {
    run.dataset.confirm = '1'; run.dataset.orig = run.textContent;
    run.textContent = '정말 삭제?';
    setTimeout(() => { if (run.isConnected && run.dataset.confirm === '1') { run.dataset.confirm = '0'; run.textContent = run.dataset.orig || '정리'; } }, 2600);
    return;
  }
  run.dataset.confirm = '0'; run.disabled = true; run.textContent = '정리 중…';
  const act = run.dataset.act;
  const resEl = document.getElementById({ debates: 'resDebates', reports: 'resReports', users: 'resUsers', strip: 'resStrip', auto: 'resAuto' }[act]);
  let res;
  if (act === 'debates') res = await DB.purgeOldDebates(+document.getElementById('daysDebates').value);
  else if (act === 'reports') res = await DB.purgeOldReports(+document.getElementById('daysReports').value);
  else if (act === 'strip') res = await DB.stripClosedDebates();
  else if (act === 'auto') {
    const r = await DB.runAutoCleanup();
    if (r && r.ok) {
      const s = r.summary || {};
      res = { ok: true, count: (s.stripped || 0) + (s.comments_deleted || 0) + (s.debates_deleted || 0) + (s.users_deleted || 0) };
    } else res = r;
  }
  else res = await DB.purgeOrphanUsers();
  run.disabled = false; run.textContent = run.dataset.orig || '정리';
  if (res && res.ok) {
    resEl.style.color = 'var(--live)';
    resEl.textContent = res.count > 0 ? `${fmt(res.count)}건 삭제 ✓` : '대상 없음';
    renderStorage();
    if (act === 'reports') renderReports();
  } else {
    resEl.style.color = 'var(--b-bright)';
    resEl.textContent = /function|does not exist|find|404/i.test((res && res.error) || '')
      ? ((act === 'strip' || act === 'auto') ? 'extreme.sql 필요' : 'cleanup.sql 필요') : '실패';
  }
});

/* ── 조치 / 공지 토글 (이벤트 위임) ──────────── */
document.addEventListener('click', async (e) => {
  const blind = e.target.closest('.act-blind');
  if (blind && !blind.disabled) {
    const cid = blind.dataset.blind;
    if (!cid) return;
    blind.disabled = true;
    const res = await DB.blindComment(cid);
    if (res && res.ok) {
      const row = blind.closest('tr');
      row.querySelector('.cell-status').innerHTML = `<span class="status live">${icon('eye', 11)}블라인드</span>`;
      blind.style.opacity = '0.4'; blind.style.pointerEvents = 'none';
    } else {
      blind.disabled = false;
      blind.innerHTML = icon('x', 12) + '실패';
      setTimeout(() => { blind.innerHTML = icon('eye', 12) + '블라인드'; }, 1600);
    }
    return;
  }

  const ban = e.target.closest('.act-ban');
  if (ban && !ban.disabled) {
    const uid = ban.dataset.ban;
    if (!uid) { ban.textContent = '대상없음'; ban.style.pointerEvents = 'none'; ban.style.opacity = '0.5'; return; }
    ban.disabled = true; ban.textContent = '제재중…';
    const res = await DB.banUser(uid, '관리자 제재');
    if (res && res.ok) {
      ban.textContent = '제재완료';
      ban.style.background = 'var(--surface-3)'; ban.style.color = 'var(--muted)'; ban.style.pointerEvents = 'none';
      renderReports();
    } else {
      ban.disabled = false; ban.textContent = '제재';
    }
    return;
  }

  const delc = e.target.closest('.act-delc');
  if (delc && !delc.disabled) {
    const cid = delc.dataset.delc;
    if (!cid) { delc.textContent = '대상없음'; delc.style.pointerEvents = 'none'; delc.style.opacity = '0.5'; return; }
    if (delc.dataset.confirm !== '1') {
      delc.dataset.confirm = '1'; delc.dataset.orig = delc.innerHTML; delc.textContent = '정말 삭제?';
      setTimeout(() => { if (delc.isConnected && delc.dataset.confirm === '1') { delc.dataset.confirm = '0'; delc.innerHTML = delc.dataset.orig; } }, 2600);
      return;
    }
    delc.disabled = true; delc.textContent = '삭제중…';
    const res = await DB.deleteComment(cid);
    if (res && res.ok) { renderReports(); }
    else {
      delc.disabled = false; delc.innerHTML = icon('x', 12) + '실패';
      setTimeout(() => { delc.innerHTML = icon('trash', 12) + '삭제'; }, 1600);
    }
    return;
  }

  const tog = e.target.closest('.ann-toggle');
  if (tog) {
    await DB.setAnnouncementActive(tog.dataset.id, tog.dataset.on === '1');
    renderAnnouncements();
    return;
  }

  const close = e.target.closest('.act-close');
  if (close && !close.disabled) {
    const willClose = close.dataset.closed !== '1';
    close.disabled = true;
    const res = await DB.setDebateClosed(close.dataset.id, willClose);
    if (res && res.ok) renderDebates();
    else { close.disabled = false; }
    return;
  }

  const del = e.target.closest('.act-del');
  if (del && !del.disabled) {
    if (del.dataset.confirm !== '1') {
      del.dataset.confirm = '1'; del.textContent = '정말?';
      setTimeout(() => { if (del.isConnected) { del.dataset.confirm = '0'; del.textContent = '삭제'; } }, 2500);
      return;
    }
    del.disabled = true; del.textContent = '삭제중…';
    const res = await DB.deleteDebate(del.dataset.id);
    if (res && res.ok) renderDebates();
    else { del.disabled = false; del.textContent = '삭제'; }
    return;
  }
});

/* ── 초기화 ─────────────────────────────────── */
renderReports();
renderAnnouncements();
