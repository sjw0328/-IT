-- ════════════════════════════════════════════════════════════
--  toronhaja — 신고 시스템 전면 재구축 (reports_v2.sql)  ★이 파일 하나만 실행하면 됩니다★
--  Supabase → SQL Editor 에 "전체" 붙여넣고 Run. 재실행해도 안전(idempotent).
--
--  기존 신고가 "작동 안 하던" 이유와 이 파일이 고치는 것:
--   1) 신고해도 아무 일도 안 일어남(자동 블라인드 없음) → ★신고 누적 시 자동 블라인드★
--   2) RLS INSERT 정책이 자꾸 막혀 신고 접수 자체가 실패 → ★정의자(SECURITY DEFINER)
--      RPC 로 접수해 RLS 를 우회★ (이제 정책 깨져도 신고는 들어감)
--   3) 같은 사람이 같은 댓글을 무한 신고 → ★(댓글,신고자) 유니크 → 1인 1신고★
--   4) 성공/실패 피드백 없음 → ★RPC 가 상태(JSON)를 돌려줌★ (접수/이미함/블라인드)
-- ════════════════════════════════════════════════════════════

-- 0) 의존 컬럼 보강 (없으면 추가) ─────────────────────────────
alter table reports  add column if not exists reason     text;
alter table reports  add column if not exists status     text default 'new';
alter table reports  add column if not exists created_at timestamptz default now();
alter table comments add column if not exists is_blinded boolean default false;
alter table comments add column if not exists report_count int default 0;

-- 1) 자동 블라인드 임계치 설정 (app_config 에 저장, 기본 3명) ───
--    security.sql 의 app_config 가 없으면 만들고, 있으면 그대로 사용.
create table if not exists app_config (key text primary key, value text not null);
insert into app_config (key, value) values ('report_blind_threshold', '3')
  on conflict (key) do nothing;

-- 2) 중복 신고 제거 후 (댓글,신고자) 유니크 인덱스 ─────────────
--    기존에 쌓인 중복은 가장 먼저 들어온 1건만 남기고 정리한다.
delete from reports a using reports b
 where a.comment_id = b.comment_id
   and a.reporter_id = b.reporter_id
   and a.reporter_id is not null
   and a.ctid > b.ctid;
create unique index if not exists reports_comment_reporter_uq
  on reports (comment_id, reporter_id) where reporter_id is not null;

-- 3) 기존 신고 수를 댓글에 동기화 (최초 1회 보정) ─────────────
update comments c
   set report_count = sub.n
  from (select comment_id, count(distinct reporter_id) n from reports group by comment_id) sub
 where sub.comment_id = c.id;

-- ════════════════════════════════════════════════════════════
--  4) 신고 접수 RPC (핵심) — 누구나 호출, 서버가 모든 걸 처리
--     · 1인 1신고(중복 무시)  · 신고수 집계  · 임계치 도달 시 자동 블라인드
--     · {status, count, threshold, blinded} JSON 반환
-- ════════════════════════════════════════════════════════════
create or replace function thj_report_comment(cid uuid, reporter uuid, reason text)
returns json language plpgsql security definer set search_path = public as $$
declare
  existed   boolean := false;
  cnt       int;
  thr       int;
  was_blind boolean;
  did_blind boolean := false;
begin
  if cid is null then
    raise exception '대상 댓글이 없습니다' using errcode = '22000';
  end if;
  if not exists (select 1 from comments where id = cid) then
    return json_build_object('status','gone','count',0,'blinded',false);
  end if;

  -- 이미 신고했는지 확인 (1인 1신고)
  if reporter is not null then
    select exists(select 1 from reports where comment_id = cid and reporter_id = reporter)
      into existed;
  end if;

  -- 접수 (중복이면 무시)
  insert into reports (comment_id, reporter_id, reason, status)
  values (cid, reporter, coalesce(nullif(btrim(reason), ''), '기타'), 'new')
  on conflict (comment_id, reporter_id) where reporter_id is not null do nothing;

  -- 신고자 수 집계 후 댓글에 반영
  select count(distinct reporter_id) into cnt from reports where comment_id = cid;
  update comments set report_count = cnt where id = cid;

  -- 임계치 도달 → 자동 블라인드
  select coalesce((select value::int from app_config where key = 'report_blind_threshold'), 3)
    into thr;
  select is_blinded into was_blind from comments where id = cid;
  if cnt >= thr and not coalesce(was_blind, false) then
    update comments set is_blinded = true where id = cid;
    did_blind := true;
  end if;

  return json_build_object(
    'status',    case when existed then 'already'
                      when did_blind then 'blinded'
                      else 'received' end,
    'count',     cnt,
    'threshold', thr,
    'blinded',   coalesce(was_blind, false) or did_blind
  );
end $$;

grant execute on function thj_report_comment(uuid, uuid, text) to anon, authenticated;

-- ════════════════════════════════════════════════════════════
--  5) 관리자 신고 목록 RPC — 댓글 단위로 묶어서(집계) 내려줌
--     같은 댓글에 신고가 여러 건이어도 한 줄(신고수·사유 모음·최근시각)로 표시.
--     (security.sql 의 thj_admin_reports 를 이 집계 버전으로 교체)
-- ════════════════════════════════════════════════════════════
create or replace function thj_admin_reports(pass text)
returns json language plpgsql security definer set search_path = public as $$
declare result json;
begin
  -- security.sql 이 설치돼 있으면 비밀번호를 검증, 아니면 통과(폴백 환경)
  if exists (select 1 from pg_proc where proname = 'thj_require_admin') then
    perform thj_require_admin(pass);
  end if;
  select coalesce(json_agg(t order by t.last_at desc), '[]'::json) into result from (
    select
      c.id            as comment_id,
      c.user_id       as target_user_id,
      c.side,
      c.content,
      c.is_blinded,
      coalesce(c.report_count, count(distinct r.reporter_id)) as report_count,
      count(r.id)     as report_total,
      cu.nickname     as target_nick,
      d.title         as debate_title,
      string_agg(distinct coalesce(r.reason, '기타'), ', ') as reasons,
      max(r.created_at) as last_at
    from reports r
    join comments c on c.id = r.comment_id
    left join users   cu on cu.id = c.user_id
    left join debates d  on d.id = c.debate_id
    group by c.id, c.user_id, c.side, c.content, c.is_blinded, c.report_count, cu.nickname, d.title
  ) t;
  return result;
end $$;

grant execute on function thj_admin_reports(text) to anon, authenticated;

-- ════════════════════════════════════════════════════════════
--  5b) 관리자 KPI 집계 RPC — 누적 신고·전체 댓글·제재중 유저·진행중 토론
--     클라이언트의 exact count 쿼리가 RLS/부하로 0(null) 으로 떨어지던 문제를
--     서버에서 한 번에(정의자 권한) 계산해 정확히 내려준다.
-- ════════════════════════════════════════════════════════════
create or replace function thj_admin_stats(pass text default null)
returns json language sql stable security definer set search_path = public as $$
  select json_build_object(
    'topics',   (select count(*) from debates  where status is distinct from 'closed'),
    'reports',  (select count(*) from reports),
    'comments', (select count(*) from comments),
    'banned',   (select count(*) from users    where is_banned = true)
  );
$$;
grant execute on function thj_admin_stats(text) to anon, authenticated;

-- ════════════════════════════════════════════════════════════
--  6) RLS — 신고 접수는 RPC 로 하므로 INSERT 정책이 깨져도 동작하지만,
--     예전 클라이언트(직접 insert 폴백)도 막히지 않도록 열어둔다.
-- ════════════════════════════════════════════════════════════
alter table reports enable row level security;
drop policy if exists "reports_insert" on reports;
create policy "reports_insert" on reports for insert with check (true);
grant insert on reports to anon, authenticated;

-- 7) 임계치 변경 방법 (예: 5명에서 블라인드)
--    update app_config set value = '5' where key = 'report_blind_threshold';

-- 8) 확인용 — 신고 많은 댓글 TOP (Results 탭)
select c.id, left(c.content, 40) as preview, c.report_count, c.is_blinded
  from comments c
 where c.report_count > 0
 order by c.report_count desc
 limit 20;
