-- ════════════════════════════════════════════════════════════
--  toronhaja — 사용자/활동 통계 (analytics.sql)
--  Supabase → SQL Editor 에 붙여넣고 Run. 재실행 안전.
--
--  ▸ 왜 트래픽이 거의 안 느나
--    이 함수는 "관리자가 통계 화면을 열 때만" 1번 호출됩니다.
--    일반 방문자는 호출하지 않으므로 DAU 가 늘어도 비용이 안 늘어요.
--    또한 서버에서 숫자(JSON)만 돌려줘 행을 내려받지 않습니다(전송량 ~0),
--    방문 로그 같은 새 행도 쌓지 않습니다(저장량 0).
--
--  ▸ 지표 정의
--    누적 사용자   = users 행 수 (1기기 1계정)
--    오늘 신규     = 오늘(KST) 생성된 users
--    DAU(오늘 활동)= 오늘 댓글/투표를 한 서로 다른 user 수
--    WAU(7일 활동) = 최근 7일 댓글/투표를 한 서로 다른 user 수
-- ════════════════════════════════════════════════════════════

create or replace function thj_user_stats()
returns json language plpgsql security definer set search_path = public as $$
declare
  d0 timestamptz := (date_trunc('day', (now() at time zone 'Asia/Seoul'))) at time zone 'Asia/Seoul';
  w0 timestamptz := now() - interval '7 days';
  active_today integer := 0;
  active_week  integer := 0;
  votes_ts boolean;
  users_ts boolean;
begin
  -- votes / users 에 created_at 컬럼이 있는지 확인 (스키마 차이 방어)
  select exists(select 1 from information_schema.columns
    where table_schema='public' and table_name='votes' and column_name='created_at') into votes_ts;
  select exists(select 1 from information_schema.columns
    where table_schema='public' and table_name='users' and column_name='created_at') into users_ts;

  -- 활동 사용자(DAU/WAU): 댓글 + (가능하면)투표 작성자 distinct
  if votes_ts then
    select count(*) into active_today from (
      select user_id from comments where created_at >= d0
      union select user_id from votes where created_at >= d0) t;
    select count(*) into active_week from (
      select user_id from comments where created_at >= w0
      union select user_id from votes where created_at >= w0) t;
  else
    select count(distinct user_id) into active_today from comments where created_at >= d0;
    select count(distinct user_id) into active_week  from comments where created_at >= w0;
  end if;

  return json_build_object(
    'total_users',    (select count(*) from users),
    'banned_users',   (select count(*) from users where coalesce(is_banned, false)),
    'new_today',      case when users_ts then (select count(*) from users where created_at >= d0) else null end,
    'new_week',       case when users_ts then (select count(*) from users where created_at >= w0) else null end,
    'active_today',   active_today,
    'active_week',    active_week,
    'comments_today', (select count(*) from comments where created_at >= d0),
    'votes_today',    case when votes_ts then (select count(*) from votes where created_at >= d0) else null end,
    'votes_has_ts',   votes_ts
  );
end;
$$;

-- 단일 댓글 삭제 (자식 신고·좋아요까지 함께) — 관리자 조치용
create or replace function thj_delete_comment(cid uuid)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  delete from reports       where comment_id = cid;
  delete from comment_likes where comment_id = cid;
  delete from comments      where id = cid;
  return true;
end;
$$;

grant execute on function thj_user_stats()            to anon, authenticated;
grant execute on function thj_delete_comment(uuid)    to anon, authenticated;
