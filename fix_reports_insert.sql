-- ════════════════════════════════════════════════
-- toronhaja — 신고(reports) INSERT 정책 강제 복구  ★이 파일을 실행하세요★
--
-- 증상: SQL 을 한 번 돌렸는데도 댓글 "신고"가 여전히 안 됨.
-- 원인: 신고 INSERT 가 RLS 정책에 막힘.
--   ① reports 에 INSERT 허용 정책이 아예 없거나,
--   ② 기존에 '제한적인' INSERT 정책(예: reporter_id = auth.uid())이 있는데
--      이 앱은 Supabase Auth 를 안 써서 auth.uid() 가 NULL → 항상 거부됨.
--   (앞서 드린 파일은 "정책이 없을 때만 생성"이라, ②의 경우 그대로 막혔습니다.)
--
-- 조치: 기존 insert 정책을 '무조건 지우고' 누구나 신고 가능한 정책으로 새로 만든다.
--   Supabase → SQL Editor 에 "전체" 붙여넣고 Run. 재실행해도 안전.
-- ════════════════════════════════════════════════

-- 1) RLS 켜짐 보장
alter table reports enable row level security;

-- 2) 기존 INSERT 정책을 이름과 무관하게 정리 (있을 수 있는 변형들 포함)
drop policy if exists "reports_insert"      on reports;
drop policy if exists "reports insert"      on reports;
drop policy if exists "reports_insert_anon" on reports;
drop policy if exists "Enable insert for all users" on reports;

-- 3) 누구나 신고 접수 가능 (조회는 thj_admin_reports RPC 로만 — 그대로 유지)
create policy "reports_insert" on reports for insert with check (true);

-- 4) 테이블 INSERT 권한 보장 (revoke 되어 있던 경우 대비)
grant insert on reports to anon, authenticated;

-- 5) 확인용 — 현재 reports 에 걸린 정책 목록 (Results 탭에서 확인)
select policyname, cmd, qual, with_check
  from pg_policies
 where schemaname = 'public' and tablename = 'reports'
 order by cmd, policyname;
