/* ═══════════════════════════════════════════════
   toronhaja — share.js
   공유 + 딥링크.  ── 외부 SDK 0개 ──
   · 모바일: OS 기본 공유 시트(navigator.share) → 카카오톡·인스타·메시지 등
     설치된 앱이 그대로 뜸 (별도 카카오 SDK 불필요)
   · 데스크톱: 링크 복사 + 트위터(X) 웹 인텐트 (브라우저 새창, API 호출 아님)
   · 링크 형식: …/index.html#d/<토론id>  → 열면 해당 토론 상세로 바로 진입
   ═══════════════════════════════════════════════ */

'use strict';

function thjLinkFor(id) {
  return location.origin + location.pathname + '#d/' + id;
}

function thjShareText(topic) {
  const a = (typeof DB !== 'undefined') ? DB.ratio(topic) : 50;
  return `[토론하자] ${topic.title}\n지금 찬성 ${a}% · 반대 ${100 - a}% — 당신의 입장은?`;
}

/* 공유 진입점 — 가능하면 OS 공유 시트, 아니면 자체 시트 */
async function thjShare(topic) {
  if (!topic) return;
  const url = thjLinkFor(topic.id);
  const text = thjShareText(topic);
  if (navigator.share) {
    try { await navigator.share({ title: '토론하자', text, url }); return; }
    catch (e) { if (e && e.name === 'AbortError') return; /* 그 외엔 시트로 폴백 */ }
  }
  thjShareSheet(topic, url, text);
}

async function thjCopyLink(url) {
  try {
    if (navigator.clipboard) await navigator.clipboard.writeText(url);
    else {
      const ta = document.createElement('textarea');
      ta.value = url; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
    }
    thjToast('링크를 복사했어요', 'success', 'link');
  } catch (e) { thjToast('복사 실패 — 직접 선택해 복사하세요', 'error'); }
}

/* 데스크톱용 자체 공유 시트 */
let _shareEl = null;
function thjCloseShareSheet() { if (_shareEl) { _shareEl.remove(); _shareEl = null; document.removeEventListener('keydown', _shareEsc); } }
function _shareEsc(e) { if (e.key === 'Escape') thjCloseShareSheet(); }

function thjShareSheet(topic, url, text) {
  thjCloseShareSheet();
  const a = DB.ratio(topic), b = 100 - a;
  const tw = 'https://twitter.com/intent/tweet?text=' + encodeURIComponent(text) + '&url=' + encodeURIComponent(url);
  const ov = document.createElement('div');
  ov.className = 'share-overlay';
  ov.innerHTML = `
    <div class="share-sheet" role="dialog" aria-label="공유하기">
      <button class="share-x" aria-label="닫기">${icon('x', 18)}</button>
      <div class="share-head">${icon('share', 18)}<span>이 토론 공유하기</span></div>
      <div class="share-card">
        <div class="share-mini-bar"><span style="width:${a}%"></span></div>
        <div class="share-mini-title"></div>
        <div class="share-mini-meta">찬성 ${a}% · 반대 ${b}%</div>
      </div>
      <div class="share-link"><span class="share-link-url"></span><button class="share-copy">${icon('copy', 15)}복사</button></div>
      <div class="share-apps">
        <a class="share-app tw" href="${tw}" target="_blank" rel="noopener">X(트위터)</a>
        <button class="share-app native">${icon('arrow-lr', 15)}다른 앱으로</button>
      </div>
      <p class="share-tip">모바일에서는 [다른 앱으로]를 누르면 <b>카카오톡</b>·메시지 등으로 바로 보낼 수 있어요.</p>
    </div>`;
  document.body.appendChild(ov);
  ov.querySelector('.share-mini-title').textContent = topic.title;
  ov.querySelector('.share-link-url').textContent = url;
  _shareEl = ov;
  void ov.offsetWidth;
  ov.classList.add('show');

  ov.addEventListener('click', (e) => {
    if (e.target === ov || e.target.closest('.share-x')) return thjCloseShareSheet();
    if (e.target.closest('.share-copy')) return thjCopyLink(url);
    if (e.target.closest('.share-app.native')) {
      if (navigator.share) navigator.share({ title: '토론하자', text, url }).catch(() => {});
      else thjCopyLink(url);
    }
  });
  document.addEventListener('keydown', _shareEsc);
}

window.thjShare = thjShare;
window.thjLinkFor = thjLinkFor;
window.thjCopyLink = thjCopyLink;
