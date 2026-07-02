/* ═══════════════════════════════════════════════
   toronhaja — admin-charts.js
   대시보드 · 분석 · 댓글 모더레이션 (YouTube Studio 스타일)
   캔버스 차트 프리미티브 + 세 개의 뷰 렌더러.
   admin.js 보다 먼저 로드 → 전역 함수로 노출.
   ═══════════════════════════════════════════════ */
'use strict';

/* ── 색 유틸 ── */
function _cssVar(name, fb) { const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim(); return v || fb; }
function _rgba(c, a) {
  c = (c || '').trim();
  if (c[0] === '#') {
    let n = c.slice(1);
    if (n.length === 3) n = n.split('').map(x => x + x).join('');
    const r = parseInt(n.substr(0, 2), 16), g = parseInt(n.substr(2, 2), 16), b = parseInt(n.substr(4, 2), 16);
    return `rgba(${r},${g},${b},${a})`;
  }
  return c;
}
function _roundRect(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
function _cvSetup(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const r = canvas.getBoundingClientRect();
  const w = Math.max(r.width, 80), h = Math.max(r.height, 60);
  canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h };
}

/* ── 라인 차트 (영역 채움) ── */
function thjLineChart(canvas, series, key, opts) {
  if (!canvas) return;
  opts = opts || {};
  const { ctx, w, h } = _cvSetup(canvas);
  ctx.clearRect(0, 0, w, h);
  const vals = series.map(s => s[key] || 0);
  const n = vals.length; if (!n) return;
  const max = Math.max(1, Math.max.apply(null, vals));
  const padL = 32, padR = 12, padT = 12, padB = 22;
  const cw = w - padL - padR, ch = h - padT - padB;
  const accent = opts.color || _cssVar('--a', '#FF5414');
  const grid = _rgba(_cssVar('--text', '#181612'), 0.07);
  const muted = _rgba(_cssVar('--text', '#181612'), 0.42);
  ctx.font = '10px Pretendard, sans-serif';
  // y grid + labels
  ctx.strokeStyle = grid; ctx.fillStyle = muted; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  const ticks = 3;
  for (let i = 0; i <= ticks; i++) {
    const yv = Math.round(max * i / ticks);
    const y = padT + ch - (ch * i / ticks);
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(w - padR, y); ctx.stroke();
    ctx.fillText(String(yv), padL - 6, y);
  }
  const xAt = (i) => padL + (n <= 1 ? cw / 2 : cw * i / (n - 1));
  const yAt = (v) => padT + ch - (ch * (v / max));
  // area
  ctx.beginPath(); ctx.moveTo(xAt(0), yAt(vals[0]));
  for (let i = 1; i < n; i++) ctx.lineTo(xAt(i), yAt(vals[i]));
  ctx.lineTo(xAt(n - 1), padT + ch); ctx.lineTo(xAt(0), padT + ch); ctx.closePath();
  const grad = ctx.createLinearGradient(0, padT, 0, padT + ch);
  grad.addColorStop(0, _rgba(accent, 0.24)); grad.addColorStop(1, _rgba(accent, 0));
  ctx.fillStyle = grad; ctx.fill();
  // line
  ctx.beginPath(); ctx.moveTo(xAt(0), yAt(vals[0]));
  for (let i = 1; i < n; i++) ctx.lineTo(xAt(i), yAt(vals[i]));
  ctx.strokeStyle = accent; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.stroke();
  // last dot
  const li = n - 1;
  ctx.fillStyle = accent; ctx.beginPath(); ctx.arc(xAt(li), yAt(vals[li]), 3.2, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = _cssVar('--surface', '#fff'); ctx.beginPath(); ctx.arc(xAt(li), yAt(vals[li]), 1.3, 0, Math.PI * 2); ctx.fill();
  // x labels (first/mid/last)
  ctx.fillStyle = muted; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  [0, Math.floor((n - 1) / 2), n - 1].forEach(i => { if (series[i]) ctx.fillText(series[i].label, xAt(i), padT + ch + 6); });
}

/* ── 막대 차트 ── */
function thjBarChart(canvas, values, labels, opts) {
  if (!canvas) return;
  opts = opts || {};
  const { ctx, w, h } = _cvSetup(canvas);
  ctx.clearRect(0, 0, w, h);
  const n = values.length; if (!n) return;
  const max = Math.max(1, Math.max.apply(null, values));
  const padL = 6, padR = 6, padT = 8, padB = 16;
  const cw = w - padL - padR, ch = h - padT - padB;
  const accent = opts.color || _cssVar('--a', '#FF5414');
  const muted = _rgba(_cssVar('--text', '#181612'), 0.42);
  const gap = n > 30 ? 1 : 3;
  const bw = (cw / n) - gap;
  for (let i = 0; i < n; i++) {
    const v = values[i];
    const bh = Math.max(ch * (v / max), v ? 2 : 0);
    const x = padL + i * (bw + gap), y = padT + ch - bh;
    ctx.fillStyle = _rgba(accent, v ? (opts.peak === i ? 1 : 0.78) : 0.12);
    if (bh > 0) { _roundRect(ctx, x, y, bw, bh, Math.min(2, bw / 2)); ctx.fill(); }
  }
  ctx.fillStyle = muted; ctx.font = '9px Pretendard, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  const every = opts.labelEvery || 1;
  labels.forEach((lb, i) => { if (i % every) return; const x = padL + i * (bw + gap) + bw / 2; ctx.fillText(lb, x, padT + ch + 4); });
}

/* ════ 대시보드 ════ */
let _dashData = null, _dashMetric = 'comments';
async function renderDashboard() {
  // 채널 요약
  const [stats, store] = await Promise.all([DB.adminStats(), DB.storageStats()]);
  const s = (store && !store.error) ? store : {};
  const sumEl = document.getElementById('dashSummary');
  const items = [
    { ic: 'gavel', label: '전체 토론', val: s.debates != null ? s.debates : stats.topics, sub: '진행중 ' + fmt(stats.topics || 0) },
    { ic: 'comment', label: '전체 댓글', val: s.comments != null ? s.comments : stats.comments },
    { ic: 'like', label: '누적 투표', val: s.votes != null ? s.votes : null },
    { ic: 'users', label: '누적 유저', val: s.users != null ? s.users : null, sub: '제재 ' + fmt(stats.banned || 0) },
    { ic: 'flag', label: '누적 신고', val: stats.reports },
  ];
  sumEl.innerHTML = items.map(it => `
    <div class="sum-row">
      <div class="sum-ic">${icon(it.ic, 16)}</div>
      <div class="sum-body"><div class="sum-label">${it.label}</div>${it.sub ? `<div class="sum-sub">${it.sub}</div>` : ''}</div>
      <div class="sum-val">${it.val == null ? '–' : fmt(it.val)}</div>
    </div>`).join('');

  // 추이 차트
  _dashData = await DB.analyticsSeries(14);
  drawDashChart();

  // 인기 토론 TOP 5
  const topics = await DB.topics();
  const top = [...topics].sort((a, b) => DB.voters(b) - DB.voters(a)).slice(0, 5);
  document.getElementById('dashTop').innerHTML = top.length ? top.map((t, i) => {
    const a = DB.ratio(t), b = 100 - a;
    return `<div class="mini-row">
      <span class="mini-rank">${i + 1}</span>
      <div class="mini-body">
        <div class="mini-title">${esc(t.title)}</div>
        <div class="mini-bar"><span style="width:${a}%"></span></div>
      </div>
      <div class="mini-meta">${fmt(DB.voters(t))}<span>표</span></div>
    </div>`;
  }).join('') : `<div class="empty-mini">토론이 없습니다.</div>`;

  // 처리 대기 (미처리 신고)
  const reports = await DB.reports();
  const openN = reports.filter(r => !r.blinded).length;
  const nb = document.getElementById('navBadge'); if (nb) nb.textContent = openN;
  const pend = reports.filter(r => !r.blinded).slice(0, 6);
  document.getElementById('dashPendTag').textContent = '미처리 ' + openN;
  document.getElementById('dashPending').innerHTML = pend.length ? pend.map(r => `
    <div class="mini-row">
      <span class="mini-dot b"></span>
      <div class="mini-body">
        <div class="mini-title">${esc(r.comments.content) || '내용 없음'}</div>
        <div class="mini-sub">${esc(r.comments.nickname)} · ${esc(r.reason) || '신고'}${r.reportCount > 1 ? ' ·' + r.reportCount + '건' : ''}</div>
      </div>
    </div>`).join('') : `<div class="empty-mini">${icon('check', 14)} 대기 중인 신고가 없습니다.</div>`;
}
function drawDashChart() {
  if (!_dashData) return;
  const colors = { comments: _cssVar('--a', '#FF5414'), votes: _cssVar('--b-bright', '#475569'), users: _cssVar('--live', '#3E7C5A') };
  thjLineChart(document.getElementById('dashChart'), _dashData.days, _dashMetric, { color: colors[_dashMetric] });
  const total = _dashData.days.reduce((s, d) => s + (d[_dashMetric] || 0), 0);
  const sub = document.getElementById('dashTrendSub');
  if (sub) {
    const name = { comments: '댓글', votes: '투표', users: '신규 유저' }[_dashMetric];
    sub.textContent = `최근 14일 ${name} ${fmt(total)}건` + (_dashMetric === 'votes' && !_dashData.votesHasTs ? ' · votes에 시간정보 없음' : '');
  }
}

/* ════ 분석 ════ */
let _anData = null, _anMetric = 'comments', _anDays = 14;
const _AN_COLORS = { comments: '--a', votes: '--b-bright', debates: '--warn', users: '--live' };
async function renderAnalytics() {
  _anData = await DB.analyticsSeries(_anDays);
  const topics = await DB.topics();
  // 지표 카드
  const sum = (k) => _anData ? _anData.days.reduce((s, d) => s + (d[k] || 0), 0) : 0;
  const cards = [
    { label: '댓글', val: sum('comments'), m: 'comments' },
    { label: '투표', val: sum('votes'), m: 'votes', note: _anData && !_anData.votesHasTs ? '시간정보 없음' : '' },
    { label: '신규 토론', val: sum('debates'), m: 'debates' },
    { label: '신규 유저', val: sum('users'), m: 'users' },
  ];
  document.getElementById('anMetrics').innerHTML = cards.map(c => `
    <div class="an-card" data-m="${c.m}">
      <div class="an-card-label">최근 ${_anDays}일 ${c.label}</div>
      <div class="an-card-val">${fmt(c.val)}</div>
      <div class="an-card-note">${c.note || ('일평균 ' + fmt(Math.round(c.val / _anDays)))}</div>
    </div>`).join('');

  drawAnChart();

  // 카테고리별 토론
  const catAgg = {};
  topics.forEach(t => { const c = t.category || '기타'; catAgg[c] = (catAgg[c] || 0) + 1; });
  const catRows = Object.keys(catAgg).map(k => ({ k, n: catAgg[k] })).sort((a, b) => b.n - a.n);
  const catMax = Math.max(1, ...catRows.map(r => r.n));
  document.getElementById('anCats').innerHTML = catRows.map(r => {
    const col = (typeof CAT_COLOR !== 'undefined' && CAT_COLOR[r.k]) || 'var(--a)';
    return `<div class="bar-row">
      <span class="bar-label">${esc(r.k)}</span>
      <div class="bar-track"><span style="width:${Math.max(r.n / catMax * 100, 4)}%;background:${col}"></span></div>
      <span class="bar-val">${fmt(r.n)}</span>
    </div>`;
  }).join('');

  // 시간대별 댓글
  if (_anData) {
    const peak = _anData.hours.indexOf(Math.max.apply(null, _anData.hours));
    const labels = _anData.hours.map((_, i) => (i % 6 === 0 ? i + '시' : ''));
    thjBarChart(document.getElementById('anHours'), _anData.hours, labels, { peak: _anData.hours.some(v => v) ? peak : -1 });
  }

  // 참여 TOP 토론
  const top = [...topics].sort((a, b) => DB.voters(b) - DB.voters(a)).slice(0, 8);
  document.getElementById('anTopRows').innerHTML = top.length ? top.map(t => {
    const a = DB.ratio(t), b = 100 - a;
    return `<tr>
      <td style="max-width:280px"><div style="font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(t.title)}</div></td>
      <td><span class="tag" style="${catStyle(t.category)}"><span class="tag-dot" style="background:${(typeof CAT_COLOR!=='undefined'&&CAT_COLOR[t.category])||'var(--subtext)'}"></span>${esc(t.category)}</span></td>
      <td style="white-space:nowrap;font-variant-numeric:tabular-nums"><span style="color:var(--a-bright);font-weight:700">${a}%</span> <span style="color:var(--muted)">/</span> <span style="color:var(--b-bright);font-weight:700">${b}%</span></td>
      <td style="font-variant-numeric:tabular-nums;font-weight:700">${fmt(DB.voters(t))}</td>
      <td style="font-variant-numeric:tabular-nums">${fmt(t.comment_count)}</td>
    </tr>`;
  }).join('') : `<tr><td colspan="5" style="padding:30px;text-align:center;color:var(--muted)">데이터가 없습니다.</td></tr>`;
}
function drawAnChart() {
  if (!_anData) return;
  thjLineChart(document.getElementById('anChart'), _anData.days, _anMetric, { color: _cssVar(_AN_COLORS[_anMetric], '#FF5414') });
}

/* ════ 댓글 모더레이션 ════ */
let _cmSearchTimer = null;
function commentRowHTML(c) {
  const stateCell = c.blinded
    ? `<span class="status live">${icon('eye', 11)}블라인드</span>`
    : (c.reports > 0 ? `<span class="status warn">신고 ${c.reports}</span>` : `<span class="status" style="color:var(--muted);background:var(--surface-2)">정상</span>`);
  const blindBtn = c.blinded
    ? `<button class="btn ghost" disabled style="height:28px;padding:0 9px;font-size:11.5px;opacity:.4">${icon('eye', 12)}블라인드됨</button>`
    : `<button class="btn ghost act-cblind" data-id="${c.id}" style="height:28px;padding:0 9px;font-size:11.5px">${icon('eye', 12)}블라인드</button>`;
  return `<tr data-cid="${c.id}">
    <td><span class="nick ${c.side}" style="font-size:13px"><span class="nk-dot"></span>${esc(c.nickname)}</span></td>
    <td style="color:var(--text);max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap${c.blinded ? ';color:var(--muted);text-decoration:line-through' : ''}">${esc(c.content) || '—'}</td>
    <td style="color:var(--subtext);max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(c.debate)}</td>
    <td style="font-variant-numeric:tabular-nums;color:${c.reports ? 'var(--b-bright)' : 'var(--muted)'};font-weight:${c.reports ? '700' : '400'}">${c.reports || '–'}</td>
    <td style="color:var(--muted);font-size:12px;white-space:nowrap">${c.created_at ? relTime(c.created_at) : ''}</td>
    <td class="cell-cstatus">${stateCell}</td>
    <td style="text-align:right;white-space:nowrap">
      ${blindBtn}
      <button class="btn ghost dz act-cdel" data-id="${c.id}" data-confirm="0" style="height:28px;padding:0 9px;font-size:11.5px;margin-left:6px">${icon('trash', 12)}삭제</button>
    </td>
  </tr>`;
}
async function renderComments() {
  const body = document.getElementById('commentRows');
  if (!body) return;
  body.innerHTML = `<tr><td colspan="7" style="padding:30px;text-align:center;color:var(--muted)">불러오는 중…</td></tr>`;
  const search = (document.getElementById('cmSearch') || {}).value || '';
  const filter = (document.getElementById('cmFilter') || {}).value || '';
  const res = await DB.allComments({ search, filter });
  const rows = (res && res.rows) || [];
  const cnt = document.getElementById('cmCount'); if (cnt) cnt.textContent = rows.length + '개';
  body.innerHTML = rows.length
    ? rows.map(commentRowHTML).join('')
    : `<tr><td colspan="7" style="padding:30px;text-align:center;color:var(--muted)">${res && res.error ? '목록을 불러오지 못했습니다' : '해당하는 댓글이 없습니다'}</td></tr>`;
}

/* ── 이벤트 위임: 대시보드/분석 세그 토글, 댓글 액션, 새로고침/검색 ── */
document.addEventListener('click', async (e) => {
  // 세그먼트 토글
  const seg = e.target.closest('.seg-btn');
  if (seg) {
    const wrap = seg.parentElement;
    wrap.querySelectorAll('.seg-btn').forEach(b => b.classList.remove('on'));
    seg.classList.add('on');
    if (wrap.id === 'dashMetricSeg') { _dashMetric = seg.dataset.m; drawDashChart(); }
    else if (wrap.id === 'anMetricSeg') { _anMetric = seg.dataset.m; drawAnChart(); }
    else if (wrap.id === 'anRangeSeg') { _anDays = +seg.dataset.d; renderAnalytics(); }
    return;
  }
  // 분석 지표 카드 클릭 → 차트 지표 전환
  const anCard = e.target.closest('.an-card');
  if (anCard) {
    _anMetric = anCard.dataset.m;
    const segWrap = document.getElementById('anMetricSeg');
    if (segWrap) segWrap.querySelectorAll('.seg-btn').forEach(b => b.classList.toggle('on', b.dataset.m === _anMetric));
    drawAnChart();
    return;
  }
  // 댓글 블라인드
  const cb = e.target.closest('.act-cblind');
  if (cb && !cb.disabled) {
    cb.disabled = true;
    const res = await DB.blindComment(cb.dataset.id);
    if (res && res.ok) {
      const row = cb.closest('tr');
      row.querySelector('.cell-cstatus').innerHTML = `<span class="status live">${icon('eye', 11)}블라인드</span>`;
      cb.outerHTML = `<button class="btn ghost" disabled style="height:28px;padding:0 9px;font-size:11.5px;opacity:.4">${icon('eye', 12)}블라인드됨</button>`;
    } else { cb.disabled = false; cb.innerHTML = icon('x', 12) + '실패'; setTimeout(() => { cb.innerHTML = icon('eye', 12) + '블라인드'; }, 1500); }
    return;
  }
  // 댓글 삭제 (2번 눌러 확인)
  const cd = e.target.closest('.act-cdel');
  if (cd && !cd.disabled) {
    if (cd.dataset.confirm !== '1') {
      cd.dataset.confirm = '1'; cd.dataset.orig = cd.innerHTML; cd.textContent = '정말 삭제?';
      setTimeout(() => { if (cd.isConnected && cd.dataset.confirm === '1') { cd.dataset.confirm = '0'; cd.innerHTML = cd.dataset.orig; } }, 2400);
      return;
    }
    cd.disabled = true; cd.textContent = '삭제중…';
    const res = await DB.deleteComment(cd.dataset.id);
    if (res && res.ok) { const row = cd.closest('tr'); if (row) { row.style.transition = 'opacity .2s'; row.style.opacity = '0'; setTimeout(() => row.remove(), 200); } }
    else { cd.disabled = false; cd.innerHTML = icon('trash', 12) + '삭제'; cd.dataset.confirm = '0'; }
    return;
  }
});
(function wireCommentFilters() {
  const s = document.getElementById('cmSearch');
  if (s) s.addEventListener('input', () => { clearTimeout(_cmSearchTimer); _cmSearchTimer = setTimeout(renderComments, 280); });
  const f = document.getElementById('cmFilter'); if (f) f.addEventListener('change', renderComments);
  const rb = document.getElementById('commentsRefresh'); if (rb) rb.addEventListener('click', renderComments);
})();

/* 화면 크기 변경 시 보이는 차트 다시 그림 */
let _chartResizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(_chartResizeTimer);
  _chartResizeTimer = setTimeout(() => {
    const dash = document.getElementById('view-dash');
    const an = document.getElementById('view-analytics');
    if (dash && dash.style.display !== 'none') drawDashChart();
    if (an && an.style.display !== 'none') { drawAnChart(); if (_anData) { const peak = _anData.hours.indexOf(Math.max.apply(null, _anData.hours)); thjBarChart(document.getElementById('anHours'), _anData.hours, _anData.hours.map((_, i) => (i % 6 === 0 ? i + '시' : '')), { peak: _anData.hours.some(v => v) ? peak : -1 }); } }
  }, 200);
});
