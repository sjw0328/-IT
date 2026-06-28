/* ═══════════════════════════════════════════════════════════
   토론하자 — me.js
   리텐션 레이어: 오늘의 토론 · 스트릭 · 예측 / 투표함 / 마이
   ── 개인 데이터는 전부 기기(localStorage) 저장 = 서버 0바이트.
      현재 비율·제목·카테고리·마감은 실제 DB(DB.topics)에서 파생.
   ── 뷰 라우팅(홈/투표함/마이)도 여기서 관리.
   (esc·fmt·icon·thjToast·openDetail·DB 는 전역)
   ═══════════════════════════════════════════════════════════ */
'use strict';
(function () {
  if (!window.DB) return;

  /* ── localStorage helper ── */
  function lsGet(k, d) { try { var v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function votes() { return window.THJ_VOTED || lsGet('thj_voted', {}); }
  function voteAt() { return lsGet('thj_vote_at', {}); }
  function predicts() { return lsGet('thj_predicts', {}); }

  var CATC = (typeof CAT_COLOR !== 'undefined') ? CAT_COLOR : {};
  function catColor(c) { return CATC[c] || 'var(--subtext)'; }
  function catTag(c) { return '<span class="tag" style="color:' + catColor(c) + ';background:color-mix(in oklab,' + catColor(c) + ' 15%,transparent)"><span class="tag-dot" style="background:' + catColor(c) + '"></span>' + esc(c) + '</span>'; }

  /* 마감 판정 (app.js isClosed 와 동일 규칙) */
  function isClosedT(t) { if (!t) return false; if (t.status === 'closed') return true; return !!(t.ends_at && new Date(t.ends_at).getTime() <= Date.now()); }
  function hoursLeft(t) { if (!t || !t.ends_at) return Infinity; return (new Date(t.ends_at).getTime() - Date.now()) / 3600000; }

  /* KST 날짜 문자열 */
  function kstDay(ts) { var d = ts ? new Date(ts) : new Date(); var k = new Date(d.getTime() + 9 * 3600000); return k.toISOString().slice(0, 10); }
  function kDateLabel() { var k = new Date(Date.now() + 9 * 3600000); return (k.getUTCMonth() + 1) + '월 ' + k.getUTCDate() + '일'; }

  /* ── 레벨 ── */
  var LEVELS = [
    { n: '토린이', min: 0 }, { n: '관전러', min: 5 }, { n: '입장러', min: 15 },
    { n: '열혈 논객', min: 30 }, { n: '논쟁의 달인', min: 60 }, { n: '토론왕', min: 120 }
  ];
  function levelOf(score) {
    var lv = 0; for (var i = 0; i < LEVELS.length; i++) { if (score >= LEVELS[i].min) lv = i; }
    var cur = LEVELS[lv], next = LEVELS[lv + 1];
    return { idx: lv + 1, name: cur.n, cur: cur.min, next: next ? next.min : cur.min, isMax: !next };
  }

  /* ── 배지 정의 + 판정 ── */
  var BADGES = [
    { k: 'first', e: '🗳️', n: '첫 한 표', d: '첫 표 던졌다. 시작이 반이다.' },
    { k: 'ten', e: '🔟', n: '10토론 참여', d: '토론 10개에 입장 박음.' },
    { k: 'streak7', e: '🔥', n: '7일 연속', d: '7일 연속 참여. 이쯤이면 중독.' },
    { k: 'minority', e: '🦔', n: '소수파 챔피언', d: '다수와 반대편에 다섯 번 이상. 소신 하나는 인정.' },
    { k: 'oracle', e: '🎯', n: '예측왕', d: '예측 적중률 80% 돌파. 판 읽는 눈 있네.' },
    { k: 'like10', e: '🏆', n: '공감 10+', d: '내 댓글이 공감 10개 이상 받음.' },
    { k: 'allcat', e: '🌐', n: '전 카테고리', d: '6개 카테고리 전부 투표 완료.' },
    { k: 'night', e: '🌙', n: '심야 토론러', d: '새벽(0~5시)에 토론한 적 있음.' }
  ];
  function computeBadges(s) {
    var got = [];
    if (s.tv >= 1) got.push('first');
    if (s.tv >= 10) got.push('ten');
    if (s.streak >= 7) got.push('streak7');
    if (s.minHit >= 5) got.push('minority');
    if (s.predTot >= 5 && s.predRate >= 80) got.push('oracle');
    if (s.likes >= 10) got.push('like10');
    if (s.catCount >= 6) got.push('allcat');
    if (s.night) got.push('night');
    return got;
  }
  function unlock(badge) {
    var u = document.getElementById('unlock'); if (!u) return;
    u.querySelector('.ue').textContent = badge.e;
    u.querySelector('.un').textContent = badge.n;
    u.querySelector('.ud').textContent = badge.d || '새 배지 획득.';
    u.classList.add('show');
  }
  /* 새로 획득한 배지 감지 → 모달/토스트. 최초 1회는 조용히 시드(스팸 방지). */
  function persistBadges(earned) {
    var stored = lsGet('thj_badges', null);
    if (stored == null) { lsSet('thj_badges', earned); return; }
    var fresh = earned.filter(function (k) { return stored.indexOf(k) < 0; });
    if (fresh.length) {
      lsSet('thj_badges', stored.concat(fresh));
      var first = BADGES.filter(function (b) { return b.k === fresh[0]; })[0];
      if (first) setTimeout(function () { unlock(first); }, 500);
      fresh.slice(1).forEach(function (k) { var b = BADGES.filter(function (x) { return x.k === k; })[0]; if (b) thjToast(b.e + ' ' + b.n + ' 배지 획득!', 'success'); });
    }
  }

  /* ── 스트릭 ── */
  function refreshStreakChip() {
    var chip = document.getElementById('streakChip'); if (!chip) return;
    var s = lsGet('thj_streak', 0);
    var votedToday = lsGet('thj_streak_day', '') === kstDay();
    chip.hidden = false;
    chip.classList.toggle('start', s < 1);
    if (s < 1) {
      chip.innerHTML = '<span class="streak-d">출석 시작</span>';
      chip.title = '오늘 첫 표로 연속 출석 시작';
    } else {
      chip.innerHTML = '<b id="streakN">' + s + '</b><span class="streak-d">일' + (votedToday ? '' : ' · 이어가기') + '</span>';
      chip.title = votedToday ? (s + '일 연속 · 오늘 완료') : (s + '일 연속 · 오늘 찍으면 ' + (s + 1) + '일째');
    }
  }
  function bumpStreak() {
    var today = kstDay(), last = lsGet('thj_streak_day', '');
    if (last === today) return false;
    var y = kstDay(Date.now() - 86400000), s = lsGet('thj_streak', 0);
    s = (last === y) ? s + 1 : 1;
    lsSet('thj_streak', s); lsSet('thj_streak_day', today);
    refreshStreakChip();
    return true;
  }

  /* ── 투표 기록 (상세 화면 훅 + 오늘의 토론 공용) ── */
  function recordVote(id, side, atRatio, topic) {
    var at = voteAt(); if (at[id] == null && atRatio != null) { at[id] = atRatio; lsSet('thj_vote_at', at); }
    var h = new Date().getHours(); if (h >= 0 && h < 5) lsSet('thj_night', 1);
    if (bumpStreak()) { var s = lsGet('thj_streak', 0); thjToast(s + '일 연속. 내일 또 와.', 'success', 'flame'); }
    updateBallotBadge();
    if (TODAY && id === TODAY.id) renderToday();
  }
  window.onThjVote = recordVote;
  window.onThjComment = function () {};

  /* ── 투표함 배지 (주목할 항목 수: 마감 / 내 쪽 역전) ── */
  async function updateBallotBadge() {
    var v = votes(), ids = Object.keys(v);
    function setN(n) { ['ballotNavBadge', 'ballotTabBadge'].forEach(function (id) { var el = document.getElementById(id); if (!el) return; el.textContent = n; el.hidden = n < 1; }); }
    if (!ids.length) { setN(0); return; }
    var topics = await DB.topics(); var by = {}; topics.forEach(function (t) { by[t.id] = t; });
    var at = voteAt(), n = 0;
    ids.forEach(function (id) {
      var t = by[id]; if (!t) return;
      var a = DB.ratio(t), mineWin = (v[id] === 'a' && a > 50) || (v[id] === 'b' && a < 50);
      var closed = isClosedT(t), atA = at[id];
      var flipped = atA != null && ((atA > 50) !== (a > 50));
      if (closed || (flipped && !mineWin)) n++;
    });
    setN(n);
  }

  /* ════════ 오늘의 토론 ════════ */
  var TODAY = null;
  async function renderToday() {
    var host = document.getElementById('todayHero'); if (!host) return;
    var topics = await DB.topics();
    if (!topics.length) { host.innerHTML = ''; return; }
    var by = {}; topics.forEach(function (t) { by[t.id] = t; });
    var active = topics.filter(function (t) { return !isClosedT(t); });
    var pool = active.length ? active : topics;
    var today = kstDay(), cachedId = lsGet('thj_today_id', null), cachedDay = lsGet('thj_today_day', '');
    var t = null;
    if (cachedDay === today && cachedId && by[cachedId]) t = by[cachedId];
    if (!t) {
      if (cachedDay && cachedDay !== today && cachedId) { lsSet('thj_prev_id', cachedId); }
      t = pool.slice().sort(function (x, y) { return (y.is_hot - x.is_hot) || (DB.voters(y) - DB.voters(x)) || (y.comment_count - x.comment_count); })[0];
      lsSet('thj_today_id', t.id); lsSet('thj_today_day', today);
    }
    TODAY = t;
    var a = DB.ratio(t), b = 100 - a, closed = isClosedT(t);
    var v = votes(), mySide = v[t.id] || null, pred = predicts()[t.id] || null;
    var streak = lsGet('thj_streak', 0), votedToday = lsGet('thj_streak_day', '') === today;
    var streakLine = '';
    if (!closed) {
      if (votedToday) streakLine = '<div class="daily-streak done">🔥 <b>' + streak + '일</b> 연속 · 내일도 이 시간에 새 토론 열린다</div>';
      else if (streak > 0) streakLine = '<div class="daily-streak">🔥 <b>' + streak + '일</b> 연속 · 오늘 한 표로 <b>' + (streak + 1) + '일째</b></div>';
    }
    var voteBlock = closed
      ? '<div class="daily-closed">' + icon('clock', 14) + ' 마감된 주제 · 결과 확인</div>'
      : (mySide ? predBlock(t, mySide, pred) : '<div class="vote-duo">' + vbtn('a', t.side_a_label || '찬성', a) + vbtn('b', t.side_b_label || '반대', b) + '</div>');

    host.innerHTML =
      '<div class="daily-hero">' +
        '<div class="daily-kicker">' + icon('flame', 13) + '오늘의 토론 · ' + kDateLabel() + '</div>' +
        catTag(t.category) +
        '<h2>' + esc(t.title) + '</h2>' +
        '<div class="dmeta">' +
          '<span><b>' + icon('users', 13) + ' ' + fmt(DB.voters(t)) + '</b> 참여</span>' +
          '<span>' + icon('comment', 13) + ' ' + fmt(t.comment_count) + '</span>' +
          (closed ? '<span style="color:var(--warn)">' + icon('clock', 13) + ' 마감</span>' : '<span style="color:var(--warn)">' + icon('clock', 13) + ' ' + (t.time || '진행중') + '</span>') +
        '</div>' +
        streakLine +
        voteBlock +
        '<button class="daily-open" data-open="' + t.id + '">전체 토론 보기 ' + icon('arrow-r', 13) + '</button>' +
      '</div>' +
      recapBlock(by);
    refreshStreakChip();
  }
  function vbtn(side, label, pct) {
    var base = (side === 'a' ? '찬성' : '반대');
    var lab = (label && label !== base) ? (base + ' · ' + esc(label)) : base;
    return '<button class="vbtn ' + side + '" data-tvote="' + side + '">' +
      '<span class="check">' + icon('check', 13) + '</span>' +
      '<span class="vlab">' + lab + '</span>' +
      '<span class="vpct">' + pct + '<small>%</small></span></button>';
  }
  function predBlock(t, mySide, pred) {
    var head = '<div class="voted-tag ' + mySide + '">' + icon('check', 14) + (mySide === 'a' ? '찬성' : '반대') + '에 투표함</div>';
    if (pred) {
      return '<div class="today-after">' + head +
        '<div class="predict-box done">' +
          '<div class="predict-done">' + icon('target', 15) + '예측 완료 · 최종 ' + (pred === 'a' ? '찬성' : '반대') + ' 우세에 걸었다</div>' +
          '<div class="psub">마감되면 투표함에서 적중 여부 자동 채점. 결과 보러 와.</div>' +
        '</div></div>';
    }
    return '<div class="today-after">' + head +
      '<div class="predict-box">' +
        '<div class="ph">' + icon('target', 15) + '한 발 더. 최종 승자 예측</div>' +
        '<div class="psub">마감 때 누가 이길까? 맞히면 적중률 오르고 「예측왕」 배지에 가까워진다.</div>' +
        '<div class="predict-row"><button class="pbtn a" data-tpredict="a">찬성이 이긴다</button><button class="pbtn b" data-tpredict="b">반대가 이긴다</button></div>' +
      '</div></div>';
  }
  function recapBlock(by) {
    var pid = lsGet('thj_prev_id', null); if (!pid) return '';
    var t = by[pid]; if (!t) return '';
    var v = votes(), mySide = v[pid], pred = predicts()[pid];
    if (!mySide && !pred) return '';
    var a = DB.ratio(t);
    var hit = pred ? ((pred === 'a' && a > 50) || (pred === 'b' && a < 50)) : null;
    var ico = hit == null ? '🗳️' : (hit ? '🎯' : '🌫️');
    var line = hit == null ? '내 입장: ' + (mySide === 'a' ? '찬성' : '반대') : (hit ? '예측 적중' : '예측 빗나감');
    return '<div class="recap' + (hit === false ? ' miss' : '') + '" data-open="' + t.id + '">' +
      '<div class="rico">' + ico + '</div>' +
      '<div><div class="rhit">' + (hit ? icon('check', 15) : '') + line + '</div>' +
      '<div class="rt">지난 주제 <b>「' + esc(t.title) + '」</b> · 현재 <b>찬성 ' + a + '%</b>' + (pred ? ' · 예측: ' + (pred === 'a' ? '찬성 우세' : '반대 우세') : '') + '</div></div></div>';
  }
  function doTodayVote(side) {
    var t = TODAY; if (!t) return;
    if (isClosedT(t)) { thjToast('마감된 토론', 'warn'); return; }
    var v = votes(); v[t.id] = side; lsSet('thj_voted', v); if (window.THJ_VOTED) window.THJ_VOTED[t.id] = side;
    DB.vote(t.id, side);
    thjToast((side === 'a' ? '찬성' : '반대') + '에 투표함 · 예측도 해봐', 'info', side === 'a' ? 'arrow-up' : 'arrow-dn');
    recordVote(t.id, side, DB.ratio(t), t);
    renderToday();
  }
  function doPredict(side) {
    var t = TODAY; if (!t) return;
    var p = predicts(); p[t.id] = side; lsSet('thj_predicts', p);
    thjToast('예측 등록 · 마감 때 채점한다', 'success', 'target');
    renderToday();
  }

  /* ════════ 투표함 ════════ */
  var BFILTER = 'all';
  function ballotStatus(t) { if (isClosedT(t)) return 'closed'; if (hoursLeft(t) <= 6) return 'soon'; return 'live'; }
  async function renderBallots() {
    var host = document.getElementById('view-ballots'); if (!host) return;
    var v = votes(), ids = Object.keys(v);
    var topics = await DB.topics(); var by = {}; topics.forEach(function (t) { by[t.id] = t; });
    var items = ids.map(function (id) { return by[id] ? { t: by[id], my: v[id] } : null; }).filter(Boolean);
    var order = { live: 0, soon: 1, closed: 2 };
    items.forEach(function (x) { x.status = ballotStatus(x.t); });
    items.sort(function (x, y) { return (order[x.status] - order[y.status]) || (DB.voters(y.t) - DB.voters(x.t)); });

    if (!items.length) {
      host.innerHTML = '<div class="section-h" style="margin-top:2px"><span class="st">내 투표함</span></div>' +
        '<div class="empty-feed"><div class="empty-emoji">🗳️</div><div class="empty-title">아직 투표한 토론 없음</div><div class="empty-sub">홈에서 찬반 골라봐. 네가 찍은 토론의 결말·역전·우세를 여기서 추적한다.</div><button class="btn accent" data-view="home" style="margin-top:14px">' + icon('home', 15) + '토론 보러가기</button></div>';
      return;
    }
    var counts = { all: items.length, live: 0, soon: 0, closed: 0 };
    items.forEach(function (x) { counts[x.status]++; });
    var filters = [['all', '전체'], ['live', '진행중'], ['soon', '마감임박'], ['closed', '마감']];
    var fbar = '<div class="filterbar">' + filters.map(function (f) {
      return '<button class="fchip' + (BFILTER === f[0] ? ' on' : '') + '" data-bfilter="' + f[0] + '">' + f[1] + '<span class="n">' + counts[f[0]] + '</span></button>';
    }).join('') + '</div>';
    var list = items.filter(function (x) { return BFILTER === 'all' || x.status === BFILTER; });
    var body = list.map(ballotHTML).join('') || '<div style="padding:46px 20px;text-align:center;color:var(--muted);font-size:13px">해당하는 토론 없음.</div>';
    host.innerHTML =
      '<div class="section-h" style="margin-top:2px"><span class="st">내 투표함</span><span class="sub">내가 찍은 토론은 어떻게 됐을까</span></div>' +
      fbar + body +
      '<div class="local-note" style="margin-top:18px">이 기록은 전부 <b>내 기기에만</b> 저장된다 · 서버 0바이트</div>';
  }
  function ballotHTML(x) {
    var t = x.t, my = x.my, now_a = DB.ratio(t), now_b = 100 - now_a;
    var at = voteAt()[t.id], pred = predicts()[t.id];
    var flip = at != null && ((at > 50) !== (now_a > 50));
    var winning = (my === 'a' && now_a > 50) || (my === 'b' && now_b > 50);
    var statusEl;
    if (x.status === 'closed') {
      var iWon = (my === 'a' && now_a > 50) || (my === 'b' && now_a < 50);
      statusEl = '<span class="status ' + (iWon ? 'win' : 'lose') + '">' + (iWon ? '내 쪽 승' : '내 쪽 패') + '</span>';
    } else if (flip) {
      statusEl = '<span class="status flip">역전됨</span>';
    } else if (x.status === 'soon') {
      statusEl = '<span class="status warn">' + icon('clock', 11) + '마감임박 ' + (t.time || '') + '</span>';
    } else {
      statusEl = '<span class="status ' + (winning ? 'win' : 'lose') + '">' + (winning ? '내 쪽 우세' : '내 쪽 열세') + '</span>';
    }
    var predEl = '';
    if (x.status === 'closed' && pred) {
      var pHit = (pred === 'a' && now_a > 50) || (pred === 'b' && now_a < 50);
      predEl = '<span class="predtag ' + (pHit ? 'hit' : 'miss') + '">' + icon('target', 12) + (pHit ? '예측 적중' : '예측 빗나감') + '</span>';
    } else if (pred) {
      predEl = '<span class="predtag pending">' + icon('target', 12) + '예측: ' + (pred === 'a' ? '찬성' : '반대') + '</span>';
    }
    var right = x.status === 'closed'
      ? '<span style="color:var(--muted);white-space:nowrap">최종 찬성 ' + now_a + '%</span>'
      : (flip ? '<span style="color:var(--warn);font-weight:800;white-space:nowrap">투표 땐 ' + Math.round(at) + '% → 지금 ' + now_a + '%</span>' : '<span style="color:var(--muted);white-space:nowrap">' + fmt(DB.voters(t)) + '명</span>');
    return '<div class="ballot' + (flip ? ' flip' : '') + '" data-open="' + t.id + '">' +
      '<div class="bt-top">' + catTag(t.category) + statusEl +
        '<span class="myside ' + my + '">' + (my === 'a' ? '내 입장: 찬성' : '내 입장: 반대') + '</span></div>' +
      '<h3>' + esc(t.title) + '</h3>' +
      '<div class="bbar-wrap"><div class="bbar-head"><span class="lead-a">찬성 ' + now_a + '%</span><span class="lead-b">' + now_b + '% 반대</span></div>' +
        '<div class="rbar-track"><div class="rbar-fill-a" style="width:' + now_a + '%"></div><div class="rbar-fill-b"></div></div></div>' +
      '<div class="bfoot">' + right + predEl + '</div></div>';
  }

  /* ════════ 마이 ════════ */
  async function renderProfile() {
    var host = document.getElementById('view-profile'); if (!host) return;
    var v = votes(), ids = Object.keys(v);
    var topics = await DB.topics(); var by = {}; topics.forEach(function (t) { by[t.id] = t; });
    var tv = ids.length, aN = 0, bN = 0, minHit = 0, minTot = 0, cats = {};
    ids.forEach(function (id) {
      if (v[id] === 'a') aN++; else bN++;
      var t = by[id]; if (!t) return;
      if (DB.voters(t) > 0) { minTot++; var a = DB.ratio(t); var myShare = v[id] === 'a' ? a : 100 - a; if (myShare < 50) minHit++; }
      if (t.category) cats[t.category] = (cats[t.category] || 0) + 1;
    });
    var leanA = tv ? Math.round(aN / tv * 100) : 50, leanB = 100 - leanA;
    var P = predicts(), predTot = 0, predHit = 0;
    Object.keys(P).forEach(function (id) { var t = by[id]; if (!t || !isClosedT(t)) return; predTot++; var a = DB.ratio(t); if ((P[id] === 'a' && a > 50) || (P[id] === 'b' && a < 50)) predHit++; });
    var predRate = predTot ? Math.round(predHit / predTot * 100) : 0;
    var minRate = minTot ? Math.round(minHit / minTot * 100) : 0;

    var ps = { comments: 0, likes: 0 };
    try { ps = await DB.myProfileStats(); } catch (e) {}
    var score = tv + ps.comments * 2 + Math.floor(ps.likes / 5);
    var lv = levelOf(score), lvPct = lv.isMax ? 100 : Math.round((score - lv.cur) / Math.max(lv.next - lv.cur, 1) * 100);

    var streak = lsGet('thj_streak', 0);
    var earned = computeBadges({ tv: tv, comments: ps.comments, likes: ps.likes, streak: streak, predRate: predRate, predTot: predTot, minHit: minHit, catCount: Object.keys(cats).length, night: lsGet('thj_night', 0) });
    persistBadges(earned);
    var earnedSet = {}; (lsGet('thj_badges', earned)).forEach(function (k) { earnedSet[k] = 1; });
    earned.forEach(function (k) { earnedSet[k] = 1; });

    var nick = DB.myNick(), avatar = DB.emojiFor(nick), tag = DB.tagOf((DB.uid) || nick);

    // 카테고리 막대
    var catTotal = Object.keys(cats).reduce(function (s, c) { return s + cats[c]; }, 0) || 1;
    var catSorted = Object.keys(cats).sort(function (p, q) { return cats[q] - cats[p]; }).slice(0, 6);
    var catHTML = catSorted.length ? catSorted.map(function (c) {
      var pct = Math.round(cats[c] / catTotal * 100);
      return '<div class="catrow"><span class="cn" style="color:' + catColor(c) + '">' + esc(c) + '</span><span class="ct"><i style="width:' + pct + '%;background:' + catColor(c) + '"></i></span><span class="cc">' + cats[c] + '</span></div>';
    }).join('') : '<div style="font-size:12.5px;color:var(--muted);padding:4px 2px">아직 투표 기록 없음.</div>';

    // 소수파 도넛
    var R = 26, C = 2 * Math.PI * R, off = C * (1 - minRate / 100);
    var ring = '<div class="ring"><svg width="62" height="62"><circle cx="31" cy="31" r="' + R + '" fill="none" stroke="var(--surface-3)" stroke-width="6"/><circle cx="31" cy="31" r="' + R + '" fill="none" stroke="var(--cat-politics)" stroke-width="6" stroke-linecap="round" stroke-dasharray="' + C + '" stroke-dashoffset="' + off + '"/></svg><span class="rv">' + minRate + '%</span></div>';
    var leanWord = leanB > leanA ? '반대형' : (leanA > leanB ? '찬성형' : '균형형');
    var leanCap = tv ? ('평균적으로 <b>' + leanWord + '</b>. ' + (leanB > leanA ? '새 주장엔 일단 의심부터 던지는 편' : (leanA > leanB ? '변화·도입에 손 들어주는 편' : '양쪽을 고루 저울질하는 편'))) : '투표 시작하면 네 찬반 기질이 그려진다.';

    var badgeHTML = BADGES.map(function (bd) {
      var on = !!earnedSet[bd.k];
      return '<div class="bdg' + (on ? ' earned' : '') + '">' + (on ? '' : '<span class="lock">🔒</span>') + '<span class="be">' + bd.e + '</span><span class="bn">' + bd.n + '</span></div>';
    }).join('');
    var badgeCount = Object.keys(earnedSet).length;

    host.innerHTML =
      '<div class="profile-hero">' +
        '<div class="ph-row"><div class="ph-av">' + avatar + '</div>' +
          '<div class="ph-id"><div class="ph-nick">' + esc(nick) + '<span class="tg">#' + esc(tag) + '</span></div>' +
            '<div class="ph-rank"><span class="lv">Lv.' + lv.idx + '</span>' + esc(lv.name) + '</div></div>' +
          '<button class="ph-edit" id="profEditNick" title="닉네임 바꾸기">' + icon('edit', 15) + '</button></div>' +
        '<div class="lvbar"><div class="lvb-head"><span>다음 등급까지</span><span>' + (lv.isMax ? '최고 등급' : (lv.next - score) + '점 남음') + '</span></div>' +
          '<div class="lvb-track"><div class="lvb-fill" style="width:' + lvPct + '%"></div></div></div>' +
      '</div>' +
      '<div class="stat-grid">' +
        stat('a', tv, '참여한 토론') + stat('live', predTot ? predRate + '%' : '–', '예측 적중률') +
        stat('g', ps.likes, '받은 공감') + stat('b', ps.comments, '남긴 의견') +
      '</div>' +
      '<div class="section-h"><span class="st">나의 토론 성향</span><span class="sub">투표 쌓일수록 정교해진다</span></div>' +
      '<div class="trait"><div class="tlabel">찬반 기질</div>' +
        '<div class="spectrum"><div class="sp-head"><span class="l">찬성 ' + leanA + '%</span><span class="r">반대 ' + leanB + '%</span></div>' +
          '<div class="sp-track"><div class="sp-knob" style="left:' + leanB + '%"></div></div>' +
          '<div class="sp-cap">' + leanCap + '</div></div>' +
        '<div class="minority">' + ring + '<div class="mtext"><b>소수파 지수 ' + minRate + '%</b><span>' + (minTot ? (minTot + '번 중 ' + minHit + '번, 다수와 반대편에 섰다.') : '투표 쌓이면 소수파 지수가 계산된다.') + '</span></div></div>' +
      '</div>' +
      '<div class="section-h"><span class="st">활동 카테고리</span></div>' +
      '<div class="trait"><div class="catbars">' + catHTML + '</div></div>' +
      '<div class="section-h"><span class="st">배지</span><span class="sub">' + badgeCount + ' / ' + BADGES.length + ' 획득</span></div>' +
      '<div class="badge-grid">' + badgeHTML + '</div>' +
      '<button class="share-cta" id="profShare">' + icon('share', 17) + '내 토론 성향 공유하기</button>' +
      '<div class="local-note">레벨·성향·배지·소수파 지수는 전부 <b>기기에서 계산</b>된다.<br>로그인도 서버 저장도 없이 \'나\'가 쌓인다.</div>';
  }
  function stat(cls, v, l) { return '<div class="stat"><div class="sv ' + cls + '">' + (typeof v === 'number' ? fmt(v) : v) + '</div><div class="sl">' + l + '</div></div>'; }

  /* ════════ 뷰 라우팅 ════════ */
  function showView(name) {
    document.querySelectorAll('.view').forEach(function (p) { p.classList.toggle('on', p.id === 'view-' + name); });
    document.querySelectorAll('.navprim').forEach(function (b) { b.classList.toggle('on', b.dataset.view === name); });
    document.querySelectorAll('.tabbtn').forEach(function (b) { b.classList.toggle('on', b.dataset.view === name); });
    var nc = document.getElementById('navCatWrap'); if (nc) nc.style.display = name === 'home' ? '' : 'none';
    var views = document.getElementById('views'); if (views) views.scrollTop = 0;
    if (name === 'home') renderToday();
    else if (name === 'ranking') { if (window.refreshRanking) window.refreshRanking(); }
    else if (name === 'ballots') renderBallots();
    else if (name === 'profile') renderProfile();
  }
  window.thjShowView = showView;

  /* ════════ 이벤트 ════════ */
  document.addEventListener('click', function (e) {
    var np = e.target.closest('.navprim, .tabbtn, [data-view]');
    if (np && np.dataset.view) { showView(np.dataset.view); return; }
    var tv = e.target.closest('[data-tvote]'); if (tv) { doTodayVote(tv.dataset.tvote); return; }
    var tp = e.target.closest('[data-tpredict]'); if (tp) { doPredict(tp.dataset.tpredict); return; }
    var op = e.target.closest('[data-open]'); if (op && op.dataset.open) { if (window.openDetail) openDetail(op.dataset.open); return; }
    var f = e.target.closest('[data-bfilter]'); if (f) { BFILTER = f.dataset.bfilter; renderBallots(); return; }
    if (e.target.closest('#unlockClose')) { document.getElementById('unlock').classList.remove('show'); return; }
    if (e.target.closest('#navEditionBtn')) { var eb = document.getElementById('editionBtn'); if (eb) eb.click(); return; }
    if (e.target.closest('#profEditNick')) { if (window.thjEditNick) thjEditNick(); return; }
    if (e.target.closest('#profShare')) {
      var url = location.origin + location.pathname;
      if (navigator.share) { navigator.share({ title: '토론하자', text: '찬반이 갈리는 실시간 토론, 토론하자', url: url }).catch(function () {}); }
      else { thjToast('내 토론 성향 공유해봐.', 'info', 'share'); }
      return;
    }
    var sc = e.target.closest('#streakChip');
    if (sc) { var s = lsGet('thj_streak', 0); thjToast(s > 0 ? (s + '일 연속. 하루도 빠지지 마.') : '오늘 첫 표로 연속 출석 시작', 'info', 'flame'); return; }
  });

  /* ════════ 초기화 ════════ */
  function init() { refreshStreakChip(); updateBallotBadge(); renderToday(); }
  if (document.readyState !== 'loading') init();
  else document.addEventListener('DOMContentLoaded', init);
})();
