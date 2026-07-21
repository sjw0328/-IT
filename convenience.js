/* ═══════════════════════════════════════════════
   toronhaja — convenience.js
   사용자 편의 레이어 (기존 app.js 동작은 건드리지 않고 위에 얹는다)
   ① 목록 ↔ 상세 스크롤 위치 복원 + 방금 본 카드 하이라이트
   ② 모바일 좌측 가장자리 스와이프 → 뒤로가기
   ③ 댓글 입력: 자동 높이(멀티라인) + 글자수 안내
   ※ 한글 IME 안전한 Enter 전송은 app.js 의 keydown 에서 처리
   ═══════════════════════════════════════════════ */
(function () {
  'use strict';

  /* ── ① 목록 ↔ 상세 스크롤 복원 ──────────────────
     상세로 들어가기 직전 피드 스크롤 위치를 기억했다가,
     뒤로 돌아오면 그 자리로 되돌린다. (피드가 다시 그려지며 0으로
     튕기던 "위치 풀림" 해결.) 복원 중 사용자가 스크롤하면 즉시 중단. */
  var views = document.getElementById('views');
  var main  = document.getElementById('screen-main');
  if (views && main) {
    var savedY = 0, lastId = '', restoring = false;

    document.addEventListener('click', function (e) {
      var card = e.target.closest('.topic-card, .rank-item');
      if (card && card.dataset.id) {
        savedY = views.scrollTop;
        lastId = card.dataset.id;
      }
    }, true);  // 캡처 단계 — openDetail 호출 전에 위치 확보

    var obs = new MutationObserver(function () {
      if (main.classList.contains('active') && savedY > 4) restoreScroll(savedY, lastId);
    });
    obs.observe(main, { attributes: true, attributeFilter: ['class'] });

    function restoreScroll(target, id) {
      if (restoring) return;
      restoring = true;
      var tries = 0, userMoved = false;
      function onUser() { userMoved = true; }
      views.addEventListener('wheel', onUser, { passive: true });
      views.addEventListener('touchmove', onUser, { passive: true });
      (function tick() {
        if (userMoved) return done();
        // 피드가 그 위치까지 그려졌으면 복원
        if (views.scrollHeight - views.clientHeight >= target - 4) {
          views.scrollTop = target;
          requestAnimationFrame(function () { if (!userMoved) views.scrollTop = target; });
          highlight(id);
          return done();
        }
        if (++tries > 45) return done();        // ~1.5s 안전 타임아웃
        setTimeout(tick, 32);
      })();
      function done() {
        restoring = false; savedY = 0;
        views.removeEventListener('wheel', onUser);
        views.removeEventListener('touchmove', onUser);
      }
    }

    function highlight(id) {
      if (!id) return;
      var card = document.querySelector('.topic-card[data-id="' + (window.CSS && CSS.escape ? CSS.escape(id) : id) + '"]');
      if (!card) return;
      card.classList.remove('just-seen');
      void card.offsetWidth;
      card.classList.add('just-seen');
      setTimeout(function () { card.classList.remove('just-seen'); }, 1400);
    }
  }

  /* ── ② 모바일 좌측 가장자리 스와이프 → 뒤로가기 ──── */
  var detail = document.getElementById('screen-detail');
  if (detail && 'ontouchstart' in window) {
    var sx = 0, sy = 0, track = false;
    detail.addEventListener('touchstart', function (e) {
      var t = e.touches[0];
      if (t.clientX <= 26) { track = true; sx = t.clientX; sy = t.clientY; }
      else track = false;
    }, { passive: true });
    detail.addEventListener('touchmove', function (e) {
      if (!track) return;
      var t = e.touches[0], dx = t.clientX - sx, dy = t.clientY - sy;
      if (dx > 64 && Math.abs(dy) < 44) {
        track = false;
        var back = detail.querySelector('[data-back]');
        if (back) back.click();
      }
    }, { passive: true });
    detail.addEventListener('touchend', function () { track = false; }, { passive: true });
  }

  /* ── ③ 댓글 입력: 자동 높이 + 글자수 안내 ─────────── */
  var ta = document.getElementById('commentInput');
  if (ta && ta.tagName === 'TEXTAREA') {
    var MAXLEN = 1000;
    var counter = null;
    function grow() {
      ta.style.height = 'auto';
      ta.style.height = Math.min(ta.scrollHeight, 132) + 'px';
    }
    function updateCounter() {
      var n = ta.value.length;
      if (n < 850) { if (counter) counter.style.display = 'none'; return; }
      if (!counter) {
        counter = document.createElement('span');
        counter.className = 'cmt-counter';
        var wrap = ta.closest('.input-wrap');
        if (wrap) wrap.appendChild(counter); else return;
      }
      counter.style.display = 'block';
      counter.textContent = n + ' / ' + MAXLEN;
      counter.classList.toggle('over', n > MAXLEN);
    }
    ta.addEventListener('input', function () { grow(); updateCounter(); });
    // 전송(클릭/Enter) 후 값이 비워지면 높이·카운터 리셋
    var resetSoon = function () { requestAnimationFrame(function () { grow(); updateCounter(); }); };
    var sendBtn = document.getElementById('sendBtn');
    if (sendBtn) sendBtn.addEventListener('click', resetSoon);
    ta.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) resetSoon();
    });
    grow();
  }
})();
