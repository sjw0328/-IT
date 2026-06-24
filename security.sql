-- ════════════════════════════════════════════════════════════
--  toronhaja — 보안 강화 (security.sql)
--  Supabase → SQL Editor 에 붙여넣고 Run 하세요. 재실행해도 안전합니다.
--  ⚠ announcements.sql · admin-actions.sql · cleanup.sql · extreme.sql
--    을 (사용한다면) 먼저 실행한 뒤 이 파일을 마지막에 실행하세요.
--
--  이 파일이 닫는 구멍:
--   1) 그동안 anon(publishable) 키만 있으면 누구나
--      댓글 블라인드 · 유저 제재 · 토론/댓글 삭제 · 공지 게시 · 데이터 정리를
--      직접 호출할 수 있었습니다(열린 RLS 정책 + 인증 없는 RPC).
--   2) 이제 그 작업들은 전부 "관리자 비밀번호를 서버에서 검증하는"
--      게이트 RPC(thj_admin_*) 로만 가능합니다.
--      ▸ 열린 쓰기 정책(comments_update · users_admin_update · ann_insert/update) 제거
--      ▸ 인증 없던 파괴적 RPC 들의 anon 직접 호출 권한 회수(revoke)
--
--  ▸ 비밀번호 검증 방식
--    클라이언트(admin.html)와 동일한 SHA-256 해시를 서버에 저장하고,
--    RPC 가 받은 평문을 서버에서 digest 해 비교합니다. 평문은 어디에도 저장되지 않습니다.
--    기본값은 admin.html 의 PW_HASH 와 같은 해시이므로 기존 비밀번호가 그대로 동작합니다.
-- ════════════════════════════════════════════════════════════

create extension if not exists pgcrypto;

-- 1) 앱 설정 저장소 + 관리자 비밀번호 해시 ─────────────────────
create table if not exists app_config (
  key   text primary key,
  value text not null
);
alter table app_config enable row level security;   -- 정책 없음 = anon 직접 접근 불가(아래 RPC 로만)

-- 기본 관리자 비밀번호 해시(SHA-256 hex) — admin.html 의 PW_HASH 와 동일.
-- 이미 값이 있으면 건드리지 않습니다(재실행 안전).
insert into app_config (key, value)
values ('admin_pw_hash', '00f895a79024688ce890f2e9a1f502b3a24352b4989b53a7bc2f277edad437dc')
on conflict (key) do nothing;

-- 2) 비밀번호 서버 검증 ───────────────────────────────────────
create or replace function thj_is_admin(pass text)
returns boolean language sql stable security definer
set search_path = public, extensions as $$
  select exists (
    select 1 from app_config
     where key = 'admin_pw_hash'
       and value = encode(digest(coalesce(pass, ''), 'sha256'), 'hex')
  );
$$;

create or replace function thj_require_admin(pass text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not thj_is_admin(pass) then
    raise exception '관리자 인증 실패' using errcode = '42501';
  end if;
end;
$$;

-- 관리자 비밀번호 변경(현재 비번 확인 후 새 해시 저장) — 선택 사용
create or replace function thj_set_admin_pw(pass text, new_hash text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform thj_require_admin(pass);
  insert into app_config (key, value) values ('admin_pw_hash', lower(new_hash))
  on conflict (key) do update set value = excluded.value;
end;
$$;

-- ════════════════════════════════════════════════════════════
--  3) 관리자 게이트 RPC (전부 비밀번호 검증 후 실행) ──────────
-- ════════════════════════════════════════════════════════════

-- 3a) 댓글 블라인드 / 해제
create or replace function thj_admin_blind_comment(pass text, cid uuid, on_state boolean default true)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform thj_require_admin(pass);
  update comments set is_blinded = on_state where id = cid;
end;
$$;

-- 3b) 댓글 삭제 (자식 신고·좋아요까지)
create or replace function thj_admin_delete_comment(pass text, cid uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform thj_require_admin(pass);
  delete from reports       where comment_id = cid;
  delete from comment_likes where comment_id = cid;
  delete from comments      where id = cid;
end;
$$;

-- 3c) 토론 삭제 (자식 데이터까지)
create or replace function thj_admin_delete_debate(pass text, did uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform thj_require_admin(pass);
  delete from reports       where comment_id in (select id from comments where debate_id = did);
  delete from comment_likes where comment_id in (select id from comments where debate_id = did);
  delete from comments      where debate_id = did;
  delete from votes         where debate_id = did;
  delete from debates       where id = did;
end;
$$;

-- 3d) 토론 마감 / 재개
create or replace function thj_admin_set_debate_status(pass text, did uuid, closed boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform thj_require_admin(pass);
  update debates set status = case when closed then 'closed' else 'active' end where id = did;
end;
$$;

-- 3e) 유저 제재 / 해제 (기간제는 until, 영구는 null)
create or replace function thj_admin_ban_user(pass text, uid uuid, reason text, until timestamptz)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform thj_require_admin(pass);
  update users set is_banned = true, ban_reason = reason, banned_until = until where id = uid;
end;
$$;

create or replace function thj_admin_unban_user(pass text, uid uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform thj_require_admin(pass);
  update users set is_banned = false, banned_until = null where id = uid;
end;
$$;

-- 3f) 공지 게시 / 게시상태 토글
create or replace function thj_admin_add_announcement(pass text, body text)
returns announcements language plpgsql security definer set search_path = public as $$
declare row announcements;
begin
  perform thj_require_admin(pass);
  insert into announcements (body, is_active) values (body, true) returning * into row;
  return row;
end;
$$;

create or replace function thj_admin_set_announcement(pass text, aid uuid, on_state boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform thj_require_admin(pass);
  update announcements set is_active = on_state where id = aid;
end;
$$;

-- 3f-2) 신고 목록 조회 (관리자 전용) — 신고자 신원·대상을 anon 이 직접 읽지 못하게
--   기존 reports_select(열림) 정책을 잠그고, 이 RPC 로만 내려준다.
create or replace function thj_admin_reports(pass text)
returns json language plpgsql security definer set search_path = public as $$
declare result json;
begin
  perform thj_require_admin(pass);
  select coalesce(json_agg(t order by t.created_at desc), '[]'::json) into result from (
    select r.id, r.comment_id, r.reason, r.status, r.created_at,
           c.user_id   as target_user_id, c.side, c.content, c.is_blinded,
           cu.nickname as target_nick, d.title as debate_title,
           ru.nickname as reporter_nick
    from reports r
    left join comments c  on c.id = r.comment_id
    left join users    cu on cu.id = c.user_id
    left join debates  d  on d.id = c.debate_id
    left join users    ru on ru.id = r.reporter_id
  ) t;
  return result;
end;
$$;

-- 3g) 데이터 정리 게이트 (cleanup.sql · extreme.sql 의 로직을 비번 뒤로 감춤)
--     내부 함수는 정의자(owner) 권한으로 실행되므로 anon 권한을 회수해도 동작합니다.
create or replace function thj_admin_purge_old_debates(pass text, days integer)
returns integer language plpgsql security definer set search_path = public as $$
begin perform thj_require_admin(pass); return thj_purge_old_debates(days); end;
$$;
create or replace function thj_admin_purge_old_reports(pass text, days integer)
returns integer language plpgsql security definer set search_path = public as $$
begin perform thj_require_admin(pass); return thj_purge_old_reports(days); end;
$$;
create or replace function thj_admin_purge_orphan_users(pass text)
returns integer language plpgsql security definer set search_path = public as $$
begin perform thj_require_admin(pass); return thj_purge_orphan_users(); end;
$$;
create or replace function thj_admin_strip_closed(pass text)
returns integer language plpgsql security definer set search_path = public as $$
begin perform thj_require_admin(pass); return thj_strip_closed_debates(); end;
$$;
create or replace function thj_admin_auto_cleanup(pass text)
returns json language plpgsql security definer set search_path = public as $$
begin perform thj_require_admin(pass); return thj_auto_cleanup(); end;
$$;

-- 4) 닉네임 변경 (일반 사용자 — 비번 불필요, 닉네임 컬럼만) ────
--    users 쓰기 정책을 잠그므로 자기 닉네임 변경은 이 RPC 로만.
create or replace function thj_set_nickname(uid uuid, name text)
returns void language plpgsql security definer set search_path = public as $$
declare v text := btrim(name);
begin
  if char_length(v) < 2 or char_length(v) > 16 then
    raise exception '닉네임은 2~16자' using errcode = '22000';
  end if;
  update users set nickname = v where id = uid;
end;
$$;

-- ════════════════════════════════════════════════════════════
--  5) 열린 쓰기 정책 잠금 (관리자 작업은 위 게이트 RPC 로만) ──
-- ════════════════════════════════════════════════════════════
-- announcements.sql 이 열어둔 관리자용 쓰기 정책 제거.
-- (읽기 select 정책 · 사용자 insert(댓글/투표/좋아요) · votes_update 는 그대로 유지)
drop policy if exists "comments_update"     on comments;       -- 블라인드 → thj_admin_blind_comment
drop policy if exists "users_admin_update"  on users;          -- 제재/닉네임 → 게이트 RPC / thj_set_nickname
drop policy if exists "ann_insert"          on announcements;  -- 공지 게시 → thj_admin_add_announcement
drop policy if exists "ann_update"          on announcements;  -- 공지 토글 → thj_admin_set_announcement
drop policy if exists "reports_select"      on reports;        -- 신고 목록 열람 → thj_admin_reports (신고자 신원 보호)

-- ⚠ reports 는 select 만 잠근다. 신고 '접수(insert)'는 사용자가 해야 하므로
--    RLS 강제 후에도 INSERT 정책은 반드시 '누구나 허용'으로 유지한다.
--    (제한적 정책이 남아 있으면 신고가 막히므로 무조건 교체)
drop policy if exists "reports_insert" on reports;
create policy "reports_insert" on reports for insert with check (true);
grant insert on reports to anon, authenticated;

-- 6) 인증 없던 파괴적 RPC 의 anon 직접 호출 권한 회수 ──────────
--    (게이트 RPC 내부 호출은 정의자 권한이라 계속 동작합니다.)
--    설치되지 않은 함수는 건너뜁니다(undefined_function 무시).
do $$
declare sig text;
begin
  foreach sig in array array[
    'thj_delete_debate(uuid)',
    'thj_ban_user(uuid, text, timestamptz)',
    'thj_unban_user(uuid)',
    'thj_delete_comment(uuid)',
    'thj_purge_old_debates(integer)',
    'thj_purge_old_reports(integer)',
    'thj_purge_orphan_users()',
    'thj_strip_closed_debates()',
    'thj_auto_cleanup()',
    'thj_close_ended()',
    'thj_expire_bans()'
  ] loop
    begin
      execute format('revoke execute on function %s from anon', sig);
    exception when undefined_function then null;
    end;
  end loop;
end $$;

-- 7) 게이트 RPC 실행 권한 (anon publishable 키) ───────────────
grant execute on function thj_is_admin(text)                                       to anon, authenticated;
grant execute on function thj_set_admin_pw(text, text)                             to anon, authenticated;
grant execute on function thj_admin_blind_comment(text, uuid, boolean)             to anon, authenticated;
grant execute on function thj_admin_delete_comment(text, uuid)                     to anon, authenticated;
grant execute on function thj_admin_delete_debate(text, uuid)                      to anon, authenticated;
grant execute on function thj_admin_set_debate_status(text, uuid, boolean)         to anon, authenticated;
grant execute on function thj_admin_ban_user(text, uuid, text, timestamptz)        to anon, authenticated;
grant execute on function thj_admin_unban_user(text, uuid)                         to anon, authenticated;
grant execute on function thj_admin_add_announcement(text, text)                   to anon, authenticated;
grant execute on function thj_admin_set_announcement(text, uuid, boolean)          to anon, authenticated;
grant execute on function thj_admin_reports(text)                                  to anon, authenticated;
grant execute on function thj_admin_purge_old_debates(text, integer)               to anon, authenticated;
grant execute on function thj_admin_purge_old_reports(text, integer)               to anon, authenticated;
grant execute on function thj_admin_purge_orphan_users(text)                       to anon, authenticated;
grant execute on function thj_admin_strip_closed(text)                             to anon, authenticated;
grant execute on function thj_admin_auto_cleanup(text)                             to anon, authenticated;
grant execute on function thj_set_nickname(uuid, text)                             to anon, authenticated;

-- ════════════════════════════════════════════════════════════
--  8) RLS 전수 점검 — 모든 테이블 RLS 켜기 + 열린 쓰기 정책 경고
--     (votes_update·comments_insert·debates_insert 처럼 사용자에게
--      필요한 정책은 그대로 둬야 하므로 자동 삭제하지 않고 NOTICE 로
--      알려만 줍니다. SQL Editor 의 'Messages' 탭에서 확인하세요.)
-- ════════════════════════════════════════════════════════════
do $$
declare t text; p record;
begin
  -- 모든 핵심 테이블에 RLS 강제 (이미 켜져 있으면 무해)
  foreach t in array array[
    'users','debates','votes','comments','comment_likes','reports','announcements','app_config','presence_pings'
  ] loop
    if exists (select 1 from information_schema.tables where table_schema='public' and table_name=t) then
      execute format('alter table public.%I enable row level security', t);
    end if;
  end loop;

  -- 남아있는 열린 update/delete/all 정책을 경고 (검토용)
  for p in
    select tablename, policyname, cmd from pg_policies
     where schemaname='public'
       and tablename in ('users','debates','votes','comments','comment_likes','reports','announcements')
       and cmd in ('UPDATE','DELETE','ALL')
     order by tablename, cmd
  loop
    raise notice '⚠ 쓰기 정책 검토: %."%" (%) — 의도한 것이 아니면 drop 하세요 (단 votes_update 는 투표 upsert 에 필요)',
      p.tablename, p.policyname, p.cmd;
  end loop;
end $$;

-- ════════════════════════════════════════════════════════════
--  비밀번호 변경 방법
--   1) 새 비밀번호의 SHA-256 hex 해시를 구한다(브라우저 콘솔):
--      crypto.subtle.digest('SHA-256', new TextEncoder().encode('새비밀번호'))
--        .then(b => console.log([...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('')));
--   2) admin.html 의 PW_HASH 를 그 값으로 바꾸고,
--   3) 서버에도 반영: update app_config set value='<새해시>' where key='admin_pw_hash';
--      (또는 관리자 화면에서 thj_set_admin_pw 호출)
-- ════════════════════════════════════════════════════════════
