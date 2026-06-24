-- ════════════════════════════════════════════════════════════
--  toronhaja — 접속자 수 (presence.sql) · 60초 하트비트 방식
--  Supabase → SQL Editor 에 붙여넣고 Run. 재실행 안전.
--
--  ▸ 무엇이 바뀌나
--    기존 "현재 접속중" 숫자는 Realtime Presence(웹소켓)로만 셌습니다.
--    이 파일을 실행하면 각 클라이언트가 60초마다 하트비트를 서버로 보내고
--    (= 서버가 60초에 한 번 수신·저장), 같은 호출로 현재 인원수를 돌려받습니다
--    (= 클라이언트가 60초에 한 번 갱신). presence.sql 미실행 시 앱은 자동으로
--    예전 Realtime Presence 로 폴백하므로 안 돌려도 동작합니다.
--
--  ▸ 동작
--    thj_presence_ping(scope, key) 1회 호출이 세 가지를 모두 처리:
--      1. 내 하트비트 upsert(수신·저장)  2. 오래된 행 정리  3. 현재 인원수 반환
--    scope = 'global'(사이트 전체) 또는 'debate:<id>'(특정 토론 시청자)
--
--  ▸ 용량/트래픽
--    테이블에는 "지금 접속중인 세션"만 남습니다(오래된 행 자동 삭제) →
--    동시 접속자 수에 비례하는 아주 작은 크기로 유지됩니다.
-- ════════════════════════════════════════════════════════════

-- 윈도/주기 상수
--   하트비트 주기 = 60초 / 활성 판정 윈도 = 135초(한 번 누락 허용) / 보관 = 600초
create table if not exists presence_pings (
  scope       text        not null,
  session_key text        not null,
  last_seen   timestamptz not null default now(),
  primary key (scope, session_key)
);

create index if not exists presence_pings_scope_seen
  on presence_pings (scope, last_seen);

alter table presence_pings enable row level security;
-- 정책을 일부러 두지 않습니다 → anon 직접 접근 불가, 아래 정의자 RPC 로만 기록/조회.

-- ── 일일 순방문자(DAU/WAU) 집계용 ────────────────────────────
--   60초 하트비트가 하루에 1번만 여기에 기록합니다(같은 브라우저·같은 날은 no-op).
--   따라서 "오늘 방문한 서로 다른 사람 수"(=진짜 DAU)를 댓글/투표 없이도 정확히 셉니다.
--   행은 (날짜, 브라우저키) 1개뿐 → 아주 작게 유지(오래된 날짜는 자동 정리).
create table if not exists daily_active (
  day         date not null,
  session_key text not null,
  primary key (day, session_key)
);
create index if not exists daily_active_day on daily_active (day);
alter table daily_active enable row level security;

-- 하트비트 1회: 수신·저장 + 정리 + 현재 인원수 반환
create or replace function thj_presence_ping(p_scope text, p_key text)
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  -- 1) 내 접속 하트비트 저장(서버 수신·저장)
  insert into presence_pings (scope, session_key, last_seen)
  values (p_scope, p_key, now())
  on conflict (scope, session_key) do update set last_seen = now();

  -- 1-b) 일일 순방문자 기록 (global 스코프 · 하루 첫 핑에서만 실제 insert)
  if p_scope = 'global' then
    insert into daily_active (day, session_key)
    values ((now() at time zone 'Asia/Seoul')::date, p_key)
    on conflict do nothing;
  end if;

  -- 2) 오래된 하트비트 정리(10분 경과) — 테이블을 작게 유지
  delete from presence_pings where last_seen < now() - interval '600 seconds';

  -- 3) 현재 인원수: 135초 이내에 하트비트가 있는 세션
  select count(*) into n from presence_pings
   where scope = p_scope and last_seen > now() - interval '135 seconds';

  return greatest(coalesce(n, 1), 1);
end;
$$;

-- (선택) 인원수만 조회 — 하트비트 없이 읽기만
create or replace function thj_presence_count(p_scope text)
returns integer language sql security definer set search_path = public as $$
  select greatest(coalesce(count(*), 1), 1)::integer from presence_pings
   where scope = p_scope and last_seen > now() - interval '135 seconds';
$$;

-- (선택) 탭 종료 시 즉시 내 행 제거 — 더 빠른 반영용
create or replace function thj_presence_leave(p_scope text, p_key text)
returns void language sql security definer set search_path = public as $$
  delete from presence_pings where scope = p_scope and session_key = p_key;
$$;

grant execute on function thj_presence_ping(text, text)  to anon, authenticated;
grant execute on function thj_presence_count(text)       to anon, authenticated;
grant execute on function thj_presence_leave(text, text) to anon, authenticated;

-- (선택) pg_cron 이 켜져 있으면 오래된 행을 주기적으로도 정리
do $$ begin
  create extension if not exists pg_cron;
  perform cron.unschedule('thj-presence-gc')
    where exists (select 1 from cron.job where jobname = 'thj-presence-gc');
  perform cron.schedule('thj-presence-gc', '*/10 * * * *',
    $sql$delete from presence_pings where last_seen < now() - interval '600 seconds';
         delete from daily_active where day < (now() at time zone 'Asia/Seoul')::date - 31$sql$);
exception when others then null;  -- pg_cron 없으면 RPC 내 정리만으로 충분
end $$;
