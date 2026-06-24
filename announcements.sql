-- ════════════════════════════════════════════════════════════
--  toronhaja — 공지(announcements) + 관리자 모더레이션 권한
--  Supabase → SQL Editor 에 붙여넣고 Run. 재실행 안전.
-- ════════════════════════════════════════════════════════════

-- 1) 공지 테이블 ──────────────────────────────────────────────
create table if not exists announcements (
  id         uuid default gen_random_uuid() primary key,
  body       text not null,
  is_active  boolean default true,
  created_at timestamptz default now()
);

alter table announcements enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename='announcements' and policyname='ann_select')
    then create policy "ann_select" on announcements for select using (true); end if;
  if not exists (select 1 from pg_policies where tablename='announcements' and policyname='ann_insert')
    then create policy "ann_insert" on announcements for insert with check (true); end if;
  if not exists (select 1 from pg_policies where tablename='announcements' and policyname='ann_update')
    then create policy "ann_update" on announcements for update using (true) with check (true); end if;
end $$;

-- 2) 관리자 모더레이션 권한 ───────────────────────────────────
--   ⚠ anon publishable 키로도 댓글 블라인드/유저 제재가 가능해집니다.
--     실서비스에서는 관리자 인증(서버 함수/role)으로 좁히세요. (데모 편의용)
do $$ begin
  -- 신고된 댓글 블라인드 처리 (comments.is_blinded = true)
  if not exists (select 1 from pg_policies where tablename='comments' and policyname='comments_update')
    then create policy "comments_update" on comments for update using (true) with check (true); end if;
  -- 유저 제재 (users.is_banned = true)
  if not exists (select 1 from pg_policies where tablename='users' and policyname='users_admin_update')
    then create policy "users_admin_update" on users for update using (true) with check (true); end if;
end $$;
