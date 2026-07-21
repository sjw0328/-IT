/* ═══════════════════════════════════════════════
   toronhaja — edition-fx.js
   에디션별 고유 기능
   ① 유튜버 목소리 효과음 (Web Audio 합성, 실음원 교체 가능)
   ② 에디션 전용 팬 배지 설정 (app.js·supabase.js 공유)
   ═══════════════════════════════════════════════ */
(function () {
  'use strict';

  /* ── 에디션 전용 배지 정의 (댓글 닉네임 옆에 노출) ── */
  window.EDITION_BADGE = {
    wallsu:   { label: '월수단',       emoji: '🥊', cls: 'wallsu' },
    seshinsa: { label: '세신사 부대원', emoji: '🪖', cls: 'seshinsa' },
  };

  /* ── 효과음 ON/OFF (기본 OFF) ───────────────── */
  var FX_KEY = 'thj_fx_on';
  var enabled = localStorage.getItem(FX_KEY) !== '0';   // 기본 ON (명시적으로 끔 때만 OFF)
  var currentEdition = window.THJ_EDITION || '';   // 인라인 에디션 스크립트가 먼저 설정해둔 값 이어받기

  /* ── 실음원 설정 ─────────────────────────────
     에디션을 선택해 들어가면 해당 음원이 딜 "1회" 재생되고 끝난다.
     (루프 X, 투표·댓글 효과음 X)                              */
  var MEDIA = {
    wallsu:   { src: 'wallsu-voice.mp3', vol: 0.95 },
    seshinsa: { src: 'seshinsa-bgm.mp3', vol: 0.55 },
  };
  var audioEl = null;   // 재생용 (재사용 — 한 번에 하나만)
  function getAudio() {
    if (!audioEl) { audioEl = new Audio(); audioEl.preload = 'auto'; audioEl.loop = false; }
    return audioEl;
  }
  function stopAudio() {
    if (audioEl) { try { audioEl.pause(); audioEl.currentTime = 0; } catch (e) {} }
  }
  /* 자동재생 차단 대비 — 차단되면 다음 사용자 동작(탭·클릭·키) 때 1회 재생 */
  var pendingEd = null;
  var gestureArmed = false;
  function armGestureRetry() {
    if (gestureArmed) return;
    gestureArmed = true;
    function retry() {
      document.removeEventListener('pointerdown', retry, true);
      document.removeEventListener('touchstart', retry, true);
      document.removeEventListener('keydown', retry, true);
      gestureArmed = false;
      var ed = pendingEd; pendingEd = null;
      if (ed && enabled && currentEdition === ed) playOnce(ed);
    }
    document.addEventListener('pointerdown', retry, true);
    document.addEventListener('touchstart', retry, true);
    document.addEventListener('keydown', retry, true);
  }
  function playOnce(ed) {
    var m = MEDIA[ed]; if (!m) return;
    var a = getAudio();
    if (a.src.indexOf(m.src) === -1) a.src = m.src;
    a.loop = false;
    a.volume = m.vol == null ? 0.8 : m.vol;
    try { a.currentTime = 0; } catch (e) {}
    var p = a.play();
    if (p && p.catch) p.catch(function () {
      // 브라우저 자동재생 정책에 막힘 → 다음 사용자 동작 때 한 번 더 시도
      pendingEd = ed;
      armGestureRetry();
    });
  }

  /* ── Web Audio 엔진 ─────────────────────────── */
  var AC = null;
  function ctx() {
    if (!AC) {
      var C = window.AudioContext || window.webkitAudioContext;
      if (!C) return null;
      AC = new C();
    }
    if (AC.state === 'suspended') { try { AC.resume(); } catch (e) {} }
    return AC;
  }

  // 단일 톤 (오실레이터 + ADSR 게인)
  function tone(ac, t0, opt) {
    var osc = ac.createOscillator();
    var g = ac.createGain();
    osc.type = opt.type || 'sine';
    osc.frequency.setValueAtTime(opt.f0, t0);
    if (opt.f1) osc.frequency.exponentialRampToValueAtTime(opt.f1, t0 + opt.dur);
    var peak = opt.gain == null ? 0.18 : opt.gain;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + (opt.atk || 0.006));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + opt.dur);
    osc.connect(g); g.connect(opt.dest || ac.destination);
    osc.start(t0); osc.stop(t0 + opt.dur + 0.02);
  }

  // 노이즈 버스트 (펀치 thud / 무전 squelch 용)
  function noise(ac, t0, opt) {
    var len = Math.floor(ac.sampleRate * opt.dur);
    var buf = ac.createBuffer(1, len, ac.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    var src = ac.createBufferSource(); src.buffer = buf;
    var bp = ac.createBiquadFilter();
    bp.type = opt.filter || 'bandpass';
    bp.frequency.value = opt.freq || 1200;
    bp.Q.value = opt.q || 0.8;
    var g = ac.createGain();
    g.gain.setValueAtTime(opt.gain == null ? 0.16 : opt.gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + opt.dur);
    src.connect(bp); bp.connect(g); g.connect(ac.destination);
    src.start(t0); src.stop(t0 + opt.dur + 0.02);
  }

  /* ── 에디션별 사운드 디자인 ──────────────────── */
  var SYNTH = {
    // 월수 — 복싱 벨 / 펀치 (근육·합성물 무드)
    wallsu: {
      vote: function (ac, t) {         // 복싱 벨 "딩-딩"
        tone(ac, t,        { type: 'sine', f0: 880,  dur: 0.5, gain: 0.16 });
        tone(ac, t,        { type: 'sine', f0: 1320, dur: 0.5, gain: 0.08 });
        tone(ac, t + 0.16, { type: 'sine', f0: 880,  dur: 0.5, gain: 0.14 });
        tone(ac, t + 0.16, { type: 'sine', f0: 1320, dur: 0.5, gain: 0.07 });
      },
      comment: function (ac, t) {      // 펀치 thud + 상승 블립 ("가즈아" 느낌)
        noise(ac, t, { dur: 0.12, filter: 'lowpass', freq: 220, q: 1, gain: 0.22 });
        tone(ac, t,        { type: 'sine',     f0: 120, dur: 0.12, gain: 0.22 });
        tone(ac, t + 0.05, { type: 'sawtooth', f0: 300, f1: 760, dur: 0.16, gain: 0.10 });
      },
      open: function (ac, t) {         // 에디션 켜질 때 임팩트
        tone(ac, t,        { type: 'sine', f0: 660,  dur: 0.4, gain: 0.14 });
        tone(ac, t + 0.1,  { type: 'sine', f0: 990,  dur: 0.45, gain: 0.12 });
        noise(ac, t, { dur: 0.2, filter: 'lowpass', freq: 180, q: 1, gain: 0.12 });
      },
    },
    // 세신사 — 무전/모스 (안보·군사 무드)
    seshinsa: {
      vote: function (ac, t) {         // 무전 2톤 비프
        tone(ac, t,        { type: 'square', f0: 660, dur: 0.12, gain: 0.10 });
        tone(ac, t + 0.13, { type: 'square', f0: 990, dur: 0.14, gain: 0.10 });
      },
      comment: function (ac, t) {      // 워키토키 스퀠치 + 확인음
        noise(ac, t, { dur: 0.09, filter: 'bandpass', freq: 1800, q: 0.6, gain: 0.14 });
        tone(ac, t + 0.06, { type: 'square', f0: 1245, dur: 0.1, gain: 0.09 });
        tone(ac, t + 0.16, { type: 'square', f0: 1245, dur: 0.1, gain: 0.09 });
      },
      open: function (ac, t) {         // 통신 개통음 (상승 스윕)
        tone(ac, t, { type: 'square', f0: 440, f1: 1320, dur: 0.35, gain: 0.10 });
        tone(ac, t + 0.18, { type: 'square', f0: 880, dur: 0.16, gain: 0.08 });
      },
    },
  };

  /* ── 공개 API ──────────────────────────────────
     투표·댓글 액션은 소리 없음. 에디션 선택 시에만 1회 재생. */
  function play() { /* no-op: 액션 효과음 제거됨 */ }

  function setEnabled(on) {
    enabled = !!on;
    localStorage.setItem(FX_KEY, enabled ? '1' : '0');
    syncToggle();
    if (enabled && currentEdition) playOnce(currentEdition);   // 켜는 즉시 1회 들려주기
    else stopAudio();
  }

  function onEditionChange(ed) {
    var prev = currentEdition;
    currentEdition = ed || '';
    stopAudio();                          // 이전 재생 중단 (중복 방지)
    renderToggle();
    if (currentEdition && enabled && prev !== currentEdition) {
      playOnce(currentEdition);            // 선택해 들어가면 1회 재생
    }
  }

  window.THJ_FX = {
    play: play,
    setEnabled: setEnabled,
    isEnabled: function () { return enabled; },
    onEditionChange: onEditionChange,
    registerSample: function (ed, action, url) { if (MEDIA[ed]) MEDIA[ed].src = url; },
  };

  /* ── 효과음 토글 UI (에디션 피커 안에 주입) ───── */
  var toggleEl = null;
  function renderToggle() {
    var picker = document.getElementById('editionPicker');
    if (!picker) return;
    if (!toggleEl) {
      toggleEl = document.createElement('div');
      toggleEl.className = 'ep-fx-row';
      toggleEl.innerHTML =
        '<div class="ep-fx-label"><span class="ep-fx-ic">🔊</span>' +
        '<div><div class="ep-fx-t">에디션 사운드</div>' +
        '<div class="ep-fx-d">입장할 때 1회 재생</div></div></div>' +
        '<button class="ep-fx-switch" id="epFxSwitch" role="switch" aria-label="효과음"><span class="ep-fx-knob"></span></button>';
      picker.appendChild(toggleEl);
      toggleEl.querySelector('#epFxSwitch').addEventListener('click', function () {
        setEnabled(!enabled);
      });
    }
    // 에디션이 켜져 있을 때만 의미 있으므로 항상 표시하되 비활성 에디션이면 안내
    toggleEl.style.display = 'flex';
    syncToggle();
  }
  function syncToggle() {
    if (!toggleEl) return;
    var sw = toggleEl.querySelector('#epFxSwitch');
    if (sw) {
      sw.classList.toggle('on', enabled);
      sw.setAttribute('aria-checked', enabled ? 'true' : 'false');
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    currentEdition = window.THJ_EDITION || currentEdition;
    renderToggle();
  });
})();
