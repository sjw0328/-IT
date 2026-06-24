-- ════════════════════════════════════════════════
-- toronhaja — 에디션 전용 팬 배지 (선택)
-- comments 에 edition 컬럼을 추가하면 배지가 "모든 사용자"에게
-- 영구 노출된다. 미적용 시에도 작성자 본인 화면엔 로컬 폴백으로 표시됨.
-- Supabase SQL Editor 에서 1회 실행.
-- ════════════════════════════════════════════════

alter table comments
  add column if not exists edition text;

-- 조회 최적화(선택): 특정 에디션 댓글만 필터링할 일이 있으면
create index if not exists comments_edition_idx
  on comments (edition)
  where edition is not null;
