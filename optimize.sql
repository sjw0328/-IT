-- ════════════════════════════════════════════════════════════
--  toronhaja — 성능/트래픽 최적화 (집계 컬럼 + 트리거)
--  Supabase → SQL Editor 에 붙여넣고 Run. 재실행 안전.
--
--  ▸ 왜 필요한가
--    기존 앱은 메인 피드를 그릴 때마다 votes / comments 테이블을
--    "통째로" 클라이언트로 내려받아 찬·반·댓글 수를 계산했습니다.
--    접속자(DAU)가 늘면 이 한 번의 화면 로드가 수만 행을 전송 →
--    Egress(전송량) 폭증 + 느린 로딩 + Free plan 한도 초과.
--
--  ▸ 이 파일이 하는 일
--    debates 테이블에 a_count / b_count / comment_count 를 "저장"하고,
--    투표·댓글이 바뀔 때 트리거가 자동으로 +1/-1 만 갱신합니다.
--    이제 피드는 debates 행(수십 개)만 읽으면 됩니다. (full scan 제거)
-- ════════════════════════════════════════════════════════════

-- 1) 집계 컬럼 ────────────────────────────────────────────────
alter table debates add column if not exists a_count       integer not null default 0;
alter table debates add column if not exists b_count       integer not null default 0;
alter table debates add column if not exists comment_count integer not null default 0;

-- 2) 투표 집계 트리거 함수 (A/B 카운트 유지) ──────────────────
create or replace function thj_bump_vote_counts() returns trigger as $$
begin
  if (tg_op = 'INSERT') then
    if upper(new.side) = 'A' then
      update debates set a_count = a_count + 1 where id = new.debate_id;
    else
      update debates set b_count = b_count + 1 where id = new.debate_id;
    end if;

  elsif (tg_op = 'DELETE') then
    if upper(old.side) = 'A' then
      update debates set a_count = greatest(a_count - 1, 0) where id = old.debate_id;
    else
      update debates set b_count = greatest(b_count - 1, 0) where id = old.debate_id;
    end if;

  elsif (tg_op = 'UPDATE') then
    -- 입장을 찬↔반 으로 바꾼 경우만 처리
    if upper(old.side) <> upper(new.side) then
      if upper(new.side) = 'A' then
        update debates set a_count = a_count + 1,
                           b_count = greatest(b_count - 1, 0) where id = new.debate_id;
      else
        update debates set b_count = b_count + 1,
                           a_count = greatest(a_count - 1, 0) where id = new.debate_id;
      end if;
    end if;
  end if;
  return null;  -- AFTER 트리거 → 반환값 무시
end;
$$ language plpgsql;

-- 3) 댓글 집계 트리거 함수 ────────────────────────────────────
create or replace function thj_bump_comment_counts() returns trigger as $$
begin
  if (tg_op = 'INSERT') then
    update debates set comment_count = comment_count + 1 where id = new.debate_id;
  elsif (tg_op = 'DELETE') then
    update debates set comment_count = greatest(comment_count - 1, 0) where id = old.debate_id;
  end if;
  return null;
end;
$$ language plpgsql;

-- 4) 트리거 연결 (중복 생성 방지 위해 먼저 drop) ───────────────
drop trigger if exists trg_vote_counts on votes;
create trigger trg_vote_counts
  after insert or update or delete on votes
  for each row execute function thj_bump_vote_counts();

drop trigger if exists trg_comment_counts on comments;
create trigger trg_comment_counts
  after insert or delete on comments
  for each row execute function thj_bump_comment_counts();

-- 5) 기존 데이터 백필 (한 번만, 트리거 적용 전 데이터 반영) ─────
update debates d set
  a_count       = coalesce((select count(*) from votes    v where v.debate_id = d.id and upper(v.side) = 'A'), 0),
  b_count       = coalesce((select count(*) from votes    v where v.debate_id = d.id and upper(v.side) = 'B'), 0),
  comment_count = coalesce((select count(*) from comments c where c.debate_id = d.id), 0);

-- 6) 인덱스 — 피드 정렬/필터/마감 조회 가속 ────────────────────
create index if not exists idx_debates_created  on debates (created_at desc);
create index if not exists idx_debates_status   on debates (status);
create index if not exists idx_comments_debate  on comments (debate_id);
create index if not exists idx_votes_debate     on votes (debate_id);

-- 완료. 이제 supabase.js 는 debates 의 a_count/b_count/comment_count 를 그대로 읽습니다.
