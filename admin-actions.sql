-- ════════════════════════════════════════════════════════════
--  toronhaja — 관리자 조치 서버 함수 (토론 삭제 · 기간제 정지)
--  Supabase → SQL Editor 에 붙여넣고 Run 하세요. 재실행해도 안전합니다.
--
--  이 파일이 해결하는 것:
--   1) 토론 삭제가 "진행되지 않던" 문제
--      → debates 의 외래키(votes·comments·reports)가 CASCADE 미설정이라
--        부모만 지우면 FK 위반으로 실패. 자식부터 순서대로 지우는
--        서버 함수(thj_delete_debate)로 한 번에 처리합니다.
--   2) 기간제 정지 (1일/7일/2주/1달/영구)
--      → users 에 banned_until 컬럼 추가 + thj_ban_user/thj_unban_user.
--        앱은 banned_until 이 지나면 자동으로 정지를 해제합니다.
--
--  ⚠ 보안: 데모 편의를 위해 anon 키로 실행됩니다(security definer).
--    실서비스에서는 service_role/서버에서만 호출하도록 좁히세요.
-- ════════════════════════════════════════════════════════════

-- 1) 정지 만료 시각 컬럼 ───────────────────────────────────────
--    null + is_banned=true  → 영구 정지
--    timestamptz            → 그 시각까지 임시 정지
alter table users add column if not exists banned_until timestamptz;

-- 2) 단일 토론 삭제 (자식 데이터까지 cascade) ──────────────────
create or replace function thj_delete_debate(did uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from reports       where comment_id in (select id from comments where debate_id = did);
  delete from comment_likes where comment_id in (select id from comments where debate_id = did);
  delete from comments       where debate_id = did;
  delete from votes          where debate_id = did;
  delete from debates        where id = did;
end;
$$;

-- 3) 기간제 정지 / 해제 ────────────────────────────────────────
create or replace function thj_ban_user(uid uuid, reason text, until timestamptz)
returns void language plpgsql security definer set search_path = public as $$
begin
  update users set is_banned = true, ban_reason = reason, banned_until = until where id = uid;
end;
$$;

create or replace function thj_unban_user(uid uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update users set is_banned = false, banned_until = null where id = uid;
end;
$$;

-- 4) 만료된 임시 정지 일괄 해제 (선택 · cron 으로 돌려도 됨) ────
create or replace function thj_expire_bans()
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  update users set is_banned = false
   where is_banned = true and banned_until is not null and banned_until <= now();
  get diagnostics n = row_count;
  return n;
end;
$$;

-- 5) 실행 권한 (anon publishable 키) ───────────────────────────
grant execute on function thj_delete_debate(uuid)              to anon, authenticated;
grant execute on function thj_ban_user(uuid, text, timestamptz) to anon, authenticated;
grant execute on function thj_unban_user(uuid)                 to anon, authenticated;
grant execute on function thj_expire_bans()                    to anon, authenticated;
