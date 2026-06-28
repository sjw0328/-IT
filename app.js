/* ═══════════════════════════════════════════════
   toronhaja — app.js
   메인 피드 + 토론 상세 렌더링 / 인터랙션
   (DB 계층은 supabase.js, 아이콘/포맷은 icons.js)
   ═══════════════════════════════════════════════ */

'use strict';

/* HTML 이스케이프 — 사용자 입력(댓글·제목·닉네임 등)을 innerHTML 에 넣기 전 반드시 통과.
   저장형 XSS 방지. (admin.js·공지 배너와 동일 정책) */
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/* 모노그램 — 이모지 아바타 대신 닉네임 머리글자(성인 톤) */
function thjMono(s) { return esc((String(s == null ? '' : s).trim()[0]) || '?'); }
window.thjMono = thjMono;

let CURRENT = null;       // 현재 상세 토픽
let MY_SIDE = null;       // 내가 선택한 입장
let LOCKED = null;        // 마감/차단 잠금 사유 (null=자유)
const RT = { c: null, v: null, p: null, vt: null };  // Realtime 채널 핸들 (댓글/투표/접속자) + 투표 재조회 타이머
let _detailToken = 0;     // 상세 진입 토큰 — 빠른 연속 진입 시 늦게 도착한 응답 무시
const VOTED = JSON.parse(localStorage.getItem('thj_voted') || '{}');  // {topicId: 'a'|'b'}
window.THJ_VOTED = VOTED;   // me.js 가 같은 객체를 공유 (오늘의 토론 히어로 투표 동기화)
let SELF_VOTE_GUARD = 0;   // 내 투표 직후 잠깐 동안 실시간 메아리 재조회를 건너뛴다(낙관적 화면 보호)

/* 실질 마감 판정 — status='closed' 이거나, 마감시간(ends_at)이 이미 지난 경우.
   (서버 status 가 아직 안 바뀐 토론도 UI 에선 마감으로 일관 처리 →
    "실시간 진행중" + "종료까지 종료됨" 같은 모순 표시 방지) */
function isClosed(t) {
  if (!t) return false;
  if (t.status === 'closed') return true;
  return !!(t.ends_at && new Date(t.ends_at).getTime() <= Date.now());
}

/* 에디션 배지 로컬 폴백 — 서버 comments.edition 컬럼이 없어도
   내가 쓴 댓글엔 에디션 태그가 유지되도록 {commentId: edition} 저장 */
const LOCAL_ED = JSON.parse(localStorage.getItem('thj_comment_ed') || '{}');

/* ── 에디션 전용 배지: "그 에디션으로 댓글 N개" 달성 시 획득 ── */
const EDITION_BADGE_MIN = 5;                                          // 획득 기준 개수
const ED_EARNED = new Set();                                         // "uid|edition" — 다른 사용자 획득분 (서버 집계)
const MY_ED_COUNT = JSON.parse(localStorage.getItem('thj_my_ed_count') || '{}');  // 내 에디션별 작성 수

function edKeyOf(c) { return (c && (c.edition || LOCAL_ED[c && c.id])) || ''; }
function hasEditionBadge(c, key) {
  if (!key) return false;
  if (c.mine) return (MY_ED_COUNT[key] || 0) >= EDITION_BADGE_MIN;   // 내 것: 로컬 카운트
  return !!(c.uid && ED_EARNED.has(c.uid + '|' + key));              // 남의 것: 서버 집계
}
function editionBadgeHTML(c) {
  const key = edKeyOf(c);
  const B = key && window.EDITION_BADGE && window.EDITION_BADGE[key];
  if (!B || !hasEditionBadge(c, key)) return '';
  return `<span class="badge-ed badge-ed--${B.cls}">${esc(B.label)}</span>`;
}
/* 막 5개를 채웠을 때 — 현재 화면에 떠 있는 내 그 에디션 댓글들에 배지 소급 부착 */
function awardEditionBadge(key) {
  const B = window.EDITION_BADGE && window.EDITION_BADGE[key];
  if (!B) return;
  document.querySelectorAll(`.comment[data-mine="1"][data-ed="${key}"] .comment-meta`).forEach(meta => {
    if (meta.querySelector('.badge-ed')) return;
    meta.insertAdjacentHTML('beforeend', `<span class="badge-ed badge-ed--${B.cls}">${esc(B.label)}</span>`);
  });
}

/* ── 렌더: 토픽 카드 ─────────────────────────── */
function topicCardHTML(t, i, arr) {
  reconcileMyVote(t);
  const a = DB.ratio(t), b = 100 - a;
  const closed = isClosed(t);
  const cc = CAT_COLOR[t.category] || 'var(--subtext)';
  const hasVotes = DB.voters(t) > 0;
  const lead = !hasVotes ? '' : (a > b ? 'a' : (b > a ? 'b' : 'tie'));
  // 디시식 글번호
  const no = Array.isArray(arr) ? (arr.length - i) : (i + 1);
  // 화력 — 댓글 수로 불꽃 등급 (1~3개)
  const heat = t.comment_count || 0;
  const flames = closed ? 0 : (heat >= 700 ? 3 : heat >= 180 ? 2 : heat >= 40 ? 1 : 0);
  const fireHTML = flames
    ? `<span class="bt-fire">${Array(flames).fill(icon('flame', 13)).join('')}</span>`
    : '';
  const gapTxt = !hasVotes ? '투표 0' : (a === b ? '완전 접전' : (Math.abs(a - b) <= 8 ? '초접전' : (Math.abs(a - b) >= 50 ? '압도적' : (lead === 'a' ? '찬성 우세' : '반대 우세'))));
  const myPick = (window.__thjPicks || {})[t.id] || '';
  return `
  <article class="card topic-card brow battle ${lead}${myPick ? ' picked-' + myPick : ''}${closed ? ' is-closed' : (t.is_hot ? ' is-hot' : '')}" data-id="${t.id}">
    <div class="bt-body">
      <div class="bt-head">
        <span class="bt-comm" style="color:${cc}">${esc(t.category)}</span>
        ${closed ? `<span class="bt-flag closed">종료</span>` : (t.is_hot ? `<span class="bt-flag hot">개념</span>` : '')}
        <span class="bt-tt">${esc(t.title)}</span>
        <span class="bt-cmt">${icon('comment', 12)}<span class="tnum">${fmt(t.comment_count)}</span></span>
        ${fireHTML}
      </div>
      <div class="bt-foot">
        <span class="bt-gap ${lead}">${gapTxt}</span>
        <span class="bt-meta">${icon('clock', 11)}${t.time || '진행중'}</span>
      </div>
    </div>
    <div class="bt-arena">
      <div class="bt-nums">
        <span class="bt-pct a${lead === 'a' ? ' lead' : ''}${myPick === 'a' ? ' mine' : ''}" data-cheer="a">찬성 <b class="tnum">${a}</b>%</span>
        <span class="bt-pct b${lead === 'b' ? ' lead' : ''}${myPick === 'b' ? ' mine' : ''}" data-cheer="b">반대 <b class="tnum">${b}</b>%</span>
      </div>
      <div class="bt-bar">
        <span class="bt-fill-a" style="width:${a}%" data-cheer="a"></span>
        <span class="bt-fill-b" style="width:${b}%" data-cheer="b"></span>
      </div>
    </div>
    <div class="bt-part">
      <b class="tnum">${fmt(DB.voters(t))}</b>
      <span>참여</span>
    </div>
  </article>`;
}

/* ── 렌더: 랭킹 아이템 ───────────────────────── */
function rankItemHTML(t, i) {
  reconcileMyVote(t);
  const a = DB.ratio(t);
  const numColor = i === 0 ? 'var(--warn)' : i < 3 ? 'var(--text)' : 'var(--muted)';
  return `
  <div class="rank-item" data-id="${t.id}" style="cursor:pointer">
    <span class="rank-num" style="color:${numColor}">${i + 1}</span>
    <div class="rank-body">
      <div class="rank-title">${esc(t.title)}</div>
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
    return `<div class="comment ${c.side} blind"><div class="comment-body">신고 누적으로 가려진 댓글.</div></div>`;
  }
  const best = c.best ? `<span class="badge-best">${icon('trophy', 11)}BEST</span>` : '';
  const mine = c.mine ? `<span class="badge-me">내 댓글</span>` : '';
  const edk = edKeyOf(c);
  const edAttrs = edk ? ` data-ed="${edk}"${c.mine ? ' data-mine="1"' : ''}` : '';
  return `
  <div class="comment ${c.side}" data-cid="${c.id}"${edAttrs}>
    <div class="comment-top">
      <div class="comment-meta">
        <div class="av ${c.side}" style="width:30px;height:30px">${thjMono(c.nickname)}</div>
        <span class="nick ${c.side}"><span class="nk-dot"></span>${esc(c.nickname)}</span>${c.tag ? `<span class="nick-tag">#${esc(c.tag)}</span>` : ''}${editionBadgeHTML(c)}
        ${best}${mine}
      </div>
      <span class="comment-time">${c.created_at || ''}</span>
    </div>
    <div class="comment-body">${esc(c.body)}</div>
    <div class="comment-foot">
      <button class="like-btn ${c.side}${c.liked ? ' on' : ''}" data-likes="${c.likes}">${icon('like', 13)}<span class="like-count tnum">${fmt(c.likes)}</span></button>
      <button class="report-btn${hasReported(c.id) ? ' done' : ''}" data-report="${c.id}"${hasReported(c.id) ? ' style="pointer-events:none"' : ''}>${icon(hasReported(c.id) ? 'check' : 'report', 12)}${hasReported(c.id) ? '신고됨' : '신고'}</button>
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
/* 카드 정렬 + 피드 렌더 (랭킹/공지 제외 — 즉시 페인트용으로도 재사용) */
function sortTopics(topics, sort) {
  const closeKey = t => DB.voters(t) > 0 ? Math.abs(DB.ratio(t) - 50) : 999;
  if (sort === 'pop') return [...topics].sort((x, y) => DB.voters(y) - DB.voters(x));
  if (sort === 'new') return [...topics].sort((x, y) => new Date(y.created_at || 0) - new Date(x.created_at || 0));
  if (sort === 'close') return [...topics].sort((x, y) => (closeKey(x) - closeKey(y)) || (DB.voters(y) - DB.voters(x)));
  return [...topics].sort((x, y) => (y.is_hot - x.is_hot) || (y.comment_count - x.comment_count));
}
function paintFeed(topics, sort) {
  const feed = document.getElementById('feed');
  if (!feed || !topics.length) return;
  feed.innerHTML = sortTopics(topics, sort).map(topicCardHTML).join('');
}

async function renderMain(sort = 'hot') {
  const feed0 = document.getElementById('feed');
  const needsFirstPaint = feed0 && !feed0.querySelector('.topic-card');
  if (needsFirstPaint) {
    // 이전 세션 스냅샷이 있으면 스켈레톤 대신 실제 카드를 즉시 그린다 (콜드 로드도 0.1초).
    const cached = DB.cachedTopics && DB.cachedTopics();
    if (cached && cached.length) {
      paintFeed(cached, sort);
    } else {
      feed0.innerHTML = skeletonCards(4);
      const rl0 = document.getElementById('rankList');
      if (rl0 && !rl0.querySelector('.rank-item')) rl0.innerHTML = skeletonRank(5);
    }
  }
  let topics = await DB.topics();
  topics = sortTopics(topics, sort);

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
          : '네트워크를 확인하고 다시 시도해 주세요.'}</div>
        ${offline ? '' : `<button class="btn accent" id="retryFeed" style="margin-top:14px">${icon('chart', 15)}다시 시도</button>`}
      </div>`;
      const rb = document.getElementById('retryFeed');
      if (rb) rb.addEventListener('click', () => { DB.invalidate && DB.invalidate(); renderMain(currentSort()); });
    } else {
      feed.innerHTML = `
      <div class="empty-feed">
        <div class="empty-emoji">🗳️</div>
        <div class="empty-title">아직 열린 토론이 없어요</div>
        <div class="empty-sub">토론이 등록되면 여기에 실시간으로 올라와요.</div>
        <a class="btn accent" href="create.html" style="margin-top:14px">${icon('plus', 15)}첫 토론 열기</a>
      </div>`;
    }
  } else {
    feed.innerHTML = topics.map(topicCardHTML).join('');
    if (!renderMain._intro) { renderMain._intro = true; feed.classList.add('intro'); setTimeout(() => feed.classList.remove('intro'), 800); }
  }

  const ranked = await DB.ranking(5);
  const rankHTML = ranked.length
    ? ranked.map(rankItemHTML).join('')
    : `<div style="padding:18px 4px;color:var(--muted);font-size:13px;text-align:center">집계할 토론이 없어요</div>`;
  const rlEl = document.getElementById('rankList');
  if (rlEl) rlEl.innerHTML = rankHTML;
  const hrEl = document.getElementById('homeRankList');
  if (hrEl) hrEl.innerHTML = rankHTML;

  initLive();
  renderAnnouncement();
}

/* ── 랭킹 탭 새로고침 (홈 피드와 분리된 별도 탭) ── */
async function refreshRanking() {
  const rlEl = document.getElementById('rankList');
  if (!rlEl) return;
  if (!rlEl.querySelector('.rank-item')) rlEl.innerHTML = skeletonRank(5);
  const ranked = await DB.ranking(5);
  rlEl.innerHTML = ranked.length
    ? ranked.map(rankItemHTML).join('')
    : `<div style="padding:18px 4px;color:var(--muted);font-size:13px;text-align:center">집계할 토론이 없어요</div>`;
}
window.refreshRanking = refreshRanking;

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
/* ── 상세 진입 ───────────────────────────────────
   목표: 탭을 누르면 0.1초 안에 화면이 뜬다.
   1) 캐시값(피드에서 보던 카테고리·제목·찬반·남은시간)으로 셸을 즉시 그리고 화면 전환
   2) 서버 최신 수치로 보정
   3) 가장 무거운 댓글은 화면이 뜬 뒤에 로드 */
async function openDetail(id, fromHistory) {
  const token = ++_detailToken;

  // ── 1) 캐시로 즉시 셸 + 화면 전환 ──
  let t = DB.cachedTopic ? DB.cachedTopic(id) : null;
  let shellShown = false;
  if (t) {
    renderDetailShell(t, true);
    document.title = t.title + ' · 토론하자';
    if (!fromHistory) history.pushState({ d: id }, '', thjPathFor(id));
    goTo('screen-detail');
    shellShown = true;
  }

  // ── 2) 서버 최신값 ──
  const fresh = await DB.topic(id);
  if (token !== _detailToken) return;        // 그 사이 다른 토론으로 이동함
  if (!fresh) {
    if (!t) { thjToast('토론을 찾을 수 없어요 (삭제됐을 수도 있어요)', 'error'); leaveDetail(); return; }
    // 캐시는 있고 서버만 없음 → 셸 그대로 유지
  } else {
    t = fresh;
    if (!shellShown) {
      renderDetailShell(t, true);
      document.title = t.title + ' · 토론하자';
      if (!fromHistory) history.pushState({ d: id }, '', thjPathFor(id));
      goTo('screen-detail');
      shellShown = true;
    } else {
      refreshDetailCounts(t);                // 수치만 캐시→서버값으로 보정
    }
  }
  CURRENT = t;

  // ── 3) 댓글·실시간·잠금 (화면 뜬 뒤) ──
  await loadDetailComments(t, token);
}

/* 상세 셸을 동기적으로 즉시 그린다 (네트워크 0). commentsLoading=true 면 댓글 자리에 스켈레톤. */
function renderDetailShell(t, commentsLoading) {
  CURRENT = t;
  const a = DB.ratio(t), b = 100 - a;
  const closed = isClosed(t);

  document.getElementById('detailTop').innerHTML = `
    <span class="tag" style="${catStyle(t.category)}"><span class="tag-dot" style="background:${(CAT_COLOR[t.category]||'var(--subtext)')}"></span>${esc(t.category)}</span>
    ${closed
      ? `<span class="status warn">${icon('clock', 12)}마감된 토론</span>`
      : `<span class="status live"><span class="live-dot" style="width:6px;height:6px"></span>실시간 진행중</span>`}
    <span style="font-size:13px;color:var(--subtext);display:inline-flex;align-items:center;gap:6px">${icon('clock', 14)}${closed ? '' : '종료까지 '}<span class="tnum" style="color:var(--warn);font-weight:800">${t.time || '진행중'}</span></span>`;
  document.getElementById('detailTitle').textContent = t.title;
  document.getElementById('detailHero').innerHTML = heroHTML(t, a, b);

  // 투표 버튼
  document.getElementById('pctA').textContent = a + '%';
  document.getElementById('pctB').textContent = b + '%';
  document.querySelectorAll('#voteRow .vote-btn').forEach(btn => { btn.disabled = false; btn.style.pointerEvents = ''; });
  MY_SIDE = VOTED[t.id] || null;
  applyVoteUI(MY_SIDE, false);

  // 모바일 찬/반 탭 (좌우 1단 전환)
  const _cols = document.getElementById('detailCols');
  if (_cols) { _cols.classList.remove('show-b'); _cols.classList.add('show-a'); }

  if (commentsLoading) {
    document.getElementById('headA').innerHTML = `<span class="ch-title">${icon('arrow-up', 18)}찬성 측</span><span class="ch-count tnum">${fmt(t.a_count)}명</span>`;
    document.getElementById('headB').innerHTML = `<span class="ch-title">${icon('arrow-dn', 18)}반대 측</span><span class="ch-count tnum">${fmt(t.b_count)}명</span>`;
    document.getElementById('colA').innerHTML = commentSkeletons();
    document.getElementById('colB').innerHTML = commentSkeletons();
    const _st = document.getElementById('sideTabs');
    if (_st) _st.innerHTML = `<button class="side-tab a is-on" data-sidetab="a">${icon('arrow-up', 15)}찬성</button><button class="side-tab b" data-sidetab="b">${icon('arrow-dn', 15)}반대</button>`;
  }
}

function heroHTML(t, a, b) {
  return `
    <div class="rhero">
      <div class="rhero-col a"><div class="lbl">찬성 · A</div><div class="rhero-num tnum">${a}<span>%</span></div><div class="rhero-sub tnum">${fmt(t.a_count)}명 참여</div></div>
      <div class="vs-badge">VS</div>
      <div class="rhero-col b"><div class="lbl">반대 · B</div><div class="rhero-num tnum">${b}<span>%</span></div><div class="rhero-sub tnum">${fmt(t.b_count)}명 참여</div></div>
    </div>
    <div class="rhero-track"><div class="fa" style="width:${a}%"></div><div class="fb"></div><div class="rhero-knob" style="left:${a}%"></div></div>`;
}

/* 댓글 로딩 스켈레톤 (찬/반 컬럼 1개당 3장) */
function commentSkeletons() {
  const card = `
    <div class="comment" style="pointer-events:none">
      <div class="comment-top"><div class="comment-meta">
        <div class="sk" style="width:30px;height:30px;border-radius:9px"></div>
        <div class="sk sk-line" style="width:74px"></div>
      </div></div>
      <div class="sk sk-line" style="width:100%;margin-top:4px"></div>
      <div class="sk sk-line" style="width:62%;margin-top:8px"></div>
    </div>`;
  return card.repeat(3);
}

/* 셸은 그대로 두고 찬반 수치/남은시간만 서버값으로 보정 */
function refreshDetailCounts(t) {
  const a = DB.ratio(t), b = 100 - a;
  const closed = isClosed(t);
  document.getElementById('detailTop').innerHTML = `
    <span class="tag" style="${catStyle(t.category)}"><span class="tag-dot" style="background:${(CAT_COLOR[t.category]||'var(--subtext)')}"></span>${esc(t.category)}</span>
    ${closed
      ? `<span class="status warn">${icon('clock', 12)}마감된 토론</span>`
      : `<span class="status live"><span class="live-dot" style="width:6px;height:6px"></span>실시간 진행중</span>`}
    <span style="font-size:13px;color:var(--subtext);display:inline-flex;align-items:center;gap:6px">${icon('clock', 14)}${closed ? '' : '종료까지 '}<span class="tnum" style="color:var(--warn);font-weight:800">${t.time || '진행중'}</span></span>`;
  document.getElementById('detailHero').innerHTML = heroHTML(t, a, b);
  document.getElementById('pctA').textContent = a + '%';
  document.getElementById('pctB').textContent = b + '%';
}

/* 댓글 + 에디션 배지 + 잠금 + 실시간 구독 — 화면이 뜬 뒤 실행되는 무거운 단계 */
async function loadDetailComments(t, token) {
  const closed = isClosed(t);

  // 댓글
  const [ca, cb] = await Promise.all([DB.comments(t.id, 'a'), DB.comments(t.id, 'b')]);
  if (token !== _detailToken) return;        // 그 사이 다른 토론으로 이동함
  if (ca[0]) ca[0].best = true;
  if (cb[0]) cb[0].best = true;

  // ── 에디션 배지 획득 판정 (작성자별 에디션 댓글 5개+) ──
  ED_EARNED.clear();
  const allC = ca.concat(cb);
  const uids = [...new Set(allC.map(c => c.uid).filter(Boolean))];
  if (uids.length && DB.editionCounts) {
    const counts = await DB.editionCounts(uids);
    if (token !== _detailToken) return;
    const meRow = allC.find(c => c.mine);
    const myUid = meRow ? meRow.uid : null;
    Object.keys(counts).forEach(uid => {
      Object.keys(counts[uid]).forEach(ed => {
        if (counts[uid][ed] >= EDITION_BADGE_MIN) ED_EARNED.add(uid + '|' + ed);
        if (uid === myUid) MY_ED_COUNT[ed] = Math.max(MY_ED_COUNT[ed] || 0, counts[uid][ed]);  // 내 카운트 서버값으로 보정
      });
    });
    if (myUid) { try { localStorage.setItem('thj_my_ed_count', JSON.stringify(MY_ED_COUNT)); } catch (e) {} }
  }
  document.getElementById('headA').innerHTML = `<span class="ch-title">${icon('arrow-up', 18)}찬성 측</span><span class="ch-count tnum">${fmt(t.a_count)}명 · 댓글 ${fmt(ca.length)}</span>`;
  document.getElementById('headB').innerHTML = `<span class="ch-title">${icon('arrow-dn', 18)}반대 측</span><span class="ch-count tnum">${fmt(t.b_count)}명 · 댓글 ${fmt(cb.length)}</span>`;
  document.getElementById('colA').innerHTML = ca.map(commentHTML).join('') || emptyCol('a');
  document.getElementById('colB').innerHTML = cb.map(commentHTML).join('') || emptyCol('b');

  // 모바일 찬/반 탭 (댓글 수 포함)
  const _st = document.getElementById('sideTabs');
  if (_st) _st.innerHTML = `<button class="side-tab a is-on" data-sidetab="a">${icon('arrow-up', 15)}찬성 <span class="st-n tnum">${fmt(ca.length)}</span></button><button class="side-tab b" data-sidetab="b">${icon('arrow-dn', 15)}반대 <span class="st-n tnum">${fmt(cb.length)}</span></button>`;
  // 셸 단계에서 a 탭이 켜져 있었으면 그대로 유지
  const _cols = document.getElementById('detailCols');
  if (_cols && _cols.classList.contains('show-b')) {
    _st.querySelector('.side-tab.a')?.classList.remove('is-on');
    _st.querySelector('.side-tab.b')?.classList.add('is-on');
  }

  // 마감/차단 잠금
  LOCKED = null;
  if (closed) {
    LOCKED = '마감된 토론 · 투표·댓글 종료됨';
  } else {
    const ban = await DB.myBanStatus();
    if (token !== _detailToken) return;
    if (ban.banned) {
      LOCKED = '이용 제한된 계정 · ' + ban.reason;
      if (ban.until) {
        const dt = new Date(ban.until);
        const p2 = n => String(n).padStart(2, '0');
        LOCKED += ` (해제 예정: ${dt.getFullYear()}.${p2(dt.getMonth() + 1)}.${p2(dt.getDate())} ${p2(dt.getHours())}:${p2(dt.getMinutes())})`;
      } else {
        LOCKED += ' (영구 정지)';
      }
    }
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
    bumpCommentCount(c.side);
  });
  RT.v = DB.subscribeVotes(t.id, () => {
    // 원격 투표가 몰려도 최대 5초에 한 번만 재조회 (집계 폭주 방지)
    if (RT.vt) return;
    RT.vt = setTimeout(async () => {
      RT.vt = null;
      if (Date.now() < SELF_VOTE_GUARD) return;   // 방금 내가 투표함 → 로컬 집계가 이미 정확, 메아리 무시
      const fresh = await DB.topic(t.id);
      if (fresh && document.getElementById('screen-detail').classList.contains('active')) refreshRatio(fresh);
    }, 5000);
  });
}

/* 내가 투표한 토론은 서버 집계가 아직(또는 끝내) 안 잡혀도
   비율이 50:50 으로 되돌아가지 않도록 보정한다.
   · 직전에 보이던 집계(CURRENT)보다 적게 오면 그대로 유지 → 표는 줄지 않음
   · 그래도 내가 찍은 쪽이 0 이면 최소 1 보장 */
function reconcileMyVote(t) {
  if (!t) return;
  const mine = VOTED[t.id];
  if (!mine) return;
  // 내가 찍은 “내 쪽”만 직전 본 집계 아래로 떨어지지 않게 보정(집계 지연 시 내 표가 사라지는 것 방지).
  //   상대 쪽은 서버값을 그대로 두어 실제 감소(투표 취소·삭제)도 화면에 반영된다.
  if (CURRENT && CURRENT.id === t.id) {
    if (mine === 'a') t.a_count = Math.max(+t.a_count || 0, +CURRENT.a_count || 0);
    else if (mine === 'b') t.b_count = Math.max(+t.b_count || 0, +CURRENT.b_count || 0);
  }
  if (mine === 'a' && (+t.a_count || 0) < 1) t.a_count = 1;
  if (mine === 'b' && (+t.b_count || 0) < 1) t.b_count = 1;
}

/* ── 투표 비율만 갱신 (실시간) ──────────────── */
function refreshRatio(t) {
  reconcileMyVote(t);          // 내 표가 서버 집계 지연/미유지로 사라지는 것 방지
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
  return `<div style="padding:24px 16px;text-align:center;color:var(--muted);font-size:13px">아직 ${side === 'a' ? '찬성' : '반대'}쪽 의견이 없어요.<br>첫 의견을 남겨보세요.</div>`;
}

/* ── 댓글 수 즉시 갱신 (헤더 · 모바일 탭) ─────── */
function bumpCommentCount(side) {
  if (CURRENT) CURRENT.comment_count = (+CURRENT.comment_count || 0) + 1;
  const col = document.getElementById(side === 'a' ? 'colA' : 'colB');
  const n = col ? col.querySelectorAll('.comment').length : 0;
  const head = document.getElementById(side === 'a' ? 'headA' : 'headB');
  const cc = head && head.querySelector('.ch-count');
  if (cc && CURRENT) {
    const cnt = side === 'a' ? CURRENT.a_count : CURRENT.b_count;
    cc.textContent = `${fmt(cnt)}명 · 댓글 ${fmt(n)}`;
  }
  const stab = document.querySelector(`#sideTabs .side-tab.${side} .st-n`);
  if (stab) stab.textContent = fmt(n);
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
    input.placeholder = '입장을 고르면 댓글을 쓸 수 있어요';
    label.style.color = 'var(--muted)';
    label.textContent = '먼저 찬성·반대를 골라주세요';
    send.style.background = 'var(--surface-3)'; send.style.color = 'var(--muted)';
    return;
  }

  wrap.classList.add(side); send.classList.add(side); label.classList.add(side);
  send.style.background = ''; send.style.color = '';
  input.disabled = false;
  const nick = DB.myNick();
  input.placeholder = side === 'a' ? '왜 찬성인지 근거를 적어주세요' : '왜 반대인지 근거를 적어주세요';
  const dot = `<span style="width:6px;height:6px;border-radius:50%;background:var(--${side});display:inline-block"></span>`;
  label.innerHTML = `${dot} ${side === 'a' ? '찬성' : '반대'} 입장 · <span class="nick ${side}" style="font-size:12px"><span class="nk-dot"></span>${nick}</span> (으)로 작성`;

  if (doVote) {
    const prev = VOTED[CURRENT.id] || null;     // 이번 클릭 직전의 내 입장
    // ── 로컬 즉시 집계 (서버 왕복 없이 0.1초 안에 화면 반영) ──
    if (prev !== side) {
      CURRENT.a_count = +CURRENT.a_count || 0;
      CURRENT.b_count = +CURRENT.b_count || 0;
      if (prev === 'a') CURRENT.a_count = Math.max(0, CURRENT.a_count - 1);
      else if (prev === 'b') CURRENT.b_count = Math.max(0, CURRENT.b_count - 1);
      if (side === 'a') CURRENT.a_count++; else CURRENT.b_count++;
      refreshRatio(CURRENT);                     // 기존+신규 데이터 종합 → 즉시 갱신
      DB.patchVote(CURRENT.id, prev, side);      // 피드/랭킹 캐시도 동일하게 로컬 보정
    }
    VOTED[CURRENT.id] = side;
    localStorage.setItem('thj_voted', JSON.stringify(VOTED));
    if (window.onThjVote) try { window.onThjVote(CURRENT.id, side, DB.ratio(CURRENT), CURRENT); } catch (e) {}
    // 첫 투표는 결과 모먼트(공유 유도)로, 입장 변경은 가볍게 토스트로
    if (!prev) showVoteResult(side);
    else thjToast(`${side === 'a' ? '찬성' : '반대'}(으)로 입장을 바꿨어요`, 'info', side === 'a' ? 'arrow-up' : 'arrow-dn');
    // 서버에는 한 번만 기록 (재조회 없음 — 로컬 집계가 이미 정확)
    DB.vote(CURRENT.id, side);
    SELF_VOTE_GUARD = Date.now() + 6000;   // 내 투표 메아리(subscribeVotes)가 낙관적 화면을 덮어쓰지 않게
  }
}

/* ── 투표 직후 결과 모먼트 ──────────────────────
   바이럴 루프의 핵심: 방금 찍은 입장이 소수/다수인지 즉시 보여주고(정체성),
   '결과 카드 공유'로 바로 연결한다. 첫 투표 때 1회만 뜸(입장 변경 땐 토스트). */
function showVoteResult(side) {
  if (!CURRENT) return;
  const a = DB.ratio(CURRENT), myPct = side === 'a' ? a : 100 - a;
  const even = myPct === 50, minority = myPct < 50;
  const sideLabel = side === 'a' ? '찬성' : '반대';
  const tag = even ? '정확히 반반' : (minority ? '소수 의견' : '다수 의견');
  const sub = even
    ? '딱 반반이에요. 한 표가 판세를 가릅니다.'
    : (minority
        ? `같은 편은 ${myPct}%뿐이에요. 흔한 입장이 아니에요. 제대로 보여주세요.`
        : `${myPct}%가 같은 편이에요. 대세를 인증해보세요.`);
  let el = document.getElementById('voteResult');
  if (!el) { el = document.createElement('div'); el.id = 'voteResult'; el.className = 'vresult'; document.body.appendChild(el); }
  el.innerHTML =
    '<div class="vresult-card vr-' + side + (minority && !even ? ' vr-minor' : '') + '">' +
      '<button class="vresult-x" aria-label="닫기">' + icon('x', 18) + '</button>' +
      '<div class="vresult-kicker">투표 완료</div>' +
      '<div class="vresult-side">나는 <b>' + sideLabel + '</b></div>' +
      '<div class="vresult-big"><span class="vresult-pct">' + myPct + '%</span><span class="vresult-tag">' + tag + '</span></div>' +
      '<div class="vresult-sub">' + sub + '</div>' +
      '<div class="vresult-actions">' +
        '<button class="vresult-share">' + icon('share', 16) + '결과 카드 공유</button>' +
        '<button class="vresult-comment">의견 남기기</button>' +
      '</div>' +
    '</div>';
  void el.offsetWidth; el.classList.add('show');
  const close = () => el.classList.remove('show');
  el.onclick = (e) => {
    if (e.target === el || e.target.closest('.vresult-x')) return close();
    if (e.target.closest('.vresult-share')) { close(); if (window.thjShare) thjShare(CURRENT, side); return; }
    if (e.target.closest('.vresult-comment')) { close(); const ci = document.getElementById('commentInput'); if (ci) ci.focus(); return; }
  };
}

/* ── 댓글 등록 ───────────────────────────────── */
async function submitComment() {
  const input = document.getElementById('commentInput');
  const body = input.value.trim();
  if (!body || !MY_SIDE || !CURRENT || LOCKED) return;
  if (body.length > 1000) { thjToast('댓글은 1000자까지 쓸 수 있어요', 'error'); return; }
  input.value = '';

  const ed = window.THJ_EDITION || '';
  const row = await DB.addComment({ topic_id: CURRENT.id, side: MY_SIDE, body, edition: ed });
  if (!row) { thjToast('등록에 실패했어요. 잠시 후 다시 시도해 주세요.', 'error'); input.value = body; return; }
  const col = document.getElementById(MY_SIDE === 'a' ? 'colA' : 'colB');
  if (col.querySelector('div[style]') && !col.querySelector('.comment')) col.innerHTML = '';  // empty placeholder 제거
  row.mine = true;
  if (ed) {                                  // 배지 로컬 폴백 저장 + 내 에디션 카운트
    row.edition = row.edition || ed;
    LOCAL_ED[row.id] = ed;
    MY_ED_COUNT[ed] = (MY_ED_COUNT[ed] || 0) + 1;
    try {
      localStorage.setItem('thj_comment_ed', JSON.stringify(LOCAL_ED));
      localStorage.setItem('thj_my_ed_count', JSON.stringify(MY_ED_COUNT));
    } catch (e) {}
  }
  col.insertAdjacentHTML('afterbegin', commentHTML(row));
  col.firstElementChild.animate(
    [{ opacity: 0, transform: 'translateY(-8px)' }, { opacity: 1, transform: 'none' }],
    { duration: 260, easing: 'ease-out' });
  bumpCommentCount(MY_SIDE);
  if (window.onThjComment) try { window.onThjComment(CURRENT.id, MY_SIDE); } catch (e) {}
  if (ed) {
    const B = window.EDITION_BADGE && window.EDITION_BADGE[ed];
    if (B && MY_ED_COUNT[ed] === EDITION_BADGE_MIN) {        // 방금 5개 달성 → 획득
      awardEditionBadge(ed);
      thjToast(`${B.label} 배지를 획득했어요.`, 'success');
      return;
    }
  }
  thjToast('등록 완료', 'success');
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

/* ── 신고 ────────────────────────────────────
   작은 드롭다운 → 사유 선택 + 확인이 있는 모달로 교체.
   · 한 번 신고한 댓글은 기기에 기억해 재신고 버튼을 잠금
   · 서버가 자동 블라인드를 알려주면 화면에서 즉시 가린다 */
const REPORT_REASONS = [
  ['욕설/비방', 'comment'],
  ['도배/스팸', 'copy'],
  ['허위사실', 'flag'],
  ['음란성', 'eye'],
  ['혐오발언', 'ban'],
  ['기타', 'report'],
];
function reportedSet() { try { return new Set(JSON.parse(localStorage.getItem('thj_reported') || '[]')); } catch (_) { return new Set(); } }
function hasReported(cid) { return reportedSet().has(String(cid)); }
function markReported(cid) { const s = reportedSet(); s.add(String(cid)); localStorage.setItem('thj_reported', JSON.stringify([...s])); }

/* 댓글 카드를 블라인드 상태로 즉시 교체 */
function blindCommentCard(cid) {
  const card = document.querySelector(`.comment[data-cid="${cid}"]`);
  if (!card) return;
  card.classList.add('blind');
  card.innerHTML = `<div class="comment-body">신고 누적으로 가려진 댓글.</div>`;
}

/* 신고 버튼을 "신고됨" 잠금 상태로 */
function lockReportBtn(btn) {
  if (!btn) return;
  btn.innerHTML = icon('check', 12) + '신고됨';
  btn.classList.add('done');
  btn.style.pointerEvents = 'none';
}

let reportModalOpen = false;
function openReportModal(cid, btn) {
  if (reportModalOpen) return;
  if (hasReported(cid)) { thjToast('이미 신고했어요', 'info', 'check'); lockReportBtn(btn); return; }
  if (typeof thjModal !== 'function') { thjToast('잠시 후 다시 시도해 주세요.', 'warn'); return; }
  reportModalOpen = true;

  const chips = REPORT_REASONS.map(([r, ic], i) =>
    `<button type="button" class="rp-reason" data-reason="${r}" aria-pressed="${i === 0 ? 'true' : 'false'}">${icon(ic, 15)}<span>${r}</span></button>`
  ).join('');

  const { ov, close } = thjModal(`
    <div class="rp-head">
      <div class="rp-ic">${icon('report', 20)}</div>
      <h2 class="rp-title">이 댓글 신고할까?</h2>
      <p class="rp-sub">신고 쌓이면 자동으로 가려지고 관리자가 봤다. 한 댓글당 한 번만 가능.</p>
    </div>
    <div class="rp-reasons">${chips}</div>
    <div class="rp-actions">
      <button class="rp-cancel" type="button">취소</button>
      <button class="rp-submit" type="button">${icon('report', 14)}신고하기</button>
    </div>
  `);

  ov.querySelector('.thj-modal').classList.add('report-modal');

  let picked = REPORT_REASONS[0][0];
  const reasonsWrap = ov.querySelector('.rp-reasons');
  reasonsWrap.addEventListener('click', (e) => {
    const b = e.target.closest('.rp-reason'); if (!b) return;
    reasonsWrap.querySelectorAll('.rp-reason').forEach(x => x.setAttribute('aria-pressed', 'false'));
    b.setAttribute('aria-pressed', 'true');
    picked = b.dataset.reason;
  });

  const done = () => { reportModalOpen = false; close(); };
  ov.querySelector('.rp-cancel').addEventListener('click', done);
  ov.addEventListener('click', (e) => { if (e.target === ov) done(); });

  const submit = ov.querySelector('.rp-submit');
  submit.addEventListener('click', async () => {
    submit.disabled = true; submit.innerHTML = icon('report', 14) + '접수 중…';
    const res = await DB.report(cid, picked);
    done();
    if (!res || !res.ok) {
      thjToast('신고에 실패했어요. 잠시 후 다시 시도해 주세요.', 'error');
      return;
    }
    markReported(cid);
    lockReportBtn(btn);
    if (res.status === 'already') { thjToast('이미 신고했어요', 'info', 'check'); }
    else if (res.status === 'gone') { thjToast('이미 삭제된 댓글이에요', 'info'); }
    else if (res.blinded) { blindCommentCard(cid); thjToast('신고가 누적되어 블라인드 처리됐어요', 'success', 'check'); }
    else {
      const left = res.threshold && res.count ? Math.max(res.threshold - res.count, 0) : 0;
      thjToast(left > 0 ? `신고 접수 · ${left}건 더 모이면 자동 블라인드` : '신고가 접수됐어요. 검토할게요.', 'success', 'check');
    }
  });
}

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
    : `<div class="empty-feed"><div class="empty-emoji">🔍</div><div class="empty-title">검색 결과 없음</div><div class="empty-sub">“${safe}” 관련 토론을 못 찾음.</div></div>`;
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
  const cpmHomeEl = document.getElementById('homePulseCPM');
  const actHomeEl = document.getElementById('homePulseActive');
  async function refreshPulse() {
    const [cpm, act] = await Promise.all([DB.commentsPerMinute(), DB.activeDebateCount()]);
    if (cpmEl) cpmEl.textContent = fmt(cpm);
    if (actEl) actEl.textContent = fmt(act);
    if (cpmHomeEl) cpmHomeEl.textContent = fmt(cpm);
    if (actHomeEl) actHomeEl.textContent = fmt(act);
  }
  refreshPulse();
  // 탭이 보일 때만 폴링 (백그라운드/숨겨진 탭은 서버 요청 안 보냄)
  setInterval(() => { if (!document.hidden) refreshPulse(); }, 30000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshPulse(); });
}

/* ── 화면 전환 ───────────────────────────────── */
function goTo(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  window.scrollTo(0, 0);
}

/* ── 좋아요 동기화 (연타 코얼레싱) ──────────────
   빠르게 여러 번 눌러도 서버에는 "최종 상태"만 한 번 반영한다.
   진행 중에 또 눌리면 끝난 뒤 최종값으로 한 번 더 맞춰 깜빡임/중복 insert 를 막는다. */
async function syncLike(btn, cid, want) {
  btn._want = want;
  if (btn._busy) return;
  btn._busy = true;
  let last;
  do { last = btn._want; await DB.like(cid, last); } while (btn._want !== last);
  btn._busy = false;
}

/* ── 이벤트 위임 ─────────────────────────────── */
document.addEventListener('click', (e) => {
  const card = e.target.closest('.topic-card, .rank-item');
  if (card && card.dataset.id) { openDetail(card.dataset.id); return; }

  const back = e.target.closest('[data-back]');
  if (back) {
    if (history.state && history.state.d) history.back();
    else { history.replaceState(null, '', thjBase()); leaveDetail(); }
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
    syncLike(like, like.closest('.comment').dataset.cid, on);
    return;
  }

  const rep = e.target.closest('[data-report]');
  if (rep) { openReportModal(rep.dataset.report, rep); return; }

  const sort = e.target.closest('.sort-chip');
  if (sort) {
    document.querySelectorAll('.sort-chip').forEach(c => c.classList.remove('is-on'));
    sort.classList.add('is-on');
    renderMain(sort.dataset.sort);
    return;
  }

  const nav = e.target.closest('.nav-item[data-cat]');
  if (nav) { document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('on')); nav.classList.add('on'); filterCat(nav.dataset.cat); return; }

  const hrCat = e.target.closest('.hr-cat[data-cat]');
  if (hrCat) {
    const cat = hrCat.dataset.cat;
    document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('on', n.dataset.cat === cat));
    filterCat(cat);
    return;
  }
});

/* 카테고리 필터 */
async function filterCat(cat) {
  let topics = await DB.topics();
  if (cat !== '전체') topics = topics.filter(t => t.category === cat);
  document.getElementById('feed').innerHTML = topics.map(topicCardHTML).join('') ||
    `<div style="padding:40px;text-align:center;color:var(--muted)">${cat}에 진행중인 토론 없음.</div>`;
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
  if (RT.vt) { clearTimeout(RT.vt); RT.vt = null; }
  document.title = '토론하자 · 찬반이 갈리는 실시간 토론';
  goTo('screen-main');
  // 상세에서 투표/변동이 있었을 수 있으니 피드 비율을 최신화 (캐시 무효 시에만 재요청)
  renderMain(currentSort());
}
window.addEventListener('popstate', () => {
  const id = (typeof thjRouteId === 'function') ? thjRouteId() : null;
  if (id) openDetail(id, true);
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
  if (sBtn) sBtn.addEventListener('click', () => { if (CURRENT && window.thjShare) thjShare(CURRENT, MY_SIDE); });
})();

/* ── 에디션 섹션 스크롤 감추기 ─────────────────
   card-list(#feed)를 스크롤 내릴 때 ed-picks·ed-banner 접힘,
   다시 올리면 펼쳐짐. 에디션 비활성 상태에서는 아무것도 없으니 무해. */
(function initEditionScroll() {
  const cardList = document.getElementById('views') || document.getElementById('feed');
  if (!cardList) return;
  let lastY = 0;
  cardList.addEventListener('scroll', function () {
    const y = cardList.scrollTop;
    const picks  = document.getElementById('edPicks');
    const banner = document.getElementById('edBanner');
    const goingDown = y > lastY;
    const threshold = 60; // px 이상 내려가야 접힘 시작
    if (y > threshold && goingDown) {
      picks  && picks.classList.add('scrolled-away');
      banner && banner.classList.add('scrolled-away');
    } else if (!goingDown) {
      picks  && picks.classList.remove('scrolled-away');
      banner && banner.classList.remove('scrolled-away');
    }
    lastY = y;
  }, { passive: true });
})();

/* ── 초기화 ─────────────────────────────────── */
refreshMeChip();
renderMain();
(function initRoute() {
  const id = (typeof thjRouteId === 'function') ? thjRouteId() : null;
  if (!id) return;
  openDetail(id, true);   // fromHistory=true → 새 히스토리 항목을 만들지 않는다
  // 정적 SEO 페이지(/d/<id>/) · 404 폴백(?d=) · 예전 해시(#d/) 로 들어왔어도
  // 주소창을 깔끔한 경로(/d/<id>)로 정규화한다.
  try {
    const clean = thjPathFor(id);
    if (location.pathname + location.search + location.hash !== clean) {
      history.replaceState({ d: id }, '', clean);
    }
  } catch (e) {}
})();
