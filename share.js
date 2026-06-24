/* ═══════════════════════════════════════════════
   toronhaja — share.js
   공유 + 딥링크 + 공유 카드 이미지(OG 1200×630) 생성.  ── 외부 SDK 0개 ──
   · 모바일: OS 기본 공유 시트(navigator.share). 이미지 파일 공유 지원 시 카드 PNG 동봉.
   · 데스크톱: 자체 시트 — 카드 미리보기 + 이미지 저장 + 링크 복사 + X(트위터)
   · 링크 형식: …/index.html#d/<토론id>
   ═══════════════════════════════════════════════ */

'use strict';

function thjLinkFor(id) {
  return location.origin + location.pathname + '#d/' + id;
}

function thjShareText(topic, mySide) {
  const a = (typeof DB !== 'undefined') ? DB.ratio(topic) : 50;
  if (mySide) {
    const myPct = mySide === 'a' ? a : 100 - a;
    const sideLabel = mySide === 'a' ? '찬성' : '반대';
    const v = myPct < 50 ? '소수' : (myPct > 50 ? '다수' : '반반');
    return `[토론하자] ${topic.title}\n나는 ${sideLabel}(${myPct}%), ${v} 쪽. 넌?`;
  }
  return `[토론하자] ${topic.title}\n지금 찬성 ${a}% · 반대 ${100 - a}%. 넌 어느 편?`;
}

/* ── 공유 카드 이미지 (Canvas → PNG Blob) ────────────────
   앱과 동일한 색·폰트로 토론 제목 + 찬/반 비율 바를 그린다. */
const _CARD = {
  bg1: '#12161D', bg2: '#0A0C10',
  text: '#F4F6FA', sub: '#9AA4B2', muted: '#626C7A',
  a: '#4D82F3', aBright: '#7AA5FF', b: '#ED5470', bBright: '#F8859A',
  cat: { 정치: '#A99BF5', 축구: '#3FD6A0', 연예: '#F58BBE', 게임: '#45D2E0', 사회: '#F2C45C', 경제: '#36CFC0' },
};

let _cardFontsReady = null;
function _ensureCardFonts() {
  if (_cardFontsReady) return _cardFontsReady;
  _cardFontsReady = (async () => {
    if (!document.fonts || !document.fonts.load) return;
    try {
      await Promise.all([
        document.fonts.load('800 56px Pretendard'),
        document.fonts.load('700 62px Pretendard'),
        document.fonts.load('500 26px Pretendard'),
        document.fonts.load('400 48px "Black Han Sans"'),
      ]);
      await document.fonts.ready;
    } catch (_) {}
  })();
  return _cardFontsReady;
}

/* 캔버스 줄바꿈 — 공백 우선, 안 되면 글자 단위(한글 대응). 최대 maxLines, 넘치면 … */
function _wrapLines(ctx, text, maxWidth, maxLines) {
  const words = String(text || '').split(/(\s+)/);   // 공백 보존
  const lines = [];
  let line = '';
  const push = () => { if (line) lines.push(line); line = ''; };
  for (const w of words) {
    let test = line + w;
    if (ctx.measureText(test).width <= maxWidth) { line = test; continue; }
    // 단어 하나가 너무 길면 글자 단위로 쪼갬
    if (!line && ctx.measureText(w).width > maxWidth) {
      for (const ch of w) {
        if (ctx.measureText(line + ch).width > maxWidth) { push(); }
        line += ch;
      }
    } else { push(); line = w.replace(/^\s+/, ''); }
    if (lines.length >= maxLines) break;
  }
  push();
  let out = lines.slice(0, maxLines);
  if (lines.length > maxLines || (out.length === maxLines && line)) {
    let last = out[maxLines - 1] || '';
    while (last && ctx.measureText(last + '…').width > maxWidth) last = last.slice(0, -1);
    out[maxLines - 1] = last + '…';
  }
  return out;
}

async function thjMakeShareCard(topic, mySide) {
  await _ensureCardFonts();
  const W = 1200, H = 630, P = 76;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  const a = DB.ratio(topic), b = 100 - a;
  const catColor = _CARD.cat[topic.category] || _CARD.sub;

  // 배경
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, _CARD.bg1); g.addColorStop(1, _CARD.bg2);
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  // 미세 상단 악센트 라인
  const gl = ctx.createLinearGradient(0, 0, W, 0);
  gl.addColorStop(0, _CARD.a); gl.addColorStop(1, _CARD.b);
  ctx.fillStyle = gl; ctx.fillRect(0, 0, W, 6);
  // 테두리
  ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, W - 2, H - 2);

  // 로고 — "토론하자."
  ctx.textBaseline = 'alphabetic';
  ctx.font = '400 46px "Black Han Sans", Pretendard, sans-serif';
  let lx = P, ly = 104;
  const seg = [['토론', _CARD.text], ['하자', _CARD.a], ['.', _CARD.b]];
  for (const [s, col] of seg) { ctx.fillStyle = col; ctx.fillText(s, lx, ly); lx += ctx.measureText(s).width + 1; }

  // 카테고리 pill (우상단)
  ctx.font = '700 24px Pretendard, sans-serif';
  const catTxt = topic.category || '토론';
  const cw = ctx.measureText(catTxt).width, padX = 20, pillH = 44, pillW = cw + padX * 2;
  const px = W - P - pillW, py = 70;
  ctx.fillStyle = 'rgba(255,255,255,0.04)';
  ctx.beginPath(); ctx.roundRect(px, py, pillW, pillH, pillH / 2); ctx.fill();
  ctx.strokeStyle = catColor; ctx.globalAlpha = 0.5; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.roundRect(px, py, pillW, pillH, pillH / 2); ctx.stroke(); ctx.globalAlpha = 1;
  ctx.fillStyle = catColor; ctx.fillText(catTxt, px + padX, py + 30);

  // 제목 (최대 3줄)
  ctx.font = '700 62px Pretendard, sans-serif';
  ctx.fillStyle = _CARD.text;
  const lines = _wrapLines(ctx, topic.title, W - P * 2, 3);
  const lh = 78;
  let ty = 222 + (3 - lines.length) * 14;   // 짧으면 살짝 위로 가운데맞춤
  for (const ln of lines) { ctx.fillText(ln, P, ty); ty += lh; }

  // 비율 라벨 (내 선택 표시)
  const barY = 470, barH = 60, barW = W - P * 2;
  const aLab = mySide === 'a' ? '찬성 ✓' : '찬성';
  const bLab = mySide === 'b' ? '✓ 반대' : '반대';
  ctx.font = '500 26px Pretendard, sans-serif';
  ctx.fillStyle = mySide === 'a' ? _CARD.aBright : _CARD.sub; ctx.textAlign = 'left';
  ctx.fillText(aLab, P, barY - 20);
  const aLabW = ctx.measureText(aLab).width;
  ctx.fillStyle = mySide === 'b' ? _CARD.bBright : _CARD.sub; ctx.textAlign = 'right';
  ctx.fillText(bLab, W - P, barY - 20);
  const bLabW = ctx.measureText(bLab).width;
  ctx.font = '800 30px Pretendard, sans-serif';
  ctx.textAlign = 'left'; ctx.fillStyle = _CARD.aBright;
  ctx.fillText(a + '%', P + aLabW + 14, barY - 19);
  ctx.textAlign = 'right'; ctx.fillStyle = _CARD.bBright;
  ctx.fillText(b + '%', W - P - bLabW - 14, barY - 19);
  ctx.textAlign = 'left';

  // 비율 바
  const aw = Math.max(barH, Math.min(barW - barH, Math.round(barW * a / 100)));
  ctx.fillStyle = _CARD.b;
  ctx.beginPath(); ctx.roundRect(P, barY, barW, barH, barH / 2); ctx.fill();
  ctx.save();
  ctx.beginPath(); ctx.roundRect(P, barY, barW, barH, barH / 2); ctx.clip();
  ctx.fillStyle = _CARD.a; ctx.fillRect(P, barY, aw, barH);
  // 분할 노브
  ctx.fillStyle = '#0A0C10'; ctx.fillRect(P + aw - 3, barY, 6, barH);
  ctx.restore();

  // 푸터 — 내 선택이 있으면 개인 정체성 후크(소수/다수), 없으면 참여 안내
  const voters = (typeof DB.voters === 'function') ? DB.voters(topic) : 0;
  let vtxt;
  if (mySide) {
    const myPct = mySide === 'a' ? a : b;
    const sideLabel = mySide === 'a' ? '찬성' : '반대';
    const verdict = myPct < 50 ? '소수 의견' : (myPct > 50 ? '다수 의견' : '정확히 반반');
    vtxt = `나는 ${sideLabel} — ${verdict} ${myPct}%`;
    ctx.font = '800 28px Pretendard, sans-serif';
    ctx.fillStyle = mySide === 'a' ? _CARD.aBright : _CARD.bBright;
  } else {
    vtxt = voters > 0 ? `${voters.toLocaleString('en-US')}명 참여 · 넌 어느 편?` : '넌 어느 편?';
    ctx.font = '500 25px Pretendard, sans-serif';
    ctx.fillStyle = _CARD.sub;
  }
  ctx.textAlign = 'left';
  ctx.fillText(vtxt, P, 584);
  // 호스트는 왼쪽 텍스트와 겹치지 않을 때만 표시(긴 도메인 방어)
  const host = location.host || '';
  if (host) {
    const leftEnd = P + ctx.measureText(vtxt).width;
    const hostW = ctx.measureText(host).width;
    if (leftEnd + 24 + hostW <= W - P) {
      ctx.fillStyle = _CARD.muted; ctx.textAlign = 'right';
      ctx.fillText(host, W - P, 584);
    }
  }
  ctx.textAlign = 'left';

  return await new Promise(res => cv.toBlob(b => res(b), 'image/png', 0.92));
}

/* ── 공유 진입점 ── */
async function thjShare(topic, mySide) {
  if (!topic) return;
  const url = thjLinkFor(topic.id);
  const text = thjShareText(topic, mySide);
  // 모바일: 이미지 파일 공유가 가능하면 카드 PNG 동봉
  try {
    if (navigator.canShare) {
      const blob = await thjMakeShareCard(topic, mySide);
      const file = new File([blob], 'toronhaja.png', { type: 'image/png' });
      if (navigator.canShare({ files: [file] })) {
        try { await navigator.share({ files: [file], title: '토론하자', text, url }); return; }
        catch (e) { if (e && e.name === 'AbortError') return; }
      }
    }
  } catch (_) { /* 카드 생성/공유 실패 시 아래로 폴백 */ }
  if (navigator.share) {
    try { await navigator.share({ title: '토론하자', text, url }); return; }
    catch (e) { if (e && e.name === 'AbortError') return; }
  }
  thjShareSheet(topic, url, text, mySide);
}

async function thjCopyLink(url) {
  try {
    if (navigator.clipboard) await navigator.clipboard.writeText(url);
    else {
      const ta = document.createElement('textarea');
      ta.value = url; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
    }
    thjToast('링크 복사됨', 'success', 'link');
  } catch (e) { thjToast('복사 실패. 직접 복사해.', 'error'); }
}

function _downloadBlob(blob, name) {
  const u = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = u; a.download = name; document.body.appendChild(a); a.click();
  a.remove(); setTimeout(() => URL.revokeObjectURL(u), 1000);
}

/* ── 자체 공유 시트 (데스크톱 + navigator.share 미지원) ── */
let _shareEl = null, _shareBlob = null;
function thjCloseShareSheet() { if (_shareEl) { _shareEl.remove(); _shareEl = null; _shareBlob = null; document.removeEventListener('keydown', _shareEsc); } }
function _shareEsc(e) { if (e.key === 'Escape') thjCloseShareSheet(); }

function thjShareSheet(topic, url, text, mySide) {
  thjCloseShareSheet();
  const a = DB.ratio(topic), b = 100 - a;
  const tw = 'https://twitter.com/intent/tweet?text=' + encodeURIComponent(text) + '&url=' + encodeURIComponent(url);
  const ov = document.createElement('div');
  ov.className = 'share-overlay';
  ov.innerHTML = `
    <div class="share-sheet" role="dialog" aria-label="공유하기">
      <button class="share-x" aria-label="닫기">${icon('x', 18)}</button>
      <div class="share-head">${icon('share', 18)}<span>이 토론 공유하기</span></div>
      <div class="share-cardimg">
        <div class="share-cardimg-skel"><span class="sk" style="width:100%;height:100%;display:block;border-radius:12px"></span></div>
      </div>
      <div class="share-link"><span class="share-link-url"></span><button class="share-copy">${icon('copy', 15)}복사</button></div>
      <div class="share-apps">
        <button class="share-app save" disabled>${icon('chart', 15)}이미지 저장</button>
        <a class="share-app tw" href="${tw}" target="_blank" rel="noopener">X(트위터)</a>
        <button class="share-app native">${icon('arrow-lr', 15)}다른 앱으로</button>
      </div>
      <p class="share-tip">카드 저장해서 카톡·인스타 스토리에 올리면 찬반 비율 그대로 보인다.</p>
    </div>`;
  document.body.appendChild(ov);
  ov.querySelector('.share-link-url').textContent = url;
  _shareEl = ov;
  void ov.offsetWidth;
  ov.classList.add('show');

  // 카드 이미지 생성 → 미리보기 + 저장 버튼 활성화
  const slot = ov.querySelector('.share-cardimg');
  const saveBtn = ov.querySelector('.share-app.save');
  thjMakeShareCard(topic, mySide).then(blob => {
    _shareBlob = blob;
    const img = new Image();
    img.alt = '공유 카드 미리보기';
    img.className = 'share-cardimg-el';
    img.src = URL.createObjectURL(blob);
    img.onload = () => { slot.innerHTML = ''; slot.appendChild(img); };
    saveBtn.disabled = false;
  }).catch(() => { slot.innerHTML = '<div class="share-cardimg-fail">미리보기 생성 실패</div>'; });

  ov.addEventListener('click', (e) => {
    if (e.target === ov || e.target.closest('.share-x')) return thjCloseShareSheet();
    if (e.target.closest('.share-copy')) return thjCopyLink(url);
    if (e.target.closest('.share-app.save')) {
      if (_shareBlob) _downloadBlob(_shareBlob, `토론하자_${(topic.title || 'debate').slice(0, 20)}.png`);
      return;
    }
    if (e.target.closest('.share-app.native')) {
      (async () => {
        try {
          if (navigator.canShare && _shareBlob) {
            const file = new File([_shareBlob], 'toronhaja.png', { type: 'image/png' });
            if (navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: '토론하자', text, url }); return; }
          }
          if (navigator.share) { await navigator.share({ title: '토론하자', text, url }); return; }
          thjCopyLink(url);
        } catch (e2) { if (!(e2 && e2.name === 'AbortError')) thjCopyLink(url); }
      })();
    }
  });
  document.addEventListener('keydown', _shareEsc);
}

window.thjShare = thjShare;
window.thjLinkFor = thjLinkFor;
window.thjCopyLink = thjCopyLink;
window.thjMakeShareCard = thjMakeShareCard;
