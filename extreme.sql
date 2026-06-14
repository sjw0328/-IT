-- ════════════════════════════════════════════════════════════
--  toronhaja — 익스트림 디스크 절감 모드
--  Supabase → SQL Editor 에서 Run. 재실행 안전.
--  (먼저 optimize.sql, cleanup.sql 을 실행해 두세요)
--
--  ▸ 원리: 토론 데이터에 "수명주기"를 부여
--    진행중 → 원본(투표/댓글/좋아요) 전부 보관
--    마감 직후 → 투표·좋아요 원본 즉시 삭제 (찬/반 % 는 집계 컬럼에 영구 보존)
--    마감 +7일 → 댓글·신고 삭제 (토론 카드와 최종 결과만 남음)
--    마감 +30일 → 토론 행 자체 삭제
--    매일 새벽 → pg_cron 이 자동 실행 + 고아 계정 정리
--
--  ▸ 디스크의 대부분은 votes(행수↑)와 comments(텍스트)가 차지.
--    이 모드에선 "진행중인 토론" 분량만 디스크에 존재합니다.
-- ════════════════════════════════════════════════════════════

-- 0) 댓글 길이 제한 (300자) — 도배로 인한 용량 폭증 방지 ──────
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'comments_len_cap') then
    alter table comments add constraint comments_len_cap check (char_length(content) <= 300);
  end if;
exception when others then null;  -- 기존 행이 더 길면 제한 생략
end $$;

-- 1) 종료시각 지난 토론 자동 마감 ─────────────────────────────
create or replace function thj_close_ended()
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  update debates set status = 'closed'
   where status <> 'closed' and ends_at is not null and ends_at < now();
  get diagnostics n = row_count;
  return n;
end;
$$;

-- 2) 마감 토론의 투표·좋아요 원본 즉시 제거 ───────────────────
--    트리거가 집계를 깎지 않도록 session_replication_role 로 비활성화.
--    찬/반 % 는 debates.a_count / b_count 에 그대로 남습니다.
create or replace function thj_strip_closed_debates()
returns integer language plpgsql security definer set search_path = public as $$
declare ids uuid[]; n integer := 0; m integer;
begin
  select array_agg(id) into ids from debates where status = 'closed';
  if ids is null then return 0; end if;

  perform set_config('session_replication_role', 'replica', true);  -- 트리거 OFF (이 트랜잭션만)
  delete from comment_likes where comment_id in (select id from comments where debate_id = any(ids));
  get diagnostics m = row_count; n := n + m;
  delete from votes where debate_id = any(ids);
  get diagnostics m = row_count; n := n + m;
  perform set_config('session_replication_role', 'origin', true);   -- 트리거 ON
  return n;
end;
$$;

-- 3) 매일 1회 도는 전체 수명주기 정리 ─────────────────────────
create or replace function thj_auto_cleanup()
returns json language plpgsql security definer set search_path = public as $$
declare closed_n integer; stripped_n integer; comments_n integer; debates_n integer; users_n integer;
begin
  closed_n   := thj_close_ended();
  stripped_n := thj_strip_closed_debates();

  -- 마감 +7일: 댓글·신고 제거 (집계 보존 — 트리거 OFF)
  perform set_config('session_replication_role', 'replica', true);
  delete from reports where comment_id in (
    select c.id from comments c join debates d on d.id = c.debate_id
     where d.status = 'closed' and coalesce(d.ends_at, d.created_at) < now() - interval '7 days');
  delete from comments c using debates d
   where d.id = c.debate_id and d.status = 'closed'
     and coalesce(d.ends_at, d.created_at) < now() - interval '7 days';
  get diagnostics comments_n = row_count;
  perform set_config('session_replication_role', 'origin', true);

  -- 마감 +30일: 토론 행 자체 삭제
  debates_n := thj_purge_old_debates(30);
  -- 고아 계정 + 30일 지난 신고
  users_n := thj_purge_orphan_users();
  perform thj_purge_old_reports(30);

  return json_build_object('closed', closed_n, 'stripped', stripped_n,
                           'comments_deleted', comments_n, 'debates_deleted', debates_n,
                           'users_deleted', users_n);
end;
$$;

-- 4) 실행 권한 ────────────────────────────────────────────────
grant execute on function thj_close_ended()          to anon, authenticated;
grant execute on function thj_strip_closed_debates() to anon, authenticated;
grant execute on function thj_auto_cleanup()         to anon, authenticated;

-- 5) 매일 새벽 4시(UTC 19시) 자동 실행 — pg_cron ──────────────
--    (Database → Extensions 에서 pg_cron 이 켜져 있어야 합니다)
do $$ begin
  create extension if not exists pg_cron;
  perform cron.unschedule('thj-auto-cleanup')
    where exists (select 1 from cron.job where jobname = 'thj-auto-cleanup');
  perform cron.schedule('thj-auto-cleanup', '0 19 * * *', 'select thj_auto_cleanup()');
exception when others then
  raise notice 'pg_cron 미사용 — 관리자 탭의 [자동정리 지금 실행] 버튼으로 수동 실행하세요';
end $$;
