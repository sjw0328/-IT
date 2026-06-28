/* ════════════════════════════════════════════════════════════
   toronhaja — build-seo.mjs
   정적 호스팅(GitHub Pages)용 SEO 정적 생성기.

   하는 일:
    1) Supabase 의 debates 를 anon(publishable) 키로 읽는다.
       (라이브 사이트와 동일한 읽기 경로 — RLS 의 debates SELECT 가 열려 있어 가능)
    2) 토론마다 app/d/<id>/index.html 을 굽는다:
         · 토론별 <title> · meta description · canonical
         · OG / Twitter 카드 태그(제목·요약·이미지) → 공유 미리보기가 토론별로 뜬다
         · JSON-LD(QAPage) 구조화 데이터
         · 본문에 질문·찬반 라벨·찬반 집계·양측 대표 의견을 미리 구워 넣는다
           → Google 이 '내용 있는 진짜 페이지'를 크롤링한다
         · JS 브라우저는 앱 루트(?d=<id>)로 보내 인터랙티브 화면으로 진입
    3) app/sitemap.xml · app/robots.txt 를 토론 URL 로 자동 생성한다.

   실행: node scripts/build-seo.mjs
   환경변수:
     SITE_ORIGIN  사이트 절대 origin (sitemap/OG/canonical 용)
                  기본값: https://xn--hq1bm8jm9l.kro.kr  (= 토론하자.kro.kr)
     SUPABASE_URL / SUPABASE_KEY  (선택) 지정 시 app/supabase.js 대신 사용
   ════════════════════════════════════════════════════════════ */

import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
// 사이트 파일이 저장소 '루트'에 바로 있는 구조(sjw0328/-IT).
// 이 스크립트는 <repo>/scripts/ 에 있으므로 상위 폴더가 곧 사이트 루트.
const APP = join(__dirname, '..');

const SITE_ORIGIN = (process.env.SITE_ORIGIN || 'https://xn--6o2bu1z0rh3yd.kro.kr').replace(/\/+$/, '');

/* ── Supabase 접속정보: env 우선, 없으면 app/supabase.js 에서 읽음(단일 출처) ── */
async function supaCreds() {
  let url = process.env.SUPABASE_URL, key = process.env.SUPABASE_KEY;
  if (!url || !key) {
    const src = await readFile(join(APP, 'supabase.js'), 'utf8');
    url = url || (src.match(/SUPABASE_URL\s*=\s*'([^']+)'/) || [])[1];
    key = key || (src.match(/SUPABASE_KEY\s*=\s*'([^']+)'/) || [])[1];
  }
  if (!url || !key) throw new Error('Supabase URL/KEY 를 찾지 못했습니다 (env 또는 app/supabase.js).');
  return { url: url.replace(/\/+$/, ''), key };
}

async function rest(creds, path) {
  const r = await fetch(creds.url + '/rest/v1/' + path, {
    headers: { apikey: creds.key, Authorization: 'Bearer ' + creds.key },
  });
  if (!r.ok) throw new Error('REST ' + r.status + ' ' + path + ' — ' + (await r.text()).slice(0, 200));
  return r.json();
}

/* ── HTML 유틸 ── */
const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const clip = (s, n) => { s = String(s ?? '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1).trim() + '…' : s; };

const CAT_COLOR = {
  정치: '#7C6FE0', 축구: '#1FA97A', 연예: '#E060A0', 게임: '#1FAEC0',
  사회: '#C99A1E', 경제: '#15A99A', 기타: '#7a8290',
};

/* ── 토론 1개 → 정적 페이지 HTML ── */
function pageHTML(d, comments) {
  const aLabel = d.side_a_label || '찬성';
  const bLabel = d.side_b_label || '반대';
  const a = +d.a_count || 0, b = +d.b_count || 0, tot = a + b;
  const aPct = tot ? Math.round(a / tot * 100) : 50;
  const bPct = 100 - aPct;
  const cat = d.category || '기타';
  const catColor = CAT_COLOR[cat] || CAT_COLOR['기타'];

  const aComments = comments.filter(c => String(c.side).toUpperCase() === 'A').slice(0, 4);
  const bComments = comments.filter(c => String(c.side).toUpperCase() === 'B').slice(0, 4);

  const title = clip(d.title, 70);
  const descSrc = (d.description && d.description.trim())
    ? d.description
    : `${d.title} — 지금 ${aLabel} ${aPct}% · ${bLabel} ${bPct}%. 근거로 부딪치는 실시간 찬반 토론.`;
  const desc = clip(descSrc, 150);
  const canonical = `${SITE_ORIGIN}/d/${encodeURIComponent(d.id)}/`;
  const ogImg = `${SITE_ORIGIN}/og.png`;
  const fullTitle = `${title} · 토론하자`;

  const commentLi = (c) => `<li class="arg">${esc(clip(c.content, 220))}</li>`;
  const argList = (arr) => arr.length
    ? `<ul class="args">${arr.map(commentLi).join('')}</ul>`
    : `<p class="empty">아직 등록된 의견이 없습니다. 첫 의견을 남겨보세요.</p>`;

  // JSON-LD: QAPage — 질문 + 양측 대표 의견을 답변으로
  const answers = [...aComments.slice(0, 2), ...bComments.slice(0, 2)]
    .map(c => ({ '@type': 'Answer', text: clip(c.content, 280) }));
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'QAPage',
    mainEntity: {
      '@type': 'Question',
      name: d.title,
      text: d.description || d.title,
      answerCount: comments.length,
      dateCreated: d.created_at || undefined,
      ...(answers.length ? {
        suggestedAnswer: answers,
        ...(answers[0] ? { acceptedAnswer: answers[0] } : {}),
      } : {}),
    },
  };

  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
<title>${esc(fullTitle)}</title>
<meta name="description" content="${esc(desc)}" />
<link rel="canonical" href="${esc(canonical)}" />
<meta name="theme-color" content="#F3F2EF" />
<meta property="og:type" content="article" />
<meta property="og:site_name" content="토론하자" />
<meta property="og:url" content="${esc(canonical)}" />
<meta property="og:title" content="${esc(fullTitle)}" />
<meta property="og:description" content="${esc(desc)}" />
<meta property="og:image" content="${esc(ogImg)}" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${esc(fullTitle)}" />
<meta name="twitter:description" content="${esc(desc)}" />
<meta name="twitter:image" content="${esc(ogImg)}" />
<link rel="icon" type="image/png" href="../../favicon-32.png" />
<link rel="apple-touch-icon" href="../../favicon-180.png" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://cdn.jsdelivr.net" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Black+Han+Sans&display=swap" rel="stylesheet" />
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css" />
<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
<style>
  :root{--bg:#F3F2EF;--surface:#fff;--text:#1b1f24;--sub:#5b6470;--line:#e6e3db;
        --a:#3a6df0;--b:#e0506e;--cat:${catColor}}
  *{box-sizing:border-box}
  html,body{margin:0}
  body{background:var(--bg);color:var(--text);
       font-family:Pretendard,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
       line-height:1.6;-webkit-font-smoothing:antialiased}
  .wrap{max-width:760px;margin:0 auto;padding:20px 20px 64px}
  header{display:flex;align-items:center;gap:12px;padding:6px 0 22px}
  .logo{font-family:"Black Han Sans",Pretendard,sans-serif;font-size:26px;text-decoration:none;color:var(--text)}
  .logo .dot{color:var(--a)}
  .chip{display:inline-flex;align-items:center;gap:6px;font-size:12.5px;font-weight:700;
        color:var(--cat);background:color-mix(in srgb,var(--cat) 12%,#fff);
        border:1px solid color-mix(in srgb,var(--cat) 26%,#fff);border-radius:999px;padding:4px 11px}
  h1{font-size:27px;line-height:1.32;letter-spacing:-.02em;margin:14px 0 10px;text-wrap:pretty}
  .desc{color:var(--sub);font-size:15.5px;margin:0 0 22px}
  .tally{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:16px 18px;margin-bottom:26px}
  .tally-top{display:flex;justify-content:space-between;font-size:14px;font-weight:800;margin-bottom:9px}
  .tally-top .la{color:var(--a)} .tally-top .lb{color:var(--b)}
  .bar{height:12px;border-radius:8px;overflow:hidden;display:flex;background:var(--b)}
  .bar i{display:block;height:100%;background:var(--a)}
  .tally-foot{margin-top:9px;font-size:12.5px;color:var(--sub)}
  .cols{display:grid;grid-template-columns:1fr 1fr;gap:18px}
  @media(max-width:620px){.cols{grid-template-columns:1fr}h1{font-size:23px}}
  .col h2{font-size:15px;margin:0 0 12px;padding-bottom:8px;border-bottom:2px solid var(--line)}
  .col.a h2{color:var(--a);border-color:color-mix(in srgb,var(--a) 35%,#fff)}
  .col.b h2{color:var(--b);border-color:color-mix(in srgb,var(--b) 35%,#fff)}
  .args{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:10px}
  .arg{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:12px 14px;font-size:14.5px}
  .empty{color:var(--sub);font-size:13.5px}
  .cta{display:inline-flex;align-items:center;gap:8px;margin-top:34px;
       background:var(--text);color:#fff;text-decoration:none;font-weight:800;font-size:15px;
       border-radius:12px;padding:14px 22px}
  footer{margin-top:40px;padding-top:18px;border-top:1px solid var(--line);font-size:12.5px;color:var(--sub)}
  footer a{color:var(--sub)}
</style>
</head>
<body>
  <div class="wrap">
    <header>
      <a class="logo" href="../../">토론하자<span class="dot">.</span></a>
      <span class="chip">${esc(cat)}</span>
    </header>

    <main>
      <h1>${esc(d.title)}</h1>
      <p class="desc">${esc(d.description || `근거로 부딪치는 실시간 찬반 토론. 넌 ${aLabel}? ${bLabel}?`)}</p>

      <div class="tally" role="img" aria-label="${esc(aLabel)} ${aPct}퍼센트, ${esc(bLabel)} ${bPct}퍼센트">
        <div class="tally-top"><span class="la">${esc(aLabel)} ${aPct}%</span><span class="lb">${bPct}% ${esc(bLabel)}</span></div>
        <div class="bar"><i style="width:${aPct}%"></i></div>
        <div class="tally-foot">참여 ${tot.toLocaleString('ko-KR')}명 · 의견 ${(+d.comment_count || comments.length).toLocaleString('ko-KR')}개${d.status === 'closed' ? ' · 마감된 토론' : ''}</div>
      </div>

      <div class="cols">
        <section class="col a"><h2>${esc(aLabel)} 측 의견</h2>${argList(aComments)}</section>
        <section class="col b"><h2>${esc(bLabel)} 측 의견</h2>${argList(bComments)}</section>
      </div>

      <a class="cta" href="../../?d=${encodeURIComponent(d.id)}">이 토론에 참여하기 →</a>
    </main>

    <footer>
      <a href="../../">토론하자</a> · 찬반이 갈리는 실시간 토론 — 한 줄로 입장을 고르고, 근거로 부딪쳐라.
    </footer>
  </div>

  <!-- JS 브라우저는 인터랙티브 앱으로 진입(내용은 위에 이미 구워져 있어 크롤러·미리보기는 그대로 읽는다) -->
  <script>
    (function () {
      var id = ${JSON.stringify(String(d.id))};
      location.replace('../../?d=' + encodeURIComponent(id));
    })();
  </script>
</body>
</html>
`;
}

/* ── 간단한 동시성 제한 맵 ── */
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx], idx); }
  }));
  return out;
}

async function main() {
  const creds = await supaCreds();
  console.log('[build-seo] Supabase:', creds.url);
  console.log('[build-seo] SITE_ORIGIN:', SITE_ORIGIN);

  const debates = await rest(creds,
    'debates?select=id,title,description,category,side_a_label,side_b_label,a_count,b_count,comment_count,status,created_at,ends_at&order=created_at.desc');
  console.log('[build-seo] 토론', debates.length, '개');

  // 댓글: 토론별 최신 의견 일부 (블라인드 제외). is_blinded 컬럼이 없으면 필터 없이 재시도.
  async function topComments(id) {
    const base = 'comments?debate_id=eq.' + encodeURIComponent(id) +
      '&select=side,content,created_at&order=created_at.desc&limit=30';
    try { return await rest(creds, base + '&is_blinded=eq.false'); }
    catch { try { return await rest(creds, base); } catch { return []; } }
  }

  // 기존 d/ 폴더를 비우고 새로 생성(삭제된 토론의 잔재 페이지 제거)
  const dDir = join(APP, 'd');
  if (existsSync(dDir)) await rm(dDir, { recursive: true, force: true });

  const commentsByDebate = await mapLimit(debates, 6, async (d) => topComments(d.id));

  let written = 0;
  for (let k = 0; k < debates.length; k++) {
    const d = debates[k];
    if (!d.title) continue;
    const dir = join(dDir, String(d.id));
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'index.html'), pageHTML(d, commentsByDebate[k] || []), 'utf8');
    written++;
  }
  console.log('[build-seo] 정적 페이지', written, '개 생성 → app/d/<id>/index.html');

  // ── sitemap.xml ──
  const now = new Date().toISOString();
  const urls = [
    { loc: SITE_ORIGIN + '/', lastmod: now, priority: '1.0', changefreq: 'hourly' },
    ...debates.filter(d => d.title).map(d => ({
      loc: `${SITE_ORIGIN}/d/${encodeURIComponent(d.id)}/`,
      lastmod: (d.created_at ? new Date(d.created_at).toISOString() : now),
      priority: '0.8', changefreq: 'daily',
    })),
  ];
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u => `  <url><loc>${u.loc}</loc><lastmod>${u.lastmod}</lastmod><changefreq>${u.changefreq}</changefreq><priority>${u.priority}</priority></url>`).join('\n')}
</urlset>
`;
  await writeFile(join(APP, 'sitemap.xml'), sitemap, 'utf8');
  console.log('[build-seo] sitemap.xml —', urls.length, 'URL');

  // ── robots.txt ──
  const robots = `User-agent: *
Allow: /

Sitemap: ${SITE_ORIGIN}/sitemap.xml
`;
  await writeFile(join(APP, 'robots.txt'), robots, 'utf8');
  console.log('[build-seo] robots.txt');
  console.log('[build-seo] 완료 ✅');
}

main().catch((e) => { console.error('[build-seo] 실패:', e); process.exit(1); });
