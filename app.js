/* ═══════════════════════════════════════════════
   toronhaja — app.js
   메인 피드 + 토론 상세 렌더링 / 인터랙션
   (DB 계층은 supabase.js, 아이콘/포맷은 icons.js)
   ═══════════════════════════════════════════════ */

'use strict';

let CURRENT = null;       // 현재 상세 토픽
let MY_SIDE = null;       // 내가 선택한 입장
let LOCKED = null;        // 마감/차단 잠금 사유 (null=자유)
const RT = { c: null, v: null, p: null };  // Realtime 채널 핸들 (댓글/투표/접속자)
const VOTED = JSON.parse(localStorage.getItem('thj_voted') || '{}');  // {topicId: 'a'|'b'}

/* ── 렌더: 토픽 카드 ─────────────────────────── */
function topicCardHTML(t) {
  const a = DB.ratio(t), b = 100 - a;
  const hot = t.is_hot ? `<span class="status hot">${icon('fire', 12)}실시간 급상승</span>` : '';
  return `
  <article class="card topic-card" data-id="${t.id}">
    <div class="card-top">
      <span class="tag" style="${catStyle(t.category)}"><span class="tag-dot" style="background:${(CAT_COLOR[t.category]||'var(--subtext)')}"></span>${t.category}</span>
      ${hot}
    </div>
    <h3>${t.title}</h3>
    <div class="rbar">
      <div class="rbar-head">
        <span class="rbar-side a">찬성 <b>${a}%</b></span>
        <span class="rbar-side b"><b>${b}%</b> 반대</span>
      </div>
      <div class="rbar-track">
        <div class="rbar-fill-a" style="width:${a}%"></div>
        <div class="rbar-fill-b"></div>
        <div class="rbar-knob" style="left:${a}%"></div>
      </div>
    </div>
    <div class="card-foot">
      <div class="meta">
        <span class="mi">${icon('comment', 14)}<span class="tnum">${fmt(t.comment_count)}</span></span>
        <span class="mi">${icon('users', 14)}<span class="tnum">${fmt(DB.voters(t))}</span></span>
        <span class="mi ${t.is_hot ? 'hot' : ''}">${icon(t.is_hot ? 'fire' : 'clock', 14)}<span class="tnum">${t.time || '진행중'}</span></span>
      </div>
      <span style="font-size:13px;font-weight:700;color:var(--a-text);display:inline-flex;align-items:center;gap:4px">참여하기 ${icon('arrow-up', 13, 'style="transform:rotate(90deg)"')}</span>
    </div>
  </article>`;
}

/* ── 렌더: 랭킹 아이템 ───────────────────────── */
function rankItemHTML(t, i) {
  const a = DB.ratio(t);
  const numColor = i === 0 ? 'var(--warn)' : i < 3 ? 'var(--text)' : 'var(--muted)';
  return `
  <div class="rank-item" data-id="${t.id}" style="cursor:pointer">
    <span class="rank-num" style="color:${numColor}">${i + 1}</span>
    <div class="rank-body">
      <div class="rank-title">${t.title}</div>
      <div class="rank-bar">
        <div class="rank-bar-track"><div class="rank-bar-fill" style="width:${a}%"></div></div>
        <span class="rank-voters">${fmt(DB.voters(t))}</span>
      </div>
    </div>
  </div>`;
}

/* ── 렌더: 댓글 카드 ─────────────────────────── */
function commentHTML(c) {
  if (c.is_blind) {
    return `<div class="comment ${c.side} blind"><div class="comment-body">🚫 신고 누적으로 블라인드 처리된 댓글입니다.</div></div>`;
  }
  const best = c.best ? `<span class="badge-best">${icon('trophy', 11)}BEST</span>` : '';
  const mine = c.mine ? `<span class="badge-me">내 댓글</span>` : '';
  return `
  <div class="comment ${c.side}" data-cid="${c.id}">
    <div class="comment-top">
      <div class="comment-meta">
        <div class="av ${c.side}" style="width:30px;height:30px">${c.emoji || '🙂'}</div>
        <span class="nick ${c.side}"><span class="nk-dot"></span>${c.nickname}</span>${c.tag ? `<span class="nick-tag">#${c.tag}</span>` : ''}
        ${best}${mine}
      </div>
      <span class="comment-time">${c.created_at || ''}</span>
    </div>
    <div class="comment-body">${c.body}</div>
    <div class="comment-foot">
      <button class="like-btn ${c.side}${c.liked ? ' on' : ''}" data-likes="${c.likes}">${icon('like', 13)}<span class="like-count tnum">${fmt(c.likes)}</span></button>
      <button class="report-btn" data-report="${c.id}">${icon('report', 12)}신고</button>
    </div>
  </div>`;
}

/* ── 렌더: 스켈레톤 (로딩 플레이스홀더) ─── */
function skeletonCards(n = 4) {
  return Array.from({ length: n }).map(() => `
  <article class="card sk-card">
    <div class="sk sk-line" style="width:32%"></div>
    <div class="sk sk-line" style="width:82%;height:18px;margin-top:14px"></div>
    <div class="sk sk-line" style="width:55%;height:18px;margin-top:8px"></div>
    <div class="sk sk-bar"></div>
    <div class="sk-row" style="margin-top:18px;justify-content:space-between">
      <div class="sk sk-line" style="width:130px"></div><div class="sk sk-line" style="width:60px"></div>
    </div>
  </article>`).join('');
}
function skeletonRank(n = 5) {
  return Array.from({ length: n }).map(() => `
  <div class="rank-item">
    <div class="sk" style="width:18px;height:18px;border-radius:5px"></div>
    <div class="rank-body"><div class="sk sk-line" style="width:90%"></div><div class="sk sk-bar" style="margin-top:8px;height:5px"></div></div>
  </div>`).join('');
}

/* ── 메인 렌더 ───────────────────────────────── */
function currentSort() {
  const on = document.querySelector('.sort-chip.is-on');
  return (on && on.dataset.sort) || 'hot';
}
async function renderMain(sort = 'hot') {
  const feed0 = document.getElementById('feed');
  if (feed0 && !feed0.querySelector('.topic-card')) {
    feed0.innerHTML = skeletonCards(4);
    const rl0 = document.getElementById('rankList');
    if (rl0 && !rl0.querySelector('.rank-item')) rl0.innerHTML = skeletonRank(5);
  }
  let topics = await DB.topics();
  const closeKey = t => DB.voters(t) > 0 ? Math.abs(DB.ratio(t) - 50) : 999;
  if (sort === 'pop') topics = [...topics].sort((x, y) => DB.voters(y) - DB.voters(x));
  else if (sort === 'new') topics = [...topics].sort((x, y) => new Date(y.created_at || 0) - new Date(x.created_at || 0));
  else if (sort === 'close') topics = [...topics].sort((x, y) => (closeKey(x) - closeKey(y)) || (DB.voters(y) - DB.voters(x)));
  else topics = [...topics].sort((x, y) => (y.is_hot - x.is_hot) || (y.comment_count - x.comment_count));

  const feed = document.getElementById('feed');
  if (!topics.length) {
    if (!DB.live || DB.lastError === 'network') {
      const offline = !DB.live;
      feed.innerHTML = `
      <div class="empty-feed">
        <div class="empty-emoji">${offline ? '🔌' : '📡'}</div>
        <div class="empty-title">${offline ? '서버에 연결되지 않았어요' : '연결이 불안정해요'}</div>
        <div class="empty-sub">${offline
          ? 'Supabase 설정을 확인해 주세요. (supabase.js 의 URL·KEY)'
          : '네트워크 상태를 확인한 뒤 다시 시도해 주세요.'}</div>
        ${offline ? '' : `<button class="btn accent" id="retryFeed" style="margin-top:14px">${icon('chart', 15)}다시 시도</button>`}
      </div>`;
      const rb = document.getElementById('retryFeed');
      if (rb) rb.addEventListener('click', () => { DB.invalidate && DB.invalidate(); renderMain(currentSort()); });
    } else {
      feed.innerHTML = `
      <div class="empty-feed">
        <div class="empty-emoji">🗳️</div>
        <div class="empty-title">아직 열린 토론이 없어요</div>
        <div class="empty-sub">서버(debates 테이블)에 토론이 등록되면 여기에 실시간으로 표시됩니다.</div>
        <a class="btn accent" href="create.html" style="margin-top:14px">${icon('plus', 15)}첫 토론 열기</a>
      </div>`;
    }
  } else {
    feed.innerHTML = topics.map(topicCardHTML).join('');
    if (!renderMain._intro) { renderMain._intro = true; feed.classList.add('intro'); setTimeout(() => feed.classList.remove('intro'), 800); }
  }

  const ranked = await DB.ranking(5);
  document.getElementById('rankList').innerHTML = ranked.length
    ? ranked.map(rankItemHTML).join('')
    : `<div style="padding:18px 4px;color:var(--muted);font-size:13px;text-align:center">집계할 토론이 없어요</div>`;

  initLive();
  renderAnnouncement();
}

/* ── 공지 배너 (서버 announcements) ─────────── */
async function renderAnnouncement() {
  const el = document.getElementById('annBanner');
  if (!el) return;
  const a = await DB.latestAnnouncement();
  if (!a) { el.innerHTML = ''; return; }
  const body = String(a.body).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  el.innerHTML = `<div class="ann-banner"><span class="ann-ico">${icon('flag', 16)}</span><div class="ann-text">${body}</div><span class="ann-tag">공지</span></div>`;
}

/* ── 상세 렌더 ───────────────────────────────── */
async function openDetail(id, fromHistory) {
  const t = await DB.topic(id);
  if (!t) { thjToast('토론을 찾을 수 없어요 (삭제되었을 수 있어요)', 'error'); leaveDetail(); return; }
  CURRENT = t;
  const a = DB.ratio(t), b = 100 - a;

  const closed = t.status === 'closed';
  document.getElementById('detailTop').innerHTML = `
    <span class="tag" style="${catStyle(t.category)}"><span class="tag-dot" style="background:${(CAT_COLOR[t.category]||'var(--subtext)')}"></span>${t.category}</span>
    ${closed
      ? `<span class="status warn">${icon('clock', 12)}마감된 토론</span>`
      : `<span class="status live"><span class="live-dot" style="width:6px;height:6px"></span>실시간 진행중</span>`}
    <span style="font-size:13px;color:var(--subtext);display:inline-flex;align-items:center;gap:6px">${icon('clock', 14)}${closed ? '' : '종료까지 '}<span class="tnum" style="color:var(--warn);font-weight:800">${t.time || '진행중'}</span></span>`;
  document.getElementById('detailTitle').textContent = t.title;

  document.getElementById('detailHero').innerHTML = `
    <div class="rhero">
      <div class="rhero-col a"><div class="lbl">찬성 · A</div><div class="rhero-num tnum">${a}<span>%</span></div><div class="rhero-sub tnum">${fmt(t.a_count)}명 참여</div></div>
      <div class="vs-badge">VS</div>
      <div class="rhero-col b"><div class="lbl">반대 · B</div><div class="rhero-num tnum">${b}<span>%</span></div><div class="rhero-sub tnum">${fmt(t.b_count)}명 참여</div></div>
    </div>
    <div class="rhero-track"><div class="fa" style="width:${a}%"></div><div class="fb"></div><div class="rhero-knob" style="left:${a}%"></div></div>`;

  // 댓글
  const [ca, cb] = await Promise.all([DB.comments(t.id, 'a'), DB.comments(t.id, 'b')]);
  if (ca[0]) ca[0].best = true;
  if (cb[0]) cb[0].best = true;
  document.getElementById('headA').innerHTML = `<span class="ch-title">${icon('arrow-up', 18)}찬성 측</span><span class="ch-count tnum">${fmt(t.a_count)}명 · 댓글 ${fmt(ca.length)}</span>`;
  document.getElementById('headB').innerHTML = `<span class="ch-title">${icon('arrow-dn', 18)}반대 측</span><span class="ch-count tnum">${fmt(t.b_count)}명 · 댓글 ${fmt(cb.length)}</span>`;
  document.getElementById('colA').innerHTML = ca.map(commentHTML).join('') || emptyCol('a');
  document.getElementById('colB').innerHTML = cb.map(commentHTML).join('') || emptyCol('b');

  // 모바일 찬/반 탭 (좌우 1단 전환)
  const _cols = document.getElementById('detailCols');
  if (_cols) { _cols.classList.remove('show-b'); _cols.classList.add('show-a'); }
  const _st = document.getElementById('sideTabs');
  if (_st) _st.innerHTML = `<div class="side-tabs-cap">${icon('comment', 13)}어느 쪽 의견을 볼까요</div><button class="side-tab a is-on" data-sidetab="a">${icon('arrow-up', 15)}찬성 의견 ${fmt(ca.length)}</button><button class="side-tab b" data-sidetab="b">${icon('arrow-dn', 15)}반대 의견 ${fmt(cb.length)}</button>`;

  // 투표 버튼
  document.getElementById('pctA').textContent = a + '%';
  document.getElementById('pctB').textContent = b + '%';
  document.querySelectorAll('#voteRow .vote-btn').forEach(btn => { btn.disabled = false; btn.style.pointerEvents = ''; });
  MY_SIDE = VOTED[t.id] || null;
  applyVoteUI(MY_SIDE, false);

  // 마감/차단 잠금
  LOCKED = null;
  if (t.status === 'closed') {
    LOCKED = '마감된 토론입니다 · 투표와 댓글이 종료되었습니다';
  } else {
    const ban = await DB.myBanStatus();
    if (ban.banned) LOCKED = '이용이 제한된 계정입니다 · ' + ban.reason;
  }
  if (LOCKED) applyLockUI(LOCKED);

  // ── 실시간 접속자 수: 이 토론을 보고 있는 사람 (Presence) ──
  if (RT.p) DB.unsubscribe(RT.p);
  const liveEl = document.getElementById('detailLive');
  liveEl.textContent = '1';
  RT.p = DB.presence('debate:' + t.id, (n) => { liveEl.textContent = fmt(Math.max(n, 1)); });

  // ── Realtime: 새 댓글 / 투표 변동 실시간 반영 ──
  if (RT.c) DB.unsubscribe(RT.c);
  if (RT.v) DB.unsubscribe(RT.v);
  RT.c = DB.subscribeComments(t.id, (c) => {
    if (c.mine) return;                       // 내 댓글은 등록 시 이미 추가됨
    const col = document.getElementById(c.side === 'a' ? 'colA' : 'colB');
    const ph = col.querySelector('div[style]');
    if (ph && !col.querySelector('.comment')) col.innerHTML = '';
    col.insertAdjacentHTML('afterbegin', commentHTML(c));
    col.firstElementChild.animate(
      [{ opacity: 0, transform: 'translateY(-8px)' }, { opacity: 1, transform: 'none' }],
      { duration: 260, easing: 'ease-out' });
  });
  RT.v = DB.subscribeVotes(t.id, async () => {
    const fresh = await DB.topic(t.id);
    if (fresh && document.getElementById('screen-detail').classList.contains('active')) refreshRatio(fresh);
  });

  document.title = t.title + ' · 토론하자';
  if (!fromHistory) history.pushState({ d: id }, '', thjLinkFor(id));
  goTo('screen-detail');
}

/* ── 투표 비율만 갱신 (실시간) ──────────────── */
function refreshRatio(t) {
  CURRENT = t;
  const a = DB.ratio(t), b = 100 - a;
  document.getElementById('detailLive').textContent = fmt(DB.voters(t));
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set('pctA', a + '%'); set('pctB', b + '%');
  document.querySelectorAll('#detailHero .rhero-num')[0].innerHTML = `${a}<span>%</span>`;
  document.querySelectorAll('#detailHero .rhero-num')[1].innerHTML = `${b}<span>%</span>`;
  document.querySelectorAll('#detailHero .rhero-sub')[0].textContent = `${fmt(t.a_count)}명 참여`;
  document.querySelectorAll('#detailHero .rhero-sub')[1].textContent = `${fmt(t.b_count)}명 참여`;
  const fa = document.querySelector('#detailHero .fa'), knob = document.querySelector('#detailHero .rhero-knob');
  if (fa) fa.style.width = a + '%';
  if (knob) knob.style.left = a + '%';
}

function emptyCol(side) {
  return `<div style="padding:24px 16px;text-align:center;color:var(--muted);font-size:13px">아직 ${side === 'a' ? '찬성' : '반대'} 의견이 없어요.<br>첫 의견을 남겨보세요.</div>`;
}

/* ── 투표 UI 반영 ────────────────────────────── */
function applyVoteUI(side, doVote) {
  document.querySelectorAll('#voteRow .vote-btn').forEach(btn => {
    const s = btn.dataset.side;
    btn.classList.toggle('is-sel', s === side);
    btn.style.opacity = side && s !== side ? '0.5' : '';
  });

  const wrap = document.getElementById('inputWrap');
  const label = document.getElementById('inputLabel');
  const input = document.getElementById('commentInput');
  const send = document.getElementById('sendBtn');

  wrap.classList.remove('a', 'b'); send.classList.remove('a', 'b'); label.classList.remove('a', 'b');

  if (!side) {
    input.disabled = true;
    input.placeholder = '입장을 선택하면 댓글을 작성할 수 있어요';
    label.style.color = 'var(--muted)';
    label.textContent = '먼저 찬성/반대 입장을 선택하세요';
    send.style.background = 'var(--surface-3)'; send.style.color = 'var(--muted)';
    return;
  }

  wrap.classList.add(side); send.classList.add(side); label.classList.add(side);
  send.style.background = ''; send.style.color = '';
  input.disabled = false;
  const nick = DB.myNick();
  input.placeholder = side === 'a' ? '찬성하는 이유를 남겨보세요…' : '반대하는 이유를 남겨보세요…';
  const dot = `<span style="width:6px;height:6px;border-radius:50%;background:var(--${side});display:inline-block"></span>`;
  label.innerHTML = `${dot} ${side === 'a' ? '찬성' : '반대'} 입장 · <span class="nick ${side}" style="font-size:12px"><span class="nk-dot"></span>${nick}</span> (으)로 작성`;

  if (doVote) {
    VOTED[CURRENT.id] = side;
    localStorage.setItem('thj_voted', JSON.stringify(VOTED));
    thjToast(`${side === 'a' ? '찬성' : '반대'}에 투표했어요 · 의견을 남겨보세요`, 'info', side === 'a' ? 'arrow-up' : 'arrow-dn');
    (async () => {
      await DB.vote(CURRENT.id, side);
      const fresh = await DB.topic(CURRENT.id);
      if (fresh && document.getElementById('screen-detail').classList.contains('active')) refreshRatio(fresh);
    })();
  }
}

/* ── 댓글 등록 ───────────────────────────────── */
async function submitComment() {
  const input = document.getElementById('commentInput');
  const body = input.value.trim();
  if (!body || !MY_SIDE || !CURRENT || LOCKED) return;
  input.value = '';

  const row = await DB.addComment({ topic_id: CURRENT.id, side: MY_SIDE, body });
  if (!row) { thjToast('등록 실패 — 잠시 후 다시 시도하세요', 'error'); input.value = body; return; }
  const col = document.getElementById(MY_SIDE === 'a' ? 'colA' : 'colB');
  if (col.querySelector('div[style]') && !col.querySelector('.comment')) col.innerHTML = '';  // empty placeholder 제거
  row.mine = true;
  col.insertAdjacentHTML('afterbegin', commentHTML(row));
  col.firstElementChild.animate(
    [{ opacity: 0, transform: 'translateY(-8px)' }, { opacity: 1, transform: 'none' }],
    { duration: 260, easing: 'ease-out' });
  thjToast('의견을 등록했어요', 'success');
}

/* ── 마감/차단 잠금 UI ────────────────── */
function applyLockUI(msg) {
  document.querySelectorAll('#voteRow .vote-btn').forEach(b => { b.disabled = true; b.style.opacity = '0.4'; b.style.pointerEvents = 'none'; });
  const input = document.getElementById('commentInput');
  const send = document.getElementById('sendBtn');
  const label = document.getElementById('inputLabel');
  input.disabled = true; input.value = ''; input.placeholder = msg;
  send.style.pointerEvents = 'none'; send.style.background = 'var(--surface-3)'; send.style.color = 'var(--muted)';
  label.classList.remove('a', 'b'); label.style.color = 'var(--warn)';
  label.innerHTML = `${icon('ban', 13)} ${msg}`;
}

/* ── 신고 사유 메뉴 ──────────────────── */
const REPORT_REASONS = ['욕설/비방', '도배/스팸', '허위사실', '음란성', '혐오발언'];
let reportMenuEl = null;
function closeReportMenu() { if (reportMenuEl) { reportMenuEl.remove(); reportMenuEl = null; } }
function openReportMenu(btn, cid) {
  closeReportMenu();
  const m = document.createElement('div');
  m.className = 'report-menu';
  m.innerHTML = `<div class="rm-title">신고 사유</div>` + REPORT_REASONS.map(r => `<button type="button" data-reason="${r}">${r}</button>`).join('');
  document.body.appendChild(m);
  const r = btn.getBoundingClientRect();
  m.style.top = (r.bottom + 6) + 'px';
  m.style.left = Math.max(8, Math.min(r.left, window.innerWidth - 184)) + 'px';
  reportMenuEl = m;
  m.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-reason]'); if (!b) return;
    DB.report(cid, b.dataset.reason);
    btn.innerHTML = icon('check', 12) + '신고됨';
    btn.style.color = 'var(--live)'; btn.style.pointerEvents = 'none';
    closeReportMenu();
  });
  setTimeout(() => document.addEventListener('click', onDocMenuClick, { once: true }), 0);
}
function onDocMenuClick(ev) { if (reportMenuEl && !reportMenuEl.contains(ev.target)) closeReportMenu(); }

/* ── 검색 ─────────────────────────── */
async function applySearch(q) {
  if (!q) { return renderMain((document.querySelector('.sort-chip.is-on') || {}).dataset ? document.querySelector('.sort-chip.is-on').dataset.sort : 'hot'); }
  let topics = await DB.topics();
  const lc = q.toLowerCase();
  if (q[0] === '#') { const c = q.slice(1); topics = topics.filter(t => (t.category || '').includes(c)); }
  else topics = topics.filter(t => (t.title || '').toLowerCase().includes(lc) || (t.category || '').includes(q));
  const safe = q.replace(/</g, '&lt;');
  const feed = document.getElementById('feed');
  feed.innerHTML = topics.length
    ? topics.map(topicCardHTML).join('')
    : `<div class="empty-feed"><div class="empty-emoji">🔍</div><div class="empty-title">검색 결과가 없어요</div><div class="empty-sub">“${safe}” 와 일치하는 토론을 찾지 못했어요.</div></div>`;
}

/* ── 라이브 숫자 (전부 서버 구동) ───────────────
   · 접속중   = 전역 Realtime Presence (실제 동시 접속자)
   · 진행중   = debates 행 수 (status != closed)
   · 분당 댓글 = 최근 60초 comments 수 (15초마다 폴링)        */
let liveStarted = false;
function initLive() {
  if (liveStarted) return; liveStarted = true;

  const liveEl = document.querySelector('#screen-main .live-counter b');
  if (liveEl) DB.presence('global', (n) => { liveEl.textContent = fmt(Math.max(n, 1)); });

  const cpmEl = document.getElementById('pulseCPM');
  const actEl = document.getElementById('pulseActive');
  async function refreshPulse() {
    const [cpm, act] = await Promise.all([DB.commentsPerMinute(), DB.activeDebateCount()]);
    if (cpmEl) cpmEl.textContent = fmt(cpm);
    if (actEl) actEl.textContent = fmt(act);
  }
  refreshPulse();
  setInterval(refreshPulse, 30000);   // 15s→30s: DAU 대비 폴링 요청 절반으로
}

/* ── 화면 전환 ───────────────────────────────── */
function goTo(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  window.scrollTo(0, 0);
}

/* ── 이벤트 위임 ─────────────────────────────── */
document.addEventListener('click', (e) => {
  const card = e.target.closest('.topic-card, .rank-item');
  if (card && card.dataset.id) { openDetail(card.dataset.id); return; }

  const back = e.target.closest('[data-back]');
  if (back) {
    if (history.state && history.state.d) history.back();
    else { history.replaceState(null, '', location.pathname + location.search); leaveDetail(); }
    return;
  }

  const stab = e.target.closest('[data-sidetab]');
  if (stab) {
    const s = stab.dataset.sidetab, cols = document.getElementById('detailCols');
    if (cols) { cols.classList.toggle('show-a', s === 'a'); cols.classList.toggle('show-b', s === 'b'); }
    document.querySelectorAll('#sideTabs .side-tab').forEach(b => b.classList.toggle('is-on', b.dataset.sidetab === s));
    return;
  }

  const vote = e.target.closest('.vote-btn');
  if (vote) { if (LOCKED) return; MY_SIDE = vote.dataset.side; applyVoteUI(MY_SIDE, true); document.getElementById('commentInput').focus(); return; }

  const like = e.target.closest('.like-btn');
  if (like) {
    const on = like.classList.toggle('on');
    const base = +like.dataset.likes;
    like.querySelector('.like-count').textContent = fmt(on ? base + 1 : base);
    DB.like(like.closest('.comment').dataset.cid, on);
    return;
  }

  const rep = e.target.closest('[data-report]');
  if (rep) { openReportMenu(rep, rep.dataset.report); return; }

  const sort = e.target.closest('.sort-chip');
  if (sort) {
    document.querySelectorAll('.sort-chip').forEach(c => c.classList.remove('is-on'));
    sort.classList.add('is-on');
    renderMain(sort.dataset.sort);
    return;
  }

  const nav = e.target.closest('.nav-item[data-cat]');
  if (nav) { document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('on')); nav.classList.add('on'); filterCat(nav.dataset.cat); return; }
});

/* 카테고리 필터 */
async function filterCat(cat) {
  let topics = await DB.topics();
  if (cat !== '전체') topics = topics.filter(t => t.category === cat);
  document.getElementById('feed').innerHTML = topics.map(topicCardHTML).join('') ||
    `<div style="padding:40px;text-align:center;color:var(--muted)">${cat} 카테고리에 진행중인 토론이 없어요.</div>`;
}

document.getElementById('sendBtn').addEventListener('click', submitComment);
document.getElementById('commentInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') submitComment(); });

const _searchEl = document.getElementById('searchInput');
if (_searchEl) _searchEl.addEventListener('input', () => applySearch(_searchEl.value.trim()));

/* ── leaveDetail / 해시 라우팅 ──────────── */
function leaveDetail() {
  if (RT.c) { DB.unsubscribe(RT.c); RT.c = null; }
  if (RT.v) { DB.unsubscribe(RT.v); RT.v = null; }
  if (RT.p) { DB.unsubscribe(RT.p); RT.p = null; }
  document.title = '토론하자 · 찬반이 갈리는 실시간 토론';
  goTo('screen-main');
}
window.addEventListener('popstate', () => {
  const m = (location.hash || '').match(/^#d\/(.+)$/);
  if (m) openDetail(m[1], true);
  else leaveDetail();
});

/* ── 닉네임 칩 + 공유 버튼 ──────────── */
function refreshMeChip() {
  const chip = document.getElementById('meChip');
  if (!chip) return;
  const nick = DB.myNick();
  chip.innerHTML = `<span class="me-av">${DB.emojiFor(nick)}</span><span class="me-nick"></span><span class="me-edit">${icon('edit', 13)}</span>`;
  chip.querySelector('.me-nick').textContent = nick;
}
window.refreshMeChip = refreshMeChip;
(function () {
  const chip = document.getElementById('meChip');
  if (chip) chip.addEventListener('click', () => { if (window.thjEditNick) thjEditNick(); });
  const sBtn = document.getElementById('shareBtn');
  if (sBtn) sBtn.addEventListener('click', () => { if (CURRENT && window.thjShare) thjShare(CURRENT); });
})();

/* ── 초기화 ─────────────────────────────────── */
refreshMeChip();
renderMain();
(function initRoute() {
  const m = (location.hash || '').match(/^#d\/(.+)$/);
  if (m) openDetail(m[1], true);
})();
