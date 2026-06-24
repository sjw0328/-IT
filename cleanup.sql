-- ════════════════════════════════════════════════════════════
--  toronhaja — 데이터 정리(Storage Cleanup) 서버 함수
--  Supabase → SQL Editor 에 붙여넣고 Run. 재실행 안전.
--
--  ▸ Free plan 은 DB 용량이 500MB. 토론이 끝나도 votes/comments 가
--    계속 쌓이면 한도를 넘깁니다. 관리자 페이지의 "데이터 관리" 탭이
--    아래 함수들을 호출해 오래된 데이터를 서버에서 한 번에 정리합니다.
--    (행을 브라우저로 내려받지 않으므로 전송량도 들지 않습니다.)
--
--  ⚠ 보안: 데모 편의를 위해 anon 키로 실행됩니다. 관리자 페이지는
--    비밀번호로 보호되지만, 실서비스에서는 service_role / 서버함수로
--    좁히세요. (announcements.sql 의 안내와 동일)
-- ════════════════════════════════════════════════════════════

-- 1) 용량/행 수 통계 ──────────────────────────────────────────
create or replace function thj_db_stats()
returns json language sql security definer set search_path = public as $$
  select json_build_object(
    'debates',        (select count(*) from debates),
    'debates_closed', (select count(*) from debates where status = 'closed' or (ends_at is not null and ends_at < now())),
    'comments',       (select count(*) from comments),
    'votes',          (select count(*) from votes),
    'users',          (select count(*) from users),
    'reports',        (select count(*) from reports),
    'orphan_users',   (select count(*) from users u
                         where not exists (select 1 from votes v where v.user_id = u.id)
                           and not exists (select 1 from comments c where c.user_id = u.id)),
    'bytes_total',    (select coalesce(sum(pg_total_relation_size(c.oid)),0)
                         from pg_class c join pg_namespace n on n.oid = c.relnamespace
                         where n.nspname = 'public' and c.relkind = 'r'
                           and c.relname in ('debates','comments','votes','users','reports','comment_likes','announcements')),
    'bytes_comments', (select pg_total_relation_size('comments')),
    'bytes_votes',    (select pg_total_relation_size('votes'))
  );
$$;

-- 2) 종료된 오래된 토론 일괄 삭제 (자식 데이터까지) ────────────
--    대상: 마감되었거나 종료시각이 지난 토론 중, days 일 이상 지난 것
create or replace function thj_purge_old_debates(days integer default 30)
returns integer language plpgsql security definer set search_path = public as $$
declare
  cutoff timestamptz := now() - (days || ' days')::interval;
  ids uuid[];
  n integer;
begin
  select array_agg(id) into ids from debates d
   where (d.status = 'closed' or (d.ends_at is not null and d.ends_at < now()))
     and coalesce(d.ends_at, d.created_at) < cutoff;

  if ids is null then return 0; end if;

  -- 외래키 순서대로 자식부터 정리 (CASCADE 미설정 대비)
  delete from reports       where comment_id in (select id from comments where debate_id = any(ids));
  delete from comment_likes where comment_id in (select id from comments where debate_id = any(ids));
  delete from comments       where debate_id = any(ids);
  delete from votes          where debate_id = any(ids);

  get diagnostics n = row_count;  -- (참고용)
  delete from debates        where id = any(ids);
  get diagnostics n = row_count;
  return n;
end;
$$;

-- 3) 오래된 신고 삭제 ─────────────────────────────────────────
create or replace function thj_purge_old_reports(days integer default 30)
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  delete from reports where created_at < now() - (days || ' days')::interval;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- 4) 활동 없는 익명 유저(고아 계정) 삭제 ──────────────────────
--    투표도 댓글도 없는 users 행 (제재 유저는 보존)
create or replace function thj_purge_orphan_users()
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  delete from users u
   where coalesce(u.is_banned, false) = false
     and not exists (select 1 from votes v where v.user_id = u.id)
     and not exists (select 1 from comments c where c.user_id = u.id);
  get diagnostics n = row_count;
  return n;
end;
$$;

-- 5) 실행 권한 (anon publishable 키) ──────────────────────────
grant execute on function thj_db_stats()                  to anon, authenticated;
grant execute on function thj_purge_old_debates(integer)  to anon, authenticated;
grant execute on function thj_purge_old_reports(integer)  to anon, authenticated;
grant execute on function thj_purge_orphan_users()        to anon, authenticated;
