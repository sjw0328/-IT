-- ════════════════════════════════════════════════════════
-- 토론하자 · 모든 토론 마감 해제 (reopen-all-debates.sql)
-- Supabase → SQL Editor 에 붙여넣고 실행하세요.
--
-- 앱은 status='closed' "또는" ends_at 이 지난 토론을 마감으로
-- 처리합니다. 따라서 완전히 "진행중"으로 되돌리려면 status 를
-- active 로 바꾸고 ends_at 도 비워야(또는 미래로) 합니다.
-- ════════════════════════════════════════════════════════

-- ① 전부 즉시 진행중으로 (마감시간 제거 → "진행중" 표시)
update debates
set status   = 'active',
    ends_at  = null;

-- ────────────────────────────────────────────────────────
-- ② (대안) 마감 시한을 유지하고 싶다면 위 대신 아래를 쓰세요.
--    지금부터 7일 뒤로 마감시간을 다시 설정합니다.
update debates
set status  = 'active',
     ends_at = now() + interval '7 days';

-- ③ 확인용 — 현재 토론 상태 점검
select id, title, status, ends_at
from debates
order by created_at desc;
