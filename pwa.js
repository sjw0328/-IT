/* ═══════════════════════════════════════════════
   toronhaja — pwa.js
   ❶ 단 한 파일로 PWA 완성: 이 파일이 "서비스워커"이자 "설치 배너"다.
      · 페이지에서 <script src="pwa.js"> 로 불리면  → 자기 자신을 SW 로 등록 + 설치 배너 표시
      · 브라우저가 SW 로 불러오면(window 없음)      → 오프라인 캐시 + fetch 핸들러 동작
   ❷ 모바일 크롬 등에서 "토론하자 앱을 설치하시겠습니까?" 안내 카드가 하단에 뜬다.
      iOS 사파리는 설치 이벤트가 없어 '홈 화면에 추가' 방법을 대신 안내한다.
   ── 사용법: index.html(또는 다른 페이지) </body> 직전에 아래 한 줄만 추가 ──
      <script src="pwa.js"></script>
   ═══════════════════════════════════════════════ */

'use strict';

/* ════════════════════════════════════════════════
   [A] 서비스워커 컨텍스트 (window 가 없음)
   설치 가능(installable) 조건인 'fetch 핸들러'를 제공하고,
   동일 출처 정적 파일만 캐시해 오프라인에서도 앱이 열리게 한다.
   ※ Supabase 등 외부(API) 요청은 절대 가로채지 않는다.
   ════════════════════════════════════════════════ */
if (typeof window === 'undefined') {
  const CACHE = 'thj-shell-v1';
  const SHELL = [
    'index.html', 'create.html', 'style.css',
    'app.js', 'supabase.js', 'icons.js', 'share.js', 'onboard.js',
    'favicon-32.png', 'favicon-180.png', 'favicon-512.png', 'site.webmanifest',
  ];

  self.addEventListener('install', (e) => {
    self.skipWaiting();
    e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL).catch(() => {})));
  });

  self.addEventListener('activate', (e) => {
    e.waitUntil((async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
      await self.clients.claim();
    })());
  });

  self.addEventListener('fetch', (e) => {
    const req = e.request;
    if (req.method !== 'GET') return;                       // 쓰기 요청은 통과
    const url = new URL(req.url);
    if (url.origin !== self.location.origin) return;        // 외부(API·폰트·CDN)는 그대로
    // 네트워크 우선 → 실패 시 캐시 (정적 파일만 대상)
    e.respondWith((async () => {
      try {
        const net = await fetch(req);
        if (net && net.ok) { const c = await caches.open(CACHE); c.put(req, net.clone()); }
        return net;
      } catch (err) {
        const cached = await caches.match(req);
        return cached || caches.match('index.html');
      }
    })());
  });

/* ════════════════════════════════════════════════
   [B] 페이지 컨텍스트 — SW 등록 + 설치 배너 UI
   ════════════════════════════════════════════════ */
} else {
  /* ── 1) 이 파일 자신을 서비스워커로 등록 ── */
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('pwa.js')
        .catch(err => console.warn('[toronhaja] SW 등록 실패:', err && err.message));
    });
  }

  const DISMISS_KEY = 'thj_pwa_dismiss';
  const COOLDOWN = 7 * 86400000;   // 닫으면 7일간 다시 안 띄움
  const standalone = () =>
    matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const recentlyDismissed = () => (Date.now() - (+localStorage.getItem(DISMISS_KEY) || 0)) < COOLDOWN;
  const isMobile = () =>
    matchMedia('(max-width: 860px)').matches || matchMedia('(pointer: coarse)').matches;

  let deferred = null;

  /* ── 2) 배너 스타일 (1회 주입, 다크 테마 매칭) ── */
  function injectStyle() {
    if (document.getElementById('thjPwaStyle')) return;
    const s = document.createElement('style');
    s.id = 'thjPwaStyle';
    s.textContent = `
      .thj-pwa{position:fixed;left:12px;right:12px;bottom:12px;z-index:9999;
        display:flex;align-items:center;gap:12px;max-width:460px;margin:0 auto;
        padding:12px 14px;padding-bottom:calc(12px + env(safe-area-inset-bottom));
        border-radius:16px;background:#1C232D;border:1px solid rgba(255,255,255,.11);
        box-shadow:0 14px 44px rgba(0,0,0,.55);
        font-family:'Pretendard',system-ui,-apple-system,sans-serif;
        transform:translateY(150%);opacity:0;
        transition:transform .34s cubic-bezier(.2,.85,.25,1),opacity .34s;}
      .thj-pwa.show{transform:none;opacity:1;}
      .thj-pwa-ic{width:46px;height:46px;border-radius:12px;flex:0 0 auto;
        border:1px solid rgba(255,255,255,.10);}
      .thj-pwa-tx{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px;}
      .thj-pwa-tx b{color:#F4F6FA;font-size:14.5px;font-weight:800;letter-spacing:-.2px;}
      .thj-pwa-tx span{color:#9AA4B2;font-size:12px;line-height:1.4;}
      .thj-pwa-go{flex:0 0 auto;height:38px;padding:0 18px;border:none;cursor:pointer;white-space:nowrap;
        border-radius:999px;background:#4D82F3;color:#fff;font-weight:800;font-size:13.5px;
        transition:transform .12s ease,background .15s ease;}
      .thj-pwa-go:active{transform:scale(.95);background:#3F71DD;}
      .thj-pwa-x{flex:0 0 auto;width:30px;height:30px;border-radius:50%;border:none;cursor:pointer;
        background:#252E3A;color:#9AA4B2;font-size:13px;line-height:1;}
      .thj-pwa-x:active{background:#2E3845;}`;
    document.head.appendChild(s);
  }

  /* ── 3) 배너 표시 ── */
  function showBanner(ios) {
    if (standalone() || recentlyDismissed() || !isMobile()) return;
    if (document.getElementById('thjPwa')) return;
    injectStyle();
    const el = document.createElement('div');
    el.id = 'thjPwa';
    el.className = 'thj-pwa';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', '토론하자 앱 설치');
    el.innerHTML =
      `<img class="thj-pwa-ic" src="favicon-180.png" alt="토론하자" />` +
      `<div class="thj-pwa-tx"><b>토론하자 앱 설치</b><span>` +
      (ios
        ? '공유 <span style="font-weight:700">⎙</span> → ‘홈 화면에 추가’ 를 누르면 앱처럼 쓸 수 있어요'
        : '홈 화면에 추가하고 앱처럼 빠르게 즐겨보세요') +
      `</span></div>` +
      (ios ? '' : `<button class="thj-pwa-go" data-go type="button">설치</button>`) +
      `<button class="thj-pwa-x" data-x type="button" aria-label="닫기">✕</button>`;
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    el.querySelector('[data-x]').addEventListener('click', dismiss);
    const go = el.querySelector('[data-go]');
    if (go) go.addEventListener('click', install);
  }

  function hide() {
    const el = document.getElementById('thjPwa');
    if (el) { el.classList.remove('show'); setTimeout(() => el.remove(), 280); }
  }
  function dismiss() { localStorage.setItem(DISMISS_KEY, String(Date.now())); hide(); }

  async function install() {
    if (!deferred) { dismiss(); return; }
    deferred.prompt();
    let outcome = 'dismissed';
    try { ({ outcome } = await deferred.userChoice); } catch (e) {}
    deferred = null;
    if (outcome === 'accepted') hide(); else dismiss();
  }

  /* ── 4) 안드로이드 크롬 등: 네이티브 설치 이벤트 ── */
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();          // 브라우저 기본 미니바 막고 우리 배너로 대체
    deferred = e;
    showBanner(false);
  });
  window.addEventListener('appinstalled', () => {
    deferred = null; hide();
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
  });

  /* ── 5) iOS 사파리 폴백 (beforeinstallprompt 미지원) ── */
  function maybeIOSHint() {
    const ua = navigator.userAgent;
    const isIOS = /iphone|ipad|ipod/i.test(ua) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);   // iPadOS
    const isSafari = /safari/i.test(ua) && !/crios|fxios|edgios|android|chrome/i.test(ua);
    if (isIOS && isSafari) setTimeout(() => showBanner(true), 1600);
  }
  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', maybeIOSHint);
  else maybeIOSHint();

  /* (선택) 버튼 등에서 직접 호출하고 싶을 때 */
  window.thjInstallPrompt = () => (deferred ? install() : showBanner(false));
}
