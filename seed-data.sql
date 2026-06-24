-- ════════════════════════════════════════════════════════════
--  toronhaja — 2단계 설정 + 시드 데이터
--  ⚠ 먼저 보내주신 "전체 세팅" SQL(테이블 생성)을 실행한 다음,
--     이 파일을 Supabase → SQL Editor 에 붙여넣고 Run 하세요.
--  재실행해도 안전합니다.
-- ════════════════════════════════════════════════════════════

-- 1) UI 용 보강 컬럼 (카테고리 / 인기 / 종료시각) ───────────────
alter table debates add column if not exists category text default '사회';
alter table debates add column if not exists is_hot   boolean default false;
alter table debates add column if not exists ends_at  timestamptz;

-- 2) 누락된 RLS 정책 ──────────────────────────────────────────
do $$ begin
  -- 토론 생성 허용
  if not exists (select 1 from pg_policies where tablename='debates' and policyname='debates_insert')
    then create policy "debates_insert" on debates for insert with check (true); end if;
  -- 관리자 화면에서 신고 목록 읽기
  if not exists (select 1 from pg_policies where tablename='reports' and policyname='reports_select')
    then create policy "reports_select" on reports for select using (true); end if;
  -- 신고 접수(사용자 INSERT) 허용 — 없으면 security.sql 의 RLS 강제 후 신고가 막힌다
  if not exists (select 1 from pg_policies where tablename='reports' and policyname='reports_insert')
    then create policy "reports_insert" on reports for insert with check (true); end if;
  -- 투표 변경(찬↔반) 허용 — upsert 가 update 로 동작할 때 필요
  if not exists (select 1 from pg_policies where tablename='votes' and policyname='votes_update')
    then create policy "votes_update" on votes for update using (true) with check (true); end if;
end $$;

-- 3) Realtime 활성화 — 새 댓글/투표가 실시간 push 되도록 ───────
do $$ begin
  begin alter publication supabase_realtime add table comments; exception when others then null; end;
  begin alter publication supabase_realtime add table votes;    exception when others then null; end;
end $$;

-- ════════════════════════════════════════════════════════════
--  4) 시드 데이터 (원하면 실행 — 실데이터만 쓰려면 건너뛰세요)
-- ════════════════════════════════════════════════════════════

-- 4a) 익명 유저 80명 (동물 닉네임)
insert into users (nickname)
select (array['푸른','침착한','날쌘','강철','신중한','냉철한','붉은','불꽃','고독한','사나운','뜨거운','거침없는'])[1+floor(random()*12)::int]
     ||(array['독수리','고래','여우','곰','매','늑대','상어','표범','들소','코뿔소','올빼미','멧돼지'])[1+floor(random()*12)::int]
     || g
from generate_series(1, 80) g;

-- 4b) 토론 6개
insert into debates (title, category, is_hot, ends_at, side_a_label, side_b_label) values
  ('기본소득 月 50만원 전국민 지급, 도입해야 한다',  '정치', true,  now() + interval '3 hours',  '찬성','반대'),
  ('확률형 아이템(가챠) 전면 금지법, 찬성하십니까?',  '게임', true,  now() + interval '11 hours', '찬성','반대'),
  ('국가대표 감독, 외국인 감독이 한국인보다 낫다',    '축구', false, now() + interval '28 hours', '찬성','반대'),
  ('주 4일 근무제, 전면 도입할 때가 됐다',            '사회', true,  now() + interval '8 hours',  '찬성','반대'),
  ('연예인 열애설, 본인이 직접 해명할 의무가 있다',  '연예', false, now() + interval '49 hours', '찬성','반대'),
  ('수도권 대학 정원 확대, 지방소멸을 막을 수 있나',  '경제', false, now() + interval '14 hours', '찬성','반대');

-- 4c) 투표 시드 — 토론별 목표 찬성비율로 무작위 유저 투표
insert into votes (debate_id, user_id, side)
select debate_id, user_id, case when r < bias then 'A' else 'B' end
from (
  select d.id as debate_id, u.id as user_id, random() as r,
         (array[0.54,0.73,0.61,0.67,0.43,0.38])[d.rn::int] as bias,
         (array[72,76,60,70,64,52])[d.rn::int] as nmax,
         row_number() over (partition by d.id order by random()) as k
  from (select id, row_number() over (order by created_at) as rn from debates) d
  cross join users u
) x
where k <= nmax
on conflict (debate_id, user_id) do nothing;

-- 4d) 댓글 시드 — 1번 토론에 찬/반 의견
insert into comments (debate_id, user_id, side, content)
select d.id, u.id, v.side, v.content
from (select id from debates order by created_at limit 1) d
cross join (values
  ('A','복지 사각지대를 한 번에 메울 수 있는 건 선별복지가 아니라 보편지급입니다. 행정비용도 압도적으로 줄어요.'),
  ('A','AI·자동화로 일자리가 줄어드는 시대에 최소한의 소득 안전망은 선택이 아니라 필수라고 봅니다.'),
  ('A','지역화폐로 지급하면 소상공인 매출로 직결됩니다. 내수 진작 효과를 무시하면 안 됩니다.'),
  ('B','연 300조 넘는 재원, 어디서 나옵니까? 증세 없이는 불가능하고 결국 미래세대 빚입니다.'),
  ('B','정말 어려운 사람에게 두텁게 주는 선별복지가 효율적입니다. 부자한테까지 50만원 줄 이유가 없어요.'),
  ('B','노동 의욕 저하는 해외 실험에서도 일부 확인됐습니다. 근로연계형이 더 낫다고 봅니다.')
) v(side, content)
cross join lateral (select id from users order by random() limit 1) u;
