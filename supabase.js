/* ═══════════════════════════════════════════════
   toronhaja — supabase.js
   100% 서버 구동 데이터 계층.
   실제 스키마(users / debates / votes / comments /
   comment_likes / reports) 기반.
   ── 데모/가짜 데이터 일절 없음 ──
   ─ 집계(찬/반/댓글수)는 debates 의 저장 컬럼을 읽음 (optimize.sql 트리거가 유지)
   ─ 토픽 목록은 20초 캐시로 정렬/검색/필터/랭킹이 한 쿼리를 재사용
   ─ 실시간 접속자 수는 Supabase Realtime Presence
   ═══════════════════════════════════════════════ */

'use strict';

/* ── 설정 ────────────────────────────────────── */
const SUPABASE_URL = 'https://yukzktyocjjzbkcjpbxu.supabase.co';
const SUPABASE_KEY = 'sb_publishable_RX4PFJzdLA1uWFAjiactQw_3W_KM3Gc';

let sb = null;
if (SUPABASE_URL && window.supabase) {
  sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  console.info('[toronhaja] Supabase 연결됨:', SUPABASE_URL);
} else {
  console.error('[toronhaja] Supabase 미연결 — 데이터를 불러올 수 없습니다.');
}

/* ── 익명 유저 (1기기 1계정) ─────────────────── */
let MY_UID = localStorage.getItem('thj_uid') || null;

function rand(n) { return Math.floor(Math.random() * n); }
function genNick() {
  const adj = ['푸른', '침착한', '날쌘', '강철', '신중한', '냉철한', '단단한', '조용한', '단호한', '뜨거운',
               '명랑한', '용감한', '은빛', '거침없는', '똑똑한', '노련한', '무던한', '산뜻한', '대담한', '꼿꼿한',
               '잔잔한', '상냥한', '우직한', '번뜩이는'];
  const ani = ['독수리', '고래', '여우', '곰', '매', '늑대', '상어', '표범', '올빼미', '범고래',
               '수달', '너구리', '두루미', '사슴', '코뿔소', '멧돼지', '사자', '호랑이', '순록', '물범',
               '담비', '비버', '두더지', '말똥가리'];
  return adj[rand(adj.length)] + ani[rand(ani.length)] + (10 + rand(90));
}
function myNick() {
  let n = localStorage.getItem('thj_nick');
  if (!n) { n = genNick(); localStorage.setItem('thj_nick', n); }
  return n;
}
const EMOJIS = ['🦅', '🐳', '🦊', '🐻', '🦉', '🐋', '🦬', '🐺', '🦈', '🐆', '🦏', '🐗', '🦁', '🐯', '🦌', '🐃'];
function hashStr(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h); }
function emojiFor(nick) { return EMOJIS[hashStr(nick || '익명') % EMOJIS.length]; }
/* 같은 닉네임 구분용 짧은 식별 태그 (uid 기반, 사용자마다 고정) — 헷갈리는 동명이인 방지 */
const TAG_CH = 'abcdefghjkmnpqrstuvwxyz23456789';
function tagOf(s) {
  let h = hashStr(String(s || '익명')); let out = '';
  for (let i = 0; i < 3; i++) { out += TAG_CH[h % TAG_CH.length]; h = Math.floor(h / TAG_CH.length) + 7; }
  return out;
}

/* 댓글/투표 시 실제 users 행 생성 (최초 1회). 단순 열람으로는 생성하지 않음. */
async function ensureUser() {
  if (MY_UID) return MY_UID;
  if (!sb) return null;
  const nick = myNick();
  const { data, error } = await sb.from('users').insert({ nickname: nick }).select('id').single();
  if (error || !data) { console.error('[toronhaja] 유저 생성 실패:', error && error.message); return null; }
  MY_UID = data.id;
  localStorage.setItem('thj_uid', MY_UID);
  return MY_UID;
}

/* presence 키 — 유저 행을 만들지 않고도 고유 식별
   ※ localStorage 에 저장해 "브라우저당 1개"로 안정화한다.
     (예전엔 sessionStorage = 탭마다 다른 키 → 같은 사람이 탭 여러 개·새로고침하면
      동시 접속자로 중복 집계되어 숫자가 부풀려졌다. 이제 같은 브라우저는 항상 1명.) */
let SESSION_KEY = localStorage.getItem('thj_skey') || sessionStorage.getItem('thj_skey');
if (!SESSION_KEY) { SESSION_KEY = 'g_' + Math.random().toString(36).slice(2, 12); }
localStorage.setItem('thj_skey', SESSION_KEY);
function presenceKey() { return MY_UID || SESSION_KEY; }

/* ── 관리자 인증 패스 ────────────────────────────
   admin.html 게이트를 통과하면 입력한 비밀번호가 여기로 주입된다(DB.setAdminPass).
   security.sql 의 게이트 RPC(thj_admin_*) 호출 시 함께 보내 서버에서 검증한다. */
let ADMIN_PASS = null;
function setAdminPass(p) { ADMIN_PASS = (p == null ? null : String(p)); }

/* 함수 미설치(=security.sql/presence.sql 미실행) 판별 → 호출부가 예전 경로로 폴백 */
function rpcMissing(err) {
  if (!err) return false;
  return /function|does not exist|schema cache|could not find|not find|404|PGRST202/i.test((err.message || '') + ' ' + (err.code || ''));
}
/* 관리자 게이트 RPC 래퍼 — { data } | { error } | { missing:true } */
async function adminRPC(fn, args) {
  if (!sb) return { error: { message: 'no client' } };
  const res = await sb.rpc(fn, Object.assign({ pass: ADMIN_PASS }, args || {}));
  if (res.error && rpcMissing(res.error)) return { missing: true };
  return res;
}

/* ── 헬퍼 ────────────────────────────────────── */
function ratio(t) { const tot = (t.a_count || 0) + (t.b_count || 0); return tot ? Math.round(t.a_count / tot * 100) : 50; }
function voters(t) { return (t.a_count || 0) + (t.b_count || 0); }

/* ── 매핑 (DB row → 앱 형태) ─────────────────── */
function mapDebate(d) {
  return {
    id: d.id, category: d.category || '기타', title: d.title, description: d.description,
    a_count: +d.a_count || 0, b_count: +d.b_count || 0, comment_count: +d.comment_count || 0,
    is_hot: !!d.is_hot, ends_at: d.ends_at, status: d.status || 'active',
    time: (d.status === 'closed') ? '마감됨' : ((d.ends_at && typeof fmtCountdown === 'function') ? fmtCountdown(d.ends_at) : '진행중'),
    side_a_label: d.side_a_label, side_b_label: d.side_b_label, created_at: d.created_at,
  };
}
function mapComment(c, myLikes) {
  const side = String(c.side || 'A').toLowerCase();
  const nick = (c.users && c.users.nickname) || c.nickname || '익명';
  const likes = Array.isArray(c.comment_likes) ? (c.comment_likes[0] ? c.comment_likes[0].count : 0) : (c.likes || 0);
  return {
    id: c.id, side, nickname: nick, uid: c.user_id || null,
    emoji: c.emoji || emojiFor(c.user_id || nick), tag: tagOf(c.user_id || nick),
    body: c.content != null ? c.content : c.body, likes,
    edition: c.edition || null,
    is_blind: c.is_blinded || false,
    created_at: c.created_at ? (typeof relTime === 'function' ? relTime(c.created_at) : c.created_at) : '방금 전',
    mine: c.user_id === MY_UID,
    liked: myLikes ? myLikes.has(c.id) : false,
  };
}
function mapReport(r) {
  const cm = r.comments || {};
  return {
    id: r.id, commentId: r.comment_id, targetUserId: cm.user_id || null,
    reason: r.reason, status: r.status || 'new',
    blinded: !!cm.is_blinded,
    reporter: (r.reporter && r.reporter.nickname) || '익명',
    created_at: r.created_at,
    created_label: r.created_at ? (typeof relTime === 'function' ? relTime(r.created_at) : '') : '',
    comments: { nickname: (cm.users && cm.users.nickname) || '삭제됨', side: String(cm.side || 'B').toLowerCase(), content: cm.content || '' },
    topics: { title: (cm.debates && cm.debates.title) || '—' },
  };
}

/* 토픽 목록 캐시 ─ 정렬/검색/필터/랭킹이 같은 목록을 재사용해 서버 요청을 줄인다.
   찬/반/댓글 수는 debates 테이블의 집계 컬럼(optimize.sql 트리거가 유지)을
   그대로 읽으므로 더 이상 votes/comments 전체를 내려받지 않는다. */
let _topicsCache = null, _topicsAt = 0;
const _nickCache = new Map();   // user_id → nickname (실시간 댓글 N+1 조회 방지)
const TOPICS_TTL = 20000;
function invalidateTopics() { _topicsCache = null; _topicsAt = 0; }

/* optimize.sql 미실행(집계 컬럼 없음) 시 임시 집계 폴백 — 예전 방식 */
let _warnedNoCounts = false;
async function fallbackCounts(rows) {
  if (!_warnedNoCounts) { _warnedNoCounts = true; console.warn('[toronhaja] ⚠ debates.a_count 컬럼 없음 — optimize.sql 을 실행하세요. 임시로 직접 집계합니다 (트래픽 높음).'); }
  const [vr, cr] = await Promise.all([
    sb.from('votes').select('debate_id, side'),
    sb.from('comments').select('debate_id'),
  ]);
  const agg = {};
  rows.forEach(d => { agg[d.id] = { a: 0, b: 0, c: 0 }; });
  (vr.data || []).forEach(v => { const g = agg[v.debate_id]; if (!g) return; String(v.side).toUpperCase() === 'A' ? g.a++ : g.b++; });
  (cr.data || []).forEach(c => { const g = agg[c.debate_id]; if (g) g.c++; });
  return rows.map(d => ({ ...d, a_count: agg[d.id].a, b_count: agg[d.id].b, comment_count: agg[d.id].c }));
}

/* ── 데이터 접근 계층 (전부 서버 구동) ───────── */
const DB = {
  live: !!sb, ratio, voters, myNick, genNick, emojiFor, tagOf,
  lastError: null,
  invalidate: invalidateTopics,
  get uid() { return MY_UID; },

  /* 닉네임 변경 — 로컬 저장 + (유저 행이 있으면) 서버 1회 갱신 */
  async setNick(name) {
    const v = String(name || '').trim().slice(0, 10);
    if (v.length < 2) return { error: 'too short' };
    localStorage.setItem('thj_nick', v);
    if (sb && MY_UID) {
      // security.sql 적용 시 users 직접 update 가 막히므로 닉네임 전용 RPC 우선
      const r = await sb.rpc('thj_set_nickname', { uid: MY_UID, name: v });
      if (r.error && rpcMissing(r.error)) {
        const { error } = await sb.from('users').update({ nickname: v }).eq('id', MY_UID);
        if (error) console.warn('[toronhaja] 닉네임 서버 갱신 실패:', error.message);
      } else if (r.error) {
        console.warn('[toronhaja] 닉네임 서버 갱신 실패:', r.error.message);
      }
    }
    return { ok: true, nick: v };
  },

  async topics(force) {
    if (!sb) return [];
    // 20초 내 재요청은 캐시 재사용 (정렬/검색/필터/랭킹 전환 시 추가 쿼리 없음)
    if (!force && _topicsCache && (Date.now() - _topicsAt) < TOPICS_TTL) return _topicsCache;
    let data, error;
    try { ({ data, error } = await sb.from('debates').select('*').order('created_at', { ascending: false })); }
    catch (e) { error = e; }
    if (error) {
      console.error('[toronhaja] debates 조회 실패:', error.message || error);
      DB.lastError = _topicsCache ? null : 'network';   // 캐시조차 없으면 연결 실패로 표시
      return _topicsCache || [];
    }
    DB.lastError = null;
    let rows = data || [];
    if (rows.length && rows[0].a_count === undefined) rows = await fallbackCounts(rows);
    _topicsCache = rows.map(mapDebate);
    // 트리거(optimize.sql) 미작동으로 집계 컬럼이 0/0 인데 실제로는 투표가 있는 토론 보정.
    //   0/0 인 토론의 votes 만 한 쿼리로 가져와(대개 새 토론 몇 개뿐) 정확히 채운다.
    //   → 홈 피드의 새 토론이 50:50 으로 굳는 문제 방지. 집계가 살아있는 토론은 건드리지 않음(추가 전송 0).
    try {
      const zeroIds = _topicsCache.filter(t => (t.a_count + t.b_count) === 0).map(t => t.id).slice(0, 80);
      if (zeroIds.length) {
        const { data: vrows } = await sb.from('votes').select('debate_id, side').in('debate_id', zeroIds);
        if (vrows && vrows.length) {
          const agg = {};
          vrows.forEach(v => { (agg[v.debate_id] || (agg[v.debate_id] = { a: 0, b: 0 }))[String(v.side).toUpperCase() === 'A' ? 'a' : 'b']++; });
          _topicsCache.forEach(t => { const g = agg[t.id]; if (g) { t.a_count = g.a; t.b_count = g.b; } });
        }
      }
    } catch (e) { /* 보정 실패해도 피드는 그대로 표시 */ }
    // 댓글 수 보정 — 집계 컬럼(comment_count)이 0 인 토론만 comments 를 한 쿼리로 세어 정확히 채운다.
    //   트리거(optimize.sql) 미작동/백필 누락으로 홈 피드의 댓글 수가 0 으로 굳는 문제 방지.
    //   집계가 살아있는(>0) 토론은 건드리지 않으므로 추가 전송이 거의 없다. (투표 보정과 동일한 방식)
    try {
      const zeroCIds = _topicsCache.filter(t => t.comment_count === 0).map(t => t.id).slice(0, 80);
      if (zeroCIds.length) {
        const { data: crows } = await sb.from('comments').select('debate_id').in('debate_id', zeroCIds);
        if (crows && crows.length) {
          const cagg = {};
          crows.forEach(c => { cagg[c.debate_id] = (cagg[c.debate_id] || 0) + 1; });
          _topicsCache.forEach(t => { const n = cagg[t.id]; if (n) t.comment_count = n; });
        }
      }
    } catch (e) { /* 보정 실패해도 피드는 그대로 표시 */ }
    _topicsAt = Date.now();
    // 상세 즉시 진입용 스냅샷 — 피드에서 보던 값(카테고리/제목/찬반/시간)을 로컬에 저장.
    //   카드 클릭 시 서버 왕복 없이 상세 골격을 0.1초 안에 그릴 수 있다(딥링크/새로고침도 커버).
    try {
      const snap = {};
      _topicsCache.forEach(t => { snap[t.id] = {
        id: t.id, category: t.category, title: t.title, description: t.description,
        a_count: t.a_count, b_count: t.b_count, comment_count: t.comment_count,
        is_hot: t.is_hot, ends_at: t.ends_at, status: t.status, created_at: t.created_at,
        side_a_label: t.side_a_label, side_b_label: t.side_b_label,
      }; });
      localStorage.setItem('thj_topic_snap', JSON.stringify(snap));
    } catch (e) { /* 스냅샷 저장 실패는 무해(메모리 캐시로 동작) */ }
    return _topicsCache;
  },

  /* 동기(서버 왕복 없음) 캐시 조회 — 상세 1단계 즉시 렌더용.
     메모리 캐시 → 로컬 스냅샷 순으로 찾는다. 없으면 null. */
  cachedTopic(id) {
    if (_topicsCache) {
      const t = _topicsCache.find(x => String(x.id) === String(id));
      if (t) return t;
    }
    try {
      const snap = JSON.parse(localStorage.getItem('thj_topic_snap') || '{}');
      if (snap[id]) return mapDebate(snap[id]);   // 다시 map → 남은 시간(countdown) 재계산
    } catch (e) {}
    return null;
  },

  /* 동기 캐시 조회 — 피드 즉시 렌더용. 메모리 캐시 → 로컬 스냅샷 순.
     스냅샷은 created_at 내림차순(서버 정렬과 동일)으로 돌려준다. 없으면 null. */
  cachedTopics() {
    if (_topicsCache && _topicsCache.length) return _topicsCache;
    try {
      const snap = JSON.parse(localStorage.getItem('thj_topic_snap') || '{}');
      const arr = Object.values(snap);
      if (arr.length) {
        return arr
          .sort((x, y) => new Date(y.created_at || 0) - new Date(x.created_at || 0))
          .map(mapDebate);
      }
    } catch (e) {}
    return null;
  },

  async topic(id) {
    if (!sb) return null;
    const { data: d, error } = await sb.from('debates').select('*').eq('id', id).single();
    if (error || !d) { if (error) console.error('[toronhaja] debate 조회 실패:', error.message); return null; }
    /* 상세 화면은 단일 토론이라, votes 를 head-count(행 미전송)로 직접 세어
       집계 컬럼(optimize.sql 트리거)이 미유지/지연이어도 항상 정확하게 보인다.
       → "투표가 5초 뒤 50:50 으로 되돌아가는" 문제(집계 컬럼이 0 으로 고정)를 방지.
       (피드 목록은 여전히 집계 컬럼을 써서 트래픽이 안 늘어난다 — 여긴 단일 토론만) */
    const [ra, rb, rc] = await Promise.all([
      sb.from('votes').select('id', { count: 'exact', head: true }).eq('debate_id', id).eq('side', 'A'),
      sb.from('votes').select('id', { count: 'exact', head: true }).eq('debate_id', id).eq('side', 'B'),
      sb.from('comments').select('id', { count: 'exact', head: true }).eq('debate_id', id),
    ]);
    const a_count = ra.error ? (+d.a_count || 0) : (ra.count || 0);
    const b_count = rb.error ? (+d.b_count || 0) : (rb.count || 0);
    const comment_count = rc.error ? (+d.comment_count || 0) : (rc.count || 0);
    return mapDebate({ ...d, a_count, b_count, comment_count });
  },

  async ranking(n = 5) {
    const list = await this.topics();
    return [...list].sort((x, y) => voters(y) - voters(x)).slice(0, n);
  },

  async myLikes(debateId) {
    const set = new Set();
    if (!sb || !MY_UID) return set;
    const { data } = await sb.from('comment_likes')
      .select('comment_id, comments!inner(debate_id)')
      .eq('user_id', MY_UID).eq('comments.debate_id', debateId);
    (data || []).forEach(r => set.add(r.comment_id));
    return set;
  },

  async comments(debateId, side) {
    if (!sb) return [];
    let q = sb.from('comments').select('*, users(nickname), comment_likes(count)').eq('debate_id', debateId);
    if (side) q = q.eq('side', side.toUpperCase());
    const { data, error } = await q;
    if (error) { console.error('[toronhaja] 댓글 조회 실패:', error.message); return []; }
    const myLikes = await this.myLikes(debateId);
    return (data || []).map(c => mapComment(c, myLikes)).sort((a, b) => b.likes - a.likes);
  },

  /* 작성자별 에디션 댓글 수 (배지 획득 판정용) — userIds 한 번에 조회
     반환: { user_id: { wallsu: n, seshinsa: n } } */
  async editionCounts(userIds) {
    if (!sb || !userIds || !userIds.length) return {};
    let res = await sb.from('comments')
      .select('user_id, edition')
      .in('user_id', userIds)
      .not('edition', 'is', null);
    if (res.error) {
      // edition 컬럼 미존재(마이그레이션 전)면 빈 결과
      if (/edition|column|schema/i.test(res.error.message || '')) return {};
      console.warn('[toronhaja] editionCounts 실패:', res.error.message); return {};
    }
    const m = {};
    (res.data || []).forEach(r => {
      if (!r.edition || !r.user_id) return;
      (m[r.user_id] = m[r.user_id] || {});
      m[r.user_id][r.edition] = (m[r.user_id][r.edition] || 0) + 1;
    });
    return m;
  },

  async addComment({ topic_id, side, body, edition }) {
    if (!sb) return null;
    const uid = await ensureUser();
    if (!uid) return null;
    const base = { debate_id: topic_id, user_id: uid, side: side.toUpperCase(), content: body };
    let res = await sb.from('comments')
      .insert(edition ? { ...base, edition } : base)
      .select('*, users(nickname)').single();
    // edition 컬럼 미존재 시(마이그레이션 전) 컬럼 빼고 재시도 — category 패턴과 동일
    if (res.error && edition && /edition|column|schema/i.test(res.error.message)) {
      res = await sb.from('comments').insert(base).select('*, users(nickname)').single();
    }
    const { data, error } = res;
    if (error || !data) { console.error('[toronhaja] 댓글 작성 실패:', error && error.message); return null; }
    const row = mapComment(data, new Set());
    if (!row.edition && edition) row.edition = edition;   // 폴백 시 로컬 표시용
    row.mine = true;
    return row;
  },

  async vote(topicId, side) {
    if (!sb) return { error: 'no client' };
    const uid = await ensureUser();
    if (!uid) return { error: 'no user' };
    const { error } = await sb.from('votes').upsert(
      { debate_id: topicId, user_id: uid, side: side.toUpperCase() },
      { onConflict: 'debate_id,user_id' });
    if (error) { console.error('[toronhaja] 투표 실패:', error.message); return { error: error.message }; }
    return { ok: true };
    // 캐시는 invalidate 하지 않는다 — patchVote 로 로컬 보정해 재요청을 막고, 20초 TTL 로 자연 갱신된다.
  },

  /* 로컬 캐시의 찬/반 수를 즉시 보정 — 서버 재요청 없이 피드/랭킹에 반영 */
  patchVote(topicId, prevSide, newSide) {
    if (prevSide === newSide || !_topicsCache) return;
    const t = _topicsCache.find(x => x.id === topicId);
    if (!t) return;
    if (prevSide === 'a') t.a_count = Math.max(0, t.a_count - 1);
    else if (prevSide === 'b') t.b_count = Math.max(0, t.b_count - 1);
    if (newSide === 'a') t.a_count++; else if (newSide === 'b') t.b_count++;
  },

  async like(commentId, on) {
    if (!sb) return;
    const uid = await ensureUser();
    if (!uid) return;
    if (on) { const { error } = await sb.from('comment_likes').insert({ comment_id: commentId, user_id: uid }); if (error && !/duplicate|unique|already exists|23505/i.test(error.message)) console.error('[toronhaja] 좋아요 실패:', error.message); }
    else { const { error } = await sb.from('comment_likes').delete().eq('comment_id', commentId).eq('user_id', uid); if (error) console.error('[toronhaja] 좋아요 취소 실패:', error.message); }
  },

  /* 신고 접수 — reports_v2.sql 의 정의자 RPC 로 처리.
     RPC 가 RLS 를 우회하고 중복방지·집계·자동블라인드까지 한 번에 처리한다.
     반환: { ok, status:'received'|'already'|'blinded'|'gone', count, threshold, blinded } */
  async report(commentId, reason) {
    if (!sb) return { ok: false, error: 'no client' };
    const uid = await ensureUser();
    if (!uid) return { ok: false, error: 'no user' };
    const { data, error } = await sb.rpc('thj_report_comment', { cid: commentId, reporter: uid, reason });
    if (!error) {
      const r = data || {};
      return { ok: true, status: r.status || 'received', count: r.count || 0, threshold: r.threshold || 0, blinded: !!r.blinded };
    }
    if (!rpcMissing(error)) { console.error('[toronhaja] 신고 실패:', error.message); return { ok: false, error: error.message }; }
    // 폴백 (reports_v2.sql 미실행): 직접 insert — 중복/자동블라인드는 미적용
    const ins = await sb.from('reports').insert({ comment_id: commentId, reporter_id: uid, reason });
    if (ins.error && !/duplicate|unique|23505/i.test(ins.error.message)) {
      console.error('[toronhaja] 신고 실패 (reports_v2.sql 실행 권장):', ins.error.message);
      return { ok: false, error: ins.error.message };
    }
    return { ok: true, status: /duplicate|unique|23505/i.test((ins.error || {}).message || '') ? 'already' : 'received', count: 0, threshold: 0, blinded: false };
  },

  /* 관리자 비밀번호 서버 검증 (security.sql 의 thj_is_admin).
     { ok } | { missing:true } | { ok:false, error } 반환.
     admin.html 게이트가 이걸 우선 호출 → 미설치 시에만 로컬 해시로 폴백. */
  async checkAdmin(pass) {
    if (!sb) return { missing: true };
    const { data, error } = await sb.rpc('thj_is_admin', { pass });
    if (error) { if (rpcMissing(error)) return { missing: true }; return { ok: false, error: error.message }; }
    return { ok: data === true };
  },

  async reports() {
    if (!sb) return [];
    // 게이트 RPC 우선(security.sql) — 신고자 신원이 anon 으로 안 새도록
    const g = await adminRPC('thj_admin_reports', {});
    if (!g.missing) {
      if (g.error) { console.error('[toronhaja] reports 조회 실패:', g.error.message); return []; }
      return (g.data || []).map(r => ({
        id: r.comment_id, commentId: r.comment_id, targetUserId: r.target_user_id || null,
        reason: r.reasons || '기타', reportCount: r.report_count || 0, status: r.is_blinded ? 'done' : 'new',
        blinded: !!r.is_blinded,
        created_at: r.last_at,
        created_label: r.last_at ? (typeof relTime === 'function' ? relTime(r.last_at) : '') : '',
        comments: { nickname: r.target_nick || '삭제됨', side: String(r.side || 'B').toLowerCase(), content: r.content || '' },
        topics: { title: r.debate_title || '—' },
      }));
    }
    // 폴백 (security.sql 미실행): 열린 reports_select 정책으로 직접 조회
    const { data, error } = await sb.from('reports')
      .select('*, comments(content, side, user_id, is_blinded, users(nickname), debates(title)), reporter:users!reports_reporter_id_fkey(nickname)')
      .order('created_at', { ascending: false });
    if (error) { console.error('[toronhaja] reports 조회 실패 (reports_select 정책 필요):', error.message); return []; }
    return (data || []).map(mapReport);
  },

  async addTopic({ category, title, description }) {
    if (!sb) return null;
    const uid = await ensureUser();
    const base = { title, description, side_a_label: '찬성', side_b_label: '반대' };
    if (uid) base.created_by = uid;
    invalidateTopics();
    let res = await sb.from('debates').insert({ ...base, category }).select().single();
    if (res.error && /category/i.test(res.error.message)) {
      // debates 테이블에 category 컬럼이 없으면 제외하고 재시도
      res = await sb.from('debates').insert(base).select().single();
    }
    if (res.error || !res.data) {
      console.error('[toronhaja] 토론 생성 실패:', res.error && res.error.message);
      return { error: (res.error && res.error.message) || '알 수 없는 오류' };
    }
    return mapDebate({ ...res.data, a_count: 0, b_count: 0, comment_count: 0 });
  },

  /* ── 공지(announcements) — 서버 저장, 사이트 배너 표시 ── */
  async latestAnnouncement() {
    if (!sb) return null;
    const { data, error } = await sb.from('announcements')
      .select('*').eq('is_active', true).order('created_at', { ascending: false }).limit(1);
    if (error) { console.warn('[toronhaja] 공지 조회 실패 (announcements 테이블 필요):', error.message); return null; }
    return (data && data[0]) || null;
  },
  async announcements() {
    if (!sb) return [];
    const { data, error } = await sb.from('announcements').select('*').order('created_at', { ascending: false });
    if (error) { console.warn('[toronhaja] 공지 목록 실패:', error.message); return []; }
    return data || [];
  },
  async addAnnouncement(body) {
    if (!sb) return { error: 'no client' };
    const g = await adminRPC('thj_admin_add_announcement', { body });
    if (!g.missing) {
      if (g.error) { console.error('[toronhaja] 공지 등록 실패:', g.error.message); return { error: g.error.message }; }
      return g.data;
    }
    const { data, error } = await sb.from('announcements').insert({ body, is_active: true }).select().single();
    if (error) { console.error('[toronhaja] 공지 등록 실패 (announcements 테이블 필요):', error.message); return { error: error.message }; }
    return data;
  },
  async setAnnouncementActive(id, on) {
    if (!sb) return;
    const g = await adminRPC('thj_admin_set_announcement', { aid: id, on_state: on });
    if (!g.missing) { if (g.error) console.error('[toronhaja] 공지 상태 변경 실패:', g.error.message); return; }
    const { error } = await sb.from('announcements').update({ is_active: on }).eq('id', id);
    if (error) console.error('[toronhaja] 공지 상태 변경 실패:', error.message);
  },

  /* ── 모더레이션 (서버 반영) ── */
  async blindComment(commentId) {
    if (!sb) return { error: 'no client' };
    // 게이트 RPC 우선(security.sql) → 미설치 시 열린 정책으로 폴백
    const g = await adminRPC('thj_admin_blind_comment', { cid: commentId, on_state: true });
    if (!g.missing) {
      if (g.error) { console.error('[toronhaja] 블라인드 실패:', g.error.message); return { error: g.error.message }; }
      return { ok: true };
    }
    const { error } = await sb.from('comments').update({ is_blinded: true }).eq('id', commentId);
    if (error) { console.error('[toronhaja] 블라인드 실패 (security.sql 또는 comments_update 정책 필요):', error.message); return { error: error.message }; }
    return { ok: true };
  },
  /* 유저 제재 — until(ms 또는 ISO) 지정 시 기간제 정지, 미지정/null 이면 영구.
     서버함수(thj_ban_user) 우선 → 없으면 직접 update 폴백(banned_until 컬럼 없으면 제외 재시도). */
  async banUser(userId, reason, until) {
    if (!sb || !userId) return { error: 'no user' };
    const untilIso = until ? new Date(until).toISOString() : null;
    // 게이트 RPC 우선(security.sql) — 비번 서버 검증
    const g = await adminRPC('thj_admin_ban_user', { uid: userId, reason: reason || '관리자 제재', until: untilIso });
    if (!g.missing) {
      if (g.error) { console.error('[toronhaja] 제재 실패:', g.error.message); return { error: g.error.message }; }
      return { ok: true };
    }
    // 폴백(security.sql 미설치): 기존 ungated RPC → 직접 update
    const rpc = await sb.rpc('thj_ban_user', { uid: userId, reason: reason || '관리자 제재', until: untilIso });
    if (!rpc.error) return { ok: true };
    let res = await sb.from('users').update({ is_banned: true, ban_reason: reason || '관리자 제재', banned_until: untilIso }).eq('id', userId);
    if (res.error && /banned_until|column|schema/i.test(res.error.message)) {
      res = await sb.from('users').update({ is_banned: true, ban_reason: reason || '관리자 제재' }).eq('id', userId);
    }
    if (res.error) { console.error('[toronhaja] 제재 실패 (users_admin_update 정책 필요):', res.error.message); return { error: res.error.message }; }
    return { ok: true };
  },

  /* 제재 해제 */
  async unbanUser(userId) {
    if (!sb || !userId) return { error: 'no user' };
    const g = await adminRPC('thj_admin_unban_user', { uid: userId });
    if (!g.missing) {
      if (g.error) { console.error('[toronhaja] 제재 해제 실패:', g.error.message); return { error: g.error.message }; }
      return { ok: true };
    }
    const rpc = await sb.rpc('thj_unban_user', { uid: userId });
    if (!rpc.error) return { ok: true };
    let res = await sb.from('users').update({ is_banned: false, banned_until: null }).eq('id', userId);
    if (res.error && /banned_until|column|schema/i.test(res.error.message)) {
      res = await sb.from('users').update({ is_banned: false }).eq('id', userId);
    }
    if (res.error) { console.error('[toronhaja] 제재 해제 실패:', res.error.message); return { error: res.error.message }; }
    return { ok: true };
  },

  /* 내 프로필 통계 — 받은 공감 수 + 내 댓글 수 (마이 탭에서만 호출) */
  async myProfileStats() {
    if (!sb || !MY_UID) return { comments: 0, likes: 0 };
    const { data: mine } = await sb.from('comments').select('id').eq('user_id', MY_UID);
    const ids = (mine || []).map(c => c.id);
    let likes = 0;
    if (ids.length) {
      const { count } = await sb.from('comment_likes').select('id', { count: 'exact', head: true }).in('comment_id', ids);
      likes = count || 0;
    }
    return { comments: ids.length, likes };
  },

  /* 내 계정 차단 상태 */
  async myBanStatus() {
    if (!sb || !MY_UID) return { banned: false };
    let { data, error } = await sb.from('users').select('is_banned, ban_reason, banned_until').eq('id', MY_UID).single();
    if (error && /banned_until|column|schema/i.test(error.message)) {
      ({ data } = await sb.from('users').select('is_banned, ban_reason').eq('id', MY_UID).single());
    }
    if (!data || !data.is_banned) return { banned: false };
    // 기간제 정지가 만료됐으면 자동 해제하고 통과
    if (data.banned_until && new Date(data.banned_until) <= new Date()) {
      sb.rpc('thj_unban_user', { uid: MY_UID }).then(() => {}, () => {});
      return { banned: false };
    }
    return { banned: true, reason: data.ban_reason || '이용 약관 위반', until: data.banned_until || null };
  },

  /* 토론 마감/재개 · 삭제 (관리자) */
  async setDebateClosed(id, closed) {
    if (!sb) return { error: 'no client' };
    invalidateTopics();
    const g = await adminRPC('thj_admin_set_debate_status', { did: id, closed: !!closed });
    if (!g.missing) {
      if (g.error) { console.error('[toronhaja] 토론 상태 변경 실패:', g.error.message); return { error: g.error.message }; }
      return { ok: true };
    }
    const { error } = await sb.from('debates').update({ status: closed ? 'closed' : 'active' }).eq('id', id);
    if (error) { console.error('[toronhaja] 토론 상태 변경 실패 (debates_update 정책 필요):', error.message); return { error: error.message }; }
    return { ok: true };
  },
  async deleteDebate(id) {
    if (!sb) return { error: 'no client' };
    invalidateTopics();
    // 1) 게이트 RPC 우선(security.sql) — 비번 검증 후 자식까지 삭제
    const g = await adminRPC('thj_admin_delete_debate', { did: id });
    if (!g.missing) {
      if (g.error) { console.error('[toronhaja] 토론 삭제 실패:', g.error.message); return { error: g.error.message }; }
      return { ok: true };
    }
    // 2) 폴백 — 기존 ungated 서버함수
    const rpc = await sb.rpc('thj_delete_debate', { did: id });
    if (!rpc.error) return { ok: true };
    // 3) 폴백 — 외래키 순서대로 자식부터 직접 삭제 (delete 정책이 있을 때 동작)
    const { data: cs } = await sb.from('comments').select('id').eq('debate_id', id);
    const cids = (cs || []).map(c => c.id);
    if (cids.length) {
      await sb.from('reports').delete().in('comment_id', cids);
      await sb.from('comment_likes').delete().in('comment_id', cids);
    }
    await sb.from('comments').delete().eq('debate_id', id);
    await sb.from('votes').delete().eq('debate_id', id);
    const { error } = await sb.from('debates').delete().eq('id', id);
    if (error) { console.error('[toronhaja] 토론 삭제 실패 (admin-actions.sql 의 thj_delete_debate 또는 delete 정책 필요):', error.message); return { error: error.message }; }
    return { ok: true };
  },

  /* ── 관리자 KPI (서버 집계) ──
     reports_v2.sql 의 thj_admin_stats RPC 우선(RLS 우회·정확).
     미설치 시 기존 직접 count 로 폴백. */
  async adminStats() {
    if (!sb) return { topics: 0, reports: 0, comments: 0, banned: 0 };
    const g = await adminRPC('thj_admin_stats', {});
    if (!g.missing && !g.error && g.data) {
      const d = g.data;
      return { topics: +d.topics || 0, reports: +d.reports || 0, comments: +d.comments || 0, banned: +d.banned || 0 };
    }
    const [tp, rp, cm, bn] = await Promise.all([
      sb.from('debates').select('id', { count: 'exact', head: true }).neq('status', 'closed'),
      sb.from('reports').select('id', { count: 'exact', head: true }),
      sb.from('comments').select('id', { count: 'exact', head: true }),
      sb.from('users').select('id', { count: 'exact', head: true }).eq('is_banned', true),
    ]);
    return { topics: tp.count || 0, reports: rp.count || 0, comments: cm.count || 0, banned: bn.count || 0 };
  },

  /* ── 사용자/활동 통계 (analytics.sql RPC — 관리자만 호출) ──
     일반 방문자는 호출하지 않아 DAU 가 늘어도 트래픽이 안 늘고,
     서버에서 숫자만 돌려줘 행 전송이 없으며, 새 행도 쌓지 않는다. */
  async userStats() {
    if (!sb) return null;
    const { data, error } = await sb.rpc('thj_user_stats');
    if (!error) return data;
    /* RPC 없음(analytics.sql 미실행) → head-count 폴백 (숫자만, 행 미전송).
       distinct 활동 사용자는 RPC 없이는 못 구하므로 '오늘 댓글/투표 수'로 대체 표시. */
    console.warn('[toronhaja] thj_user_stats 없음 → 추정 모드:', error.message);
    const kstMidnight = () => {
      const now = new Date();
      const kst = new Date(now.getTime() + 9 * 3600000);
      kst.setUTCHours(0, 0, 0, 0);
      return new Date(kst.getTime() - 9 * 3600000).toISOString();
    };
    const d0 = kstMidnight();
    const w0 = new Date(Date.now() - 7 * 86400000).toISOString();
    const cnt = async (t, mod) => {
      let q = sb.from(t).select('id', { count: 'exact', head: true });
      if (mod) q = mod(q);
      const r = await q; return r.error ? null : (r.count || 0);
    };
    const [total, banned, newToday, cToday, cWeek, vToday] = await Promise.all([
      cnt('users'),
      cnt('users', q => q.eq('is_banned', true)),
      cnt('users', q => q.gte('created_at', d0)),
      cnt('comments', q => q.gte('created_at', d0)),
      cnt('comments', q => q.gte('created_at', w0)),
      cnt('votes', q => q.gte('created_at', d0)),
    ]);
    return {
      total_users: total, banned_users: banned, new_today: newToday,
      active_today: null, active_week: null,
      comments_today: cToday, comments_week: cWeek, votes_today: vToday,
      estimated: true,
    };
  },

  /* 단일 댓글 삭제 (관리자 조치) — analytics.sql RPC 우선, 없으면 직접 삭제 */
  async deleteComment(commentId) {
    if (!sb || !commentId) return { error: 'no client' };
    const g = await adminRPC('thj_admin_delete_comment', { cid: commentId });
    if (!g.missing) {
      if (g.error) { console.error('[toronhaja] 댓글 삭제 실패:', g.error.message); return { error: g.error.message }; }
      return { ok: true };
    }
    const rpc = await sb.rpc('thj_delete_comment', { cid: commentId });
    if (!rpc.error) return { ok: true };
    /* RPC 미설치 → 자식부터 직접 삭제 */
    await sb.from('reports').delete().eq('comment_id', commentId);
    await sb.from('comment_likes').delete().eq('comment_id', commentId);
    const { error } = await sb.from('comments').delete().eq('id', commentId);
    if (error) { console.error('[toronhaja] 댓글 삭제 실패 (comments_delete 정책 필요):', error.message); return { error: error.message }; }
    return { ok: true };
  },

  /* ── 데이터 정리 (서버 RPC — cleanup.sql 필요) ──
     모든 삭제를 서버 함수 한 번으로 처리 → 행을 내려받지 않아 전송량 0,
     Free plan 500MB 안에서 오래된 데이터를 비워 용량을 확보한다. */
  async storageStats() {
    if (!sb) return null;
    const { data, error } = await sb.rpc('thj_db_stats');
    if (!error) return data;
    /* RPC 없음(cleanup.sql 미실행) → head-count 폴백.
       행 수만 세고(전송량 0) 용량은 행 크기로 추정한다. */
    console.warn('[toronhaja] thj_db_stats 없음 → 추정 모드:', error.message);
    const cnt = async (t, mod) => {
      let q = sb.from(t).select('id', { count: 'exact', head: true });
      if (mod) q = mod(q);
      const r = await q;
      return r.error ? 0 : (r.count || 0);
    };
    try {
      const nowIso = new Date().toISOString();
      const [debates, closed, comments, votes, users, reports] = await Promise.all([
        cnt('debates'),
        cnt('debates', q => q.or('status.eq.closed,ends_at.lt.' + nowIso)),
        cnt('comments'), cnt('votes'), cnt('users'), cnt('reports'),
      ]);
      const bytes_comments = comments * 620;   // 행+인덱스 평균 추정치
      const bytes_votes = votes * 180;
      return {
        debates, debates_closed: closed, comments, votes, users, reports,
        orphan_users: 0,
        bytes_total: bytes_comments + bytes_votes + debates * 500 + users * 160 + reports * 260,
        bytes_comments, bytes_votes,
        estimated: true,
      };
    } catch (e) { return { error: error.message }; }
  },
  async purgeOldDebates(days) {
    if (!sb) return { error: 'no client' };
    invalidateTopics();
    const g = await adminRPC('thj_admin_purge_old_debates', { days });
    if (!g.missing) {
      if (g.error) { console.error('[toronhaja] 토론 정리 실패:', g.error.message); return { error: g.error.message }; }
      return { ok: true, count: g.data || 0 };
    }
    const { data, error } = await sb.rpc('thj_purge_old_debates', { days });
    if (error) { console.error('[toronhaja] 토론 정리 실패:', error.message); return { error: error.message }; }
    return { ok: true, count: data || 0 };
  },
  async purgeOldReports(days) {
    if (!sb) return { error: 'no client' };
    const g = await adminRPC('thj_admin_purge_old_reports', { days });
    if (!g.missing) {
      if (g.error) { console.error('[toronhaja] 신고 정리 실패:', g.error.message); return { error: g.error.message }; }
      return { ok: true, count: g.data || 0 };
    }
    const { data, error } = await sb.rpc('thj_purge_old_reports', { days });
    if (error) { console.error('[toronhaja] 신고 정리 실패:', error.message); return { error: error.message }; }
    return { ok: true, count: data || 0 };
  },
  async purgeOrphanUsers() {
    if (!sb) return { error: 'no client' };
    const g = await adminRPC('thj_admin_purge_orphan_users', {});
    if (!g.missing) {
      if (g.error) { console.error('[toronhaja] 유저 정리 실패:', g.error.message); return { error: g.error.message }; }
      return { ok: true, count: g.data || 0 };
    }
    const { data, error } = await sb.rpc('thj_purge_orphan_users');
    if (error) { console.error('[toronhaja] 유저 정리 실패:', error.message); return { error: error.message }; }
    return { ok: true, count: data || 0 };
  },

  /* ── 익스트림 모드 (extreme.sql 필요) ──
     마감 토론의 원본 투표·좋아요 행을 즉시 제거 (찬/반 집계는 컬럼에 보존됨) */
  async stripClosedDebates() {
    if (!sb) return { error: 'no client' };
    const g = await adminRPC('thj_admin_strip_closed', {});
    if (!g.missing) {
      if (g.error) { console.error('[toronhaja] 스트립 실패:', g.error.message); return { error: g.error.message }; }
      return { ok: true, count: g.data || 0 };
    }
    const { data, error } = await sb.rpc('thj_strip_closed_debates');
    if (error) { console.error('[toronhaja] 스트립 실패 (extreme.sql 필요):', error.message); return { error: error.message }; }
    return { ok: true, count: data || 0 };
  },
  /* 전체 수명주기 정리를 지금 즉시 1회 실행 (cron 이 매일 하는 일과 동일) */
  async runAutoCleanup() {
    if (!sb) return { error: 'no client' };
    const g = await adminRPC('thj_admin_auto_cleanup', {});
    if (!g.missing) {
      if (g.error) { console.error('[toronhaja] 자동정리 실행 실패:', g.error.message); return { error: g.error.message }; }
      return { ok: true, summary: g.data };
    }
    const { data, error } = await sb.rpc('thj_auto_cleanup');
    if (error) { console.error('[toronhaja] 자동정리 실행 실패 (extreme.sql 필요):', error.message); return { error: error.message }; }
    return { ok: true, summary: data };
  },

  /* ── 실시간 통계 (서버 쿼리) ── */
  async commentsPerMinute() {
    if (!sb) return 0;
    const since = new Date(Date.now() - 60000).toISOString();
    const { count, error } = await sb.from('comments').select('id', { count: 'exact', head: true }).gte('created_at', since);
    if (error) return 0;
    return count || 0;
  },
  async activeDebateCount() {
    if (!sb) return 0;
    const { count, error } = await sb.from('debates').select('id', { count: 'exact', head: true }).neq('status', 'closed');
    if (error) { const { count: c2 } = await sb.from('debates').select('id', { count: 'exact', head: true }); return c2 || 0; }
    return count || 0;
  },

  /* ── 실시간 접속자 수 (60초 하트비트) ──
     presence.sql 설치 시: 60초마다 thj_presence_ping 을 1회 호출 →
       서버가 하트비트를 수신·저장하고(60초에 1번) 현재 인원수를 돌려준다(60초에 1번 갱신).
     presence.sql 미설치 시: 예전 Realtime Presence(웹소켓)로 자동 폴백. */
  presence(scope, onCount) {
    if (!sb) return null;
    const KEY = presenceKey();
    let stopped = false, timer = null, rtimer = null, channel = null, fellBack = false;

    // 폴백: 예전 Realtime Presence — 채널에 track 한 클라이언트 수를 집계
    const startRealtime = () => {
      const ch = sb.channel('presence:' + scope, { config: { presence: { key: KEY } } });
      const recount = () => onCount(Math.max(Object.keys(ch.presenceState()).length, 1));
      ch.on('presence', { event: 'sync' }, recount)
        .on('presence', { event: 'join' }, recount)
        .on('presence', { event: 'leave' }, recount)
        .subscribe(async (s) => { if (s === 'SUBSCRIBED') await ch.track({ at: Date.now() }); });
      return ch;
    };

    // 하트비트(쓰기): 60초마다 서버에 내 접속을 저장 + 현재 인원수 수신
    const beat = async () => {
      if (stopped || fellBack) return;
      if (document.hidden) return;   // 숨겨진 탭은 서버 요청 생략(트래픽 절감)
      const { data, error } = await sb.rpc('thj_presence_ping', { p_scope: scope, p_key: KEY });
      if (error) {
        if (rpcMissing(error)) { fellBack = true; channel = startRealtime(); }  // presence.sql 미설치 → 폴백
        else console.warn('[toronhaja] presence ping 실패:', error.message);
        return;
      }
      onCount(Math.max(+data || 1, 1));
    };

    // 화면 갱신(읽기 전용): 20초마다 현재 인원수만 다시 읽어 숫자를 살아있게.
    //   쓰기는 60초 그대로(트래픽 절감) → 다른 사람이 들어오면 ~20초 안에 카운터가 따라 움직인다.
    const refresh = async () => {
      if (stopped || fellBack || document.hidden) return;
      const { data, error } = await sb.rpc('thj_presence_count', { p_scope: scope });
      if (error) { if (rpcMissing(error)) { fellBack = true; channel = startRealtime(); } return; }
      if (data != null) onCount(Math.max(+data || 1, 1));
    };

    beat();                                  // 즉시 1회(쓰기+읽기)
    timer  = setInterval(beat, 60000);       // 하트비트 60초
    rtimer = setInterval(refresh, 20000);    // 표시 갱신 20초
    const onVis = () => { if (!document.hidden) beat(); };   // 탭 복귀 시 즉시 갱신
    document.addEventListener('visibilitychange', onVis);

    return {
      _thjPresence: true,
      stop() {
        if (stopped) return;
        stopped = true;
        if (timer) clearInterval(timer);
        if (rtimer) clearInterval(rtimer);
        document.removeEventListener('visibilitychange', onVis);
        if (channel) sb.removeChannel(channel);
        else sb.rpc('thj_presence_leave', { p_scope: scope, p_key: KEY }).then(() => {}, () => {});
      },
    };
  },

  /* ── Realtime 변경 구독 (댓글/투표) ──
     supabase_realtime publication 에 테이블이 추가돼 있어야 push 됨. */
  subscribeComments(debateId, onInsert) {
    if (!sb) return null;
    return sb.channel('rt-c-' + debateId)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'comments', filter: 'debate_id=eq.' + debateId },
        async ({ new: row }) => {
          let nick = '익명';
          // 닉네임 캐시 — 같은 사람이 연속 댓글을 달아도 users 조회를 반복하지 않는다(N+1 방지).
          if (row.user_id) {
            if (_nickCache.has(row.user_id)) nick = _nickCache.get(row.user_id);
            else {
              const { data } = await sb.from('users').select('nickname').eq('id', row.user_id).single();
              if (data) { nick = data.nickname; _nickCache.set(row.user_id, nick); }
            }
          }
          onInsert({ id: row.id, side: String(row.side).toLowerCase(), nickname: nick, uid: row.user_id || null, emoji: emojiFor(row.user_id || nick), tag: tagOf(row.user_id || nick), body: row.content, likes: 0, created_at: '방금 전', mine: row.user_id === MY_UID });
        })
      .subscribe();
  },
  subscribeVotes(debateId, onChange) {
    if (!sb) return null;
    return sb.channel('rt-v-' + debateId)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'votes', filter: 'debate_id=eq.' + debateId }, () => onChange())
      .subscribe();
  },
  unsubscribe(ch) {
    if (!ch) return;
    if (ch._thjPresence) { ch.stop(); return; }   // 60초 하트비트 핸들
    if (sb) sb.removeChannel(ch);
  },

  /* ── 알림(notifications) ──────────────────────────
     · 개인 알림(좋아요/답글) = notifications 테이블 (내 user_id 대상)
     · 공지 broadcast = announcements (행 추가 없이 패널에 함께 표시, 읽음은 localStorage)
     notifications.sql 미실행이어도 공지만으로 동작(개인 알림은 0). */
  async notifications(limit = 30) {
    if (!sb) return [];
    const out = [];
    if (MY_UID) {
      const { data } = await sb.from('notifications')
        .select('*').eq('user_id', MY_UID)
        .order('created_at', { ascending: false }).limit(limit);
      (data || []).forEach(n => out.push({
        id: n.id, kind: n.type, title: n.title, body: n.body,
        debateId: n.debate_id || null, actor: n.actor_nick || null,
        created_at: n.created_at, read: !!n.is_read, personal: true,
      }));
    }
    const seen = +localStorage.getItem('thj_notif_seen') || 0;
    const { data: anns } = await sb.from('announcements')
      .select('*').eq('is_active', true)
      .order('created_at', { ascending: false }).limit(10);
    (anns || []).forEach(a => out.push({
      id: 'ann_' + a.id, kind: 'announce', title: '공지사항', body: a.body,
      debateId: null, actor: null, created_at: a.created_at,
      read: new Date(a.created_at).getTime() <= seen, personal: false,
    }));
    out.sort((x, y) => new Date(y.created_at) - new Date(x.created_at));
    return out.slice(0, limit);
  },
  async unreadCount() {
    if (!sb) return 0;
    let n = 0;
    if (MY_UID) {
      const { count } = await sb.from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', MY_UID).eq('is_read', false);
      n += count || 0;
    }
    const seen = +localStorage.getItem('thj_notif_seen') || 0;
    const { data } = await sb.from('announcements')
      .select('created_at').eq('is_active', true)
      .order('created_at', { ascending: false }).limit(10);
    (data || []).forEach(a => { if (new Date(a.created_at).getTime() > seen) n++; });
    return n;
  },
  async markAllRead() {
    localStorage.setItem('thj_notif_seen', String(Date.now()));
    if (!sb || !MY_UID) return;
    await sb.from('notifications').update({ is_read: true })
      .eq('user_id', MY_UID).eq('is_read', false);
  },
  subscribeNotifications(onChange) {
    if (!sb) return null;
    const ch = sb.channel('rt-notify-' + (MY_UID || 'anon'));
    if (MY_UID) {
      ch.on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications', filter: 'user_id=eq.' + MY_UID },
        ({ new: row }) => onChange({ id: row.id, kind: row.type, title: row.title, body: row.body, debateId: row.debate_id || null, created_at: row.created_at }));
    }
    ch.on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'announcements' },
      ({ new: row }) => { if (row.is_active) onChange({ id: 'ann_' + row.id, kind: 'announce', title: '공지사항', body: row.body, created_at: row.created_at }); });
    ch.subscribe();
    return ch;
  },
};

DB.setAdminPass = setAdminPass;
window.DB = DB;
