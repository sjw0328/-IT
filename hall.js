/* ═══════════════════════════════════════════════════════════
   토론하자 — hall.js  (명예의 전당)
   디시 '개념글'·펨코 '포텐' 이 15년을 버티게 한 구조의 이식:
   잘 싸운 기록이 역사로 남는 곳. 화폐는 돈이 아니라 인정(공감).
   ── 서버 비용: 열 때 쿼리 2개(레전드=기존 랭킹 쿼리 재사용 · 명언 1쿼리)
      + 10분 localStorage 캐시 → 재방문 0쿼리.
      논객 랭킹은 명언 행을 클라이언트에서 집계 — 추가 쿼리 0.
   (esc·fmt·icon·thjMono·CAT_COLOR·DB·openDetail 은 전역)
   ═══════════════════════════════════════════════════════════ */
'use strict';
(function () {
  var CATC = (typeof CAT_COLOR !== 'undefined') ? CAT_COLOR : {};
  function catColor(c) { return CATC[c] || 'var(--subtext)'; }
  function catTagH(c) {
    var col = catColor(c);
    return '<span class="tag" style="color:' + col + ';background:color-mix(in oklab,' + col + ' 15%,transparent)"><span class="tag-dot" style="background:' + col + '"></span>' + esc(c) + '</span>';
  }
  function isClosedH(t) { if (!t) return false; if (t.status === 'closed') return true; return !!(t.ends_at && new Date(t.ends_at).getTime() <= Date.now()); }
  function medalCls(i) { return i === 0 ? ' gold' : i === 1 ? ' silver' : i === 2 ? ' bronze' : ''; }
  function clip(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
  function emptyBox(msg) { return '<div class="hall-empty">' + msg + '</div>'; }

  /* ── 레전드 토론 (역대 최다 참여) ── */
  function legendHTML(t, i) {
    var a = DB.ratio(t), b = 100 - a, closed = isClosedH(t);
    return '<div class="hl-item" data-open="' + t.id + '">' +
      '<span class="hl-rank' + medalCls(i) + '">' + (i + 1) + '</span>' +
      '<div class="hl-body">' +
        '<div class="hl-top">' + catTagH(t.category) +
          (closed ? '<span class="status warn">종료</span>' : '<span class="status live"><span class="live-dot" style="width:5px;height:5px"></span>진행중</span>') +
          '<span class="hl-part">' + icon('users', 12) + '<b class="tnum">' + fmt(DB.voters(t)) + '</b>명</span></div>' +
        '<h3 class="hl-title">' + esc(t.title) + '</h3>' +
        '<div class="hl-head"><span class="la">찬성 ' + a + '%</span><span class="lb">' + b + '% 반대</span></div>' +
        '<div class="rbar-track"><div class="rbar-fill-a" style="width:' + a + '%"></div><div class="rbar-fill-b"></div></div>' +
      '</div></div>';
  }

  /* ── 명언 (공감 상위 의견) ── */
  function quoteHTML(q, i) {
    return '<div class="hq ' + q.side + '" data-open="' + q.debateId + '">' +
      '<span class="hl-rank' + medalCls(i) + '">' + (i + 1) + '</span>' +
      '<div class="hq-main">' +
        '<div class="hq-body">' + esc(clip(q.body, 150)) + '</div>' +
        '<div class="hq-meta">' +
          '<span class="nick ' + q.side + '"><span class="nk-dot"></span>' + esc(q.nickname) + '</span>' +
          '<span class="nick-tag">#' + esc(q.tag) + '</span>' +
          '<span class="hq-likes">' + icon('like', 12) + '<b class="tnum">' + fmt(q.likes) + '</b></span>' +
          '<span class="hq-from">「' + esc(clip(q.debateTitle, 28)) + '」</span>' +
        '</div>' +
      '</div></div>';
  }

  /* ── 논객 랭킹 (명언으로 쌓은 공감 — 클라이언트 집계) ── */
  function speakerHTML(s, i) {
    return '<div class="hs-row">' +
      '<span class="hl-rank' + medalCls(i) + '">' + (i + 1) + '</span>' +
      '<div class="hs-av">' + thjMono(s.nickname) + '</div>' +
      '<div class="hs-id">' + esc(s.nickname) + ' <span class="nick-tag">#' + esc(s.tag) + '</span></div>' +
      '<div class="hs-stats">공감 <b class="tnum">' + fmt(s.likes) + '</b> · 명언 ' + s.quotes + '</div>' +
    '</div>';
  }

  var busy = false;
  async function renderHall(force) {
    var host = document.getElementById('view-hall');
    if (!host || busy) return;
    busy = true;
    if (!host.querySelector('.hall-wrap')) {
      host.innerHTML = '<div class="hall-wrap">' +
        '<div class="sk sk-line" style="width:42%;height:24px"></div>' +
        '<div class="sk" style="margin-top:16px;height:110px;border-radius:14px"></div>' +
        '<div class="sk" style="margin-top:12px;height:110px;border-radius:14px"></div></div>';
    }
    var d = null;
    try { d = (window.DB && DB.hallOfFame) ? await DB.hallOfFame(force) : null; } catch (e) {}
    busy = false;
    if (!d) {
      host.innerHTML = '<div class="empty-feed"><div class="empty-emoji">' + icon('trophy', 34) + '</div><div class="empty-title">전당을 불러오지 못했어요</div><div class="empty-sub">네트워크를 확인하고 다시 시도해 주세요.</div></div>';
      return;
    }
    var legends = d.legends || [], quotes = d.quotes || [], speakers = d.speakers || [];
    host.innerHTML =
      '<div class="hall-wrap" data-screen-label="명예의 전당">' +
        '<div class="hall-hero">' +
          '<div class="hh-kicker">' + icon('trophy', 13) + 'HALL OF FAME</div>' +
          '<h2>명예의 전당</h2>' +
          '<p>가장 뜨거웠던 토론, 가장 인정받은 의견, 가장 날카로운 논객.<br>여기 이름을 남기는 방법은 하나 — 잘 싸우는 것.</p>' +
          '<button class="hall-refresh" id="hallRefresh" type="button">' + icon('chart', 13) + '갱신</button>' +
        '</div>' +
        '<div class="section-h"><span class="st">레전드 토론</span><span class="sub">역대 최다 참여</span></div>' +
        (legends.length ? legends.map(legendHTML).join('') : emptyBox('아직 기록될 토론이 없어요.')) +
        '<div class="section-h"><span class="st">명언의 전당</span><span class="sub">공감 상위 의견</span></div>' +
        (quotes.length
          ? '<div class="hq-list">' + quotes.map(quoteHTML).join('') + '</div>'
          : emptyBox(d.noBest ? '공감 집계를 준비하고 있어요.' : '아직 공감을 받은 의견이 없어요.<br>첫 명언의 주인공이 되어보세요.')) +
        (speakers.length
          ? '<div class="section-h"><span class="st">논객 랭킹</span><span class="sub">명언으로 쌓은 공감</span></div><div class="hs-list">' + speakers.map(speakerHTML).join('') + '</div>'
          : '') +
        '<div class="local-note">전당은 <b>10분마다</b> 갱신된다 · 서버 요청을 아끼기 위해 캐시로 동작</div>' +
      '</div>';
    if (d.noBest) console.warn('[toronhaja] 명언·논객 랭킹은 sql/best.sql 실행 후 활성화됩니다.');
  }
  window.renderHall = renderHall;

  /* 갱신 버튼 — 캐시 무시하고 즉시 재조회 (data-open 클릭은 me.js 전역 핸들러가 처리) */
  document.addEventListener('click', function (e) {
    if (e.target.closest('#hallRefresh')) renderHall(true);
  });
})();
