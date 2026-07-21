/* ═══════════════════════════════════════════════════════════
   토론하자 — flip-notify.js
   "역전 알림" — 내가 투표한 토론의 판세가 뒤집힌 순간을 잡아
   알림 벨에 띄운다. 사람은 끝난 일은 떠나도, 결과가 안 난 판은
   못 떠난다 → 복귀 트리거.

   ── 서버 저장 0바이트 ──
   · 누가 어디 걸었는지 = thj_voted (이미 있음)
   · 투표 당시 비율      = thj_vote_at (이미 있음, me.js 가 기록)
   · 현재 비율           = DB.ratio(topic) (집계 컬럼, 추가 전송 없음)
   알림은 전부 localStorage 에만 쌓이고, 새 테이블/행은 만들지 않는다.

   판정: 투표 당시 "내 편이 앞섰나"(baseline) vs 지금 "내 편이 앞서나".
   · 앞섰다 → 밀렸다  = 역전당함  (down · 불안 트리거)
   · 밀렸다 → 앞섰다  = 재역전     (up   · 굳히기 트리거)
   crossing 마다 1번만 발화(baseline 갱신으로 dedupe). 마감/소멸 토론은 정리.

   로드 순서: me.js 다음, notify.js 앞 (둘 다 호출 시점에 참조하므로 유연).
   의존: supabase.js(DB) · icons.js(relTime/thjToast 선택)
   ═══════════════════════════════════════════════════════════ */
'use strict';
(function () {
  if (!window.DB) return;

  var NOTIF_KEY = 'thj_flip_notifs';   // [{id,kind:'flip',dir,title,body,debateId,created_at,read}]
  var TRACK_KEY = 'thj_flip_track';    // {debateId: lastKnownMyWinning(bool)}  ← baseline/dedupe
  var MAX = 40;                        // 보관 상한
  var MAX_AGE = 7 * 86400000;          // 7일 지난 알림은 정리

  function lsGet(k, d) { try { var v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function votes() { return window.THJ_VOTED || lsGet('thj_voted', {}); }
  function voteAt() { return lsGet('thj_vote_at', {}); }

  function isClosedT(t) { if (!t) return false; if (t.status === 'closed') return true; return !!(t.ends_at && new Date(t.ends_at).getTime() <= Date.now()); }

  function emit() { try { document.dispatchEvent(new CustomEvent('thj-flips')); } catch (e) {} }

  /* ── 공개 API (notify.js 가 소비) ─────────────────── */
  var FLIPS = {
    list: function () {
      var arr = lsGet(NOTIF_KEY, []);
      // 최신순
      return arr.slice().sort(function (a, b) { return new Date(b.created_at) - new Date(a.created_at); });
    },
    unread: function () {
      return lsGet(NOTIF_KEY, []).reduce(function (n, x) { return n + (x.read ? 0 : 1); }, 0);
    },
    markAllRead: function () {
      var arr = lsGet(NOTIF_KEY, []); var changed = false;
      arr.forEach(function (x) { if (!x.read) { x.read = true; changed = true; } });
      if (changed) { lsSet(NOTIF_KEY, arr); emit(); }
    },
    scan: scan,
  };
  window.THJ_FLIPS = FLIPS;

  /* ── 스캔: 역전/재역전 감지 → 알림 적립 ─────────────── */
  var scanning = false;
  async function scan() {
    if (scanning) return; scanning = true;
    try {
      var v = votes(), ids = Object.keys(v);
      if (!ids.length) { scanning = false; return; }

      var topics;
      try { topics = await DB.topics(); } catch (e) { scanning = false; return; }
      if (!topics || !topics.length) { scanning = false; return; }
      var by = {}; topics.forEach(function (t) { by[t.id] = t; });

      var track = lsGet(TRACK_KEY, {});
      var notifs = lsGet(NOTIF_KEY, []);
      var at = voteAt();
      var fresh = [];           // 이번 스캔에서 새로 발생한 알림(토스트/데스크탑용)
      var liveIds = {};

      ids.forEach(function (id) {
        var t = by[id]; if (!t) return;
        liveIds[id] = 1;
        if (isClosedT(t)) return;                 // 마감 토론은 역전 추적 대상 아님(결과는 투표함에서)
        if (DB.voters(t) < 2) return;             // 표가 거의 없으면 의미 없음

        var nowA = DB.ratio(t);
        var my = v[id];
        var myShareNow = (my === 'a') ? nowA : (100 - nowA);
        var myWinningNow = myShareNow > 50;

        // baseline: 이전에 추적한 상태가 있으면 그것, 없으면 "투표 당시 내 편이 앞섰나"
        var base;
        if (Object.prototype.hasOwnProperty.call(track, id)) {
          base = !!track[id];
        } else {
          var atA = at[id];
          if (atA == null) { track[id] = myWinningNow; return; }   // 옛 투표(당시 비율 없음) → 조용히 시드
          var myShareAt = (my === 'a') ? atA : (100 - atA);
          base = myShareAt > 50;
          // 시드인데 이미 상태가 다르면(자리 비운 사이 뒤집힘) 아래에서 바로 발화시킨다.
        }

        if (base === myWinningNow) { track[id] = myWinningNow; return; }  // 변화 없음

        // ── crossing 발생 ──
        var dir = myWinningNow ? 'up' : 'down';
        // 같은 토론·같은 방향의 안 읽은 알림이 이미 있으면 중복 적립 안 함
        var dup = notifs.some(function (n) { return n.debateId === id && n.dir === dir && !n.read; });
        if (!dup) {
          var notif = makeNotif(t, my, dir, nowA);
          notifs.push(notif);
          fresh.push(notif);
        }
        track[id] = myWinningNow;   // baseline 갱신 → 되돌아오기 전엔 재발화 안 함
      });

      // 정리: 사라진/오래된 토론 추적·알림 제거, 상한 적용
      Object.keys(track).forEach(function (id) { if (!liveIds[id] && !by[id]) delete track[id]; });
      var now = Date.now();
      notifs = notifs.filter(function (n) {
        if (now - new Date(n.created_at).getTime() > MAX_AGE) return false;
        var t = by[n.debateId];
        if (!t) return false;                  // 삭제된 토론 → 알림도 정리
        if (isClosedT(t)) return false;        // 마감되면 역전 알림은 의미 소멸(결과는 투표함)
        return true;
      });
      notifs.sort(function (a, b) { return new Date(b.created_at) - new Date(a.created_at); });
      if (notifs.length > MAX) notifs = notifs.slice(0, MAX);

      lsSet(TRACK_KEY, track);
      lsSet(NOTIF_KEY, notifs);

      if (fresh.length) {
        emit();
        surface(fresh);
      }
    } catch (e) { /* 스캔 실패는 무해 */ }
    scanning = false;
  }

  /* ── 알림 객체 생성 (앱 톤: 펀치 있는 반말) ── */
  function makeNotif(t, my, dir, nowA) {
    var nowMine = (my === 'a') ? nowA : (100 - nowA);
    var sideWord = (my === 'a') ? '찬성' : '반대';
    var title, body;
    if (dir === 'down') {
      title = '내 편이 역전당했다';
      body = '「' + t.title + '」 — 앞서다 ' + sideWord + ' ' + nowMine + '%로 밀렸다. 가서 한 마디 보태.';
    } else {
      title = '내 편이 재역전!';
      body = '「' + t.title + '」 — 밀리다 ' + sideWord + ' ' + nowMine + '%로 다시 앞섰다. 굳히러 와.';
    }
    return {
      id: 'flip_' + t.id + '_' + dir + '_' + Date.now(),
      kind: 'flip', dir: dir,
      ic: dir === 'down' ? 'arrow-dn' : 'arrow-up',
      cls: dir === 'down' ? 'flipdn' : 'flipup',
      title: title, body: body,
      debateId: t.id,
      created_at: new Date().toISOString(),
      read: false,
    };
  }

  /* ── 새 역전을 즉시 체감시키기 (스캔당 1건만) ── */
  function surface(fresh) {
    // 가장 긴급한 것(역전당함 우선) 1건만 노출 — 나머지는 배지로
    var pick = fresh.filter(function (n) { return n.dir === 'down'; })[0] || fresh[0];
    if (!pick) return;
    if ('Notification' in window && Notification.permission === 'granted' && document.hidden) {
      try { new Notification('토론하자', { body: pick.title, icon: 'favicon-180.png', tag: pick.id }); } catch (e) {}
    } else if (!document.hidden && typeof thjToast === 'function') {
      thjToast(pick.title + ' · 벨 확인', pick.dir === 'down' ? 'warn' : 'success', pick.ic);
    }
  }

  /* ── 구동: 초기 + 주기 + 투표 직후 + 탭 복귀 ── */
  function start() {
    scan();
    setInterval(function () { if (!document.hidden) scan(); }, 60000);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) scan(); });
    // 투표하면 me.js 가 onThjVote 를 부른다 → 체이닝해서 baseline 시드/갱신
    var prev = window.onThjVote;
    window.onThjVote = function () {
      if (typeof prev === 'function') { try { prev.apply(this, arguments); } catch (e) {} }
      setTimeout(scan, 50);
    };
  }
  if (document.readyState !== 'loading') start();
  else document.addEventListener('DOMContentLoaded', start);
})();
