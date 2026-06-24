-- ════════════════════════════════════════════════════════════
--  toronhaja — notifications.sql  (인앱 알림 시스템)
--  Supabase → SQL Editor 에 붙여넣고 Run. 재실행 안전.
--  · 누가 내 의견에 공감하면        → 'like' 알림
--  · 내가 참여한 토론에 새 의견이 올라오면 → 'reply' 알림 (참여자당 안읽음 1건으로 합침)
--  · 공지(announcements)는 전체 broadcast 로 패널에 함께 표시됨 (별도 행 미생성)
--  ⚠ announcements 테이블이 필요하면 announcements.sql 을 먼저 실행하세요.
-- ════════════════════════════════════════════════════════════

-- 1) 알림 테이블 ──────────────────────────────────────────────
create table if not exists notifications (
  id          uuid default gen_random_uuid() primary key,
  user_id     uuid references users(id)   on delete cascade,  -- 받는 사람
  type        text not null,                                  -- 'like' | 'reply'
  title       text,
  body        text,
  debate_id   uuid references debates(id) on delete cascade,  -- 클릭 시 이동할 토론
  ref_comment uuid,                                           -- 좋아요 합치기용
  actor_nick  text,                                           -- 알림을 일으킨 사람
  is_read     boolean default false,
  created_at  timestamptz default now()
);
create index if not exists notif_user_unread_idx
  on notifications (user_id, is_read, created_at desc);

alter table notifications enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename='notifications' and policyname='notif_select')
    then create policy "notif_select" on notifications for select using (true); end if;
  -- 모두 읽음 처리(클라이언트 update)용. 알림 내용은 민감정보가 아님.
  if not exists (select 1 from pg_policies where tablename='notifications' and policyname='notif_update')
    then create policy "notif_update" on notifications for update using (true) with check (true); end if;
end $$;

-- 2) 좋아요 → 댓글 작성자에게 알림 ────────────────────────────
create or replace function thj_notify_on_like() returns trigger
language plpgsql security definer as $$
declare author uuid; d_id uuid; d_title text; liker text;
begin
  select c.user_id, c.debate_id into author, d_id from comments c where c.id = NEW.comment_id;
  if author is null or author = NEW.user_id then return NEW; end if;   -- 셀프 좋아요/익명 제외
  select title into d_title from debates where id = d_id;
  select nickname into liker from users where id = NEW.user_id;
  -- 같은 댓글에 대한 안읽음 좋아요 알림이 있으면 최신으로 끌어올림 (행 폭증 방지)
  update notifications set is_read=false, created_at=now()
   where user_id=author and type='like' and ref_comment=NEW.comment_id and is_read=false;
  if not found then
    insert into notifications (user_id, type, title, body, debate_id, ref_comment, actor_nick)
    values (author, 'like', coalesce(d_title,'내 의견'),
            coalesce(liker,'누군가') || '님이 회원님의 의견에 공감했어요',
            d_id, NEW.comment_id, liker);
  end if;
  return NEW;
end $$;

drop trigger if exists trg_notify_like on comment_likes;
create trigger trg_notify_like after insert on comment_likes
  for each row execute function thj_notify_on_like();

-- 3) 새 댓글 → 같은 토론 참여자에게 알림 (참여자당 안읽음 1건으로 합침) ──
create or replace function thj_notify_on_comment() returns trigger
language plpgsql security definer as $$
declare d_title text; writer text;
begin
  select title into d_title from debates where id = NEW.debate_id;
  select nickname into writer from users where id = NEW.user_id;
  -- 이미 안읽음 'reply' 알림이 있는 참여자는 최신으로 갱신 (새 행 만들지 않음)
  update notifications
     set is_read=false, created_at=now(), actor_nick=writer,
         body = coalesce(writer,'누군가') || '님 외 새 의견이 올라왔어요'
   where debate_id=NEW.debate_id and type='reply' and is_read=false
     and user_id <> NEW.user_id;
  -- 안읽음 'reply' 알림이 없는 참여자에게만 새로 추가
  insert into notifications (user_id, type, title, body, debate_id, actor_nick)
  select distinct c.user_id, 'reply', coalesce(d_title,'토론'),
         coalesce(writer,'누군가') || '님이 새 의견을 남겼어요',
         NEW.debate_id, writer
  from comments c
  where c.debate_id = NEW.debate_id
    and c.user_id is not null
    and c.user_id <> NEW.user_id
    and not exists (
      select 1 from notifications n
      where n.user_id=c.user_id and n.debate_id=NEW.debate_id
        and n.type='reply' and n.is_read=false);
  return NEW;
end $$;

drop trigger if exists trg_notify_comment on comments;
create trigger trg_notify_comment after insert on comments
  for each row execute function thj_notify_on_comment();

-- 4) 실시간 push — 벨이 즉시 갱신되도록 publication 에 추가 ─────
do $$ begin
  begin alter publication supabase_realtime add table notifications;  exception when others then null; end;
  begin alter publication supabase_realtime add table announcements;  exception when others then null; end;
end $$;

-- 5) (선택) 오래된 알림 정리 — 용량 관리 ──────────────────────
--    수동: select thj_purge_old_notifications(30);
--    자동: pg_cron 이 켜져 있으면 매일 새벽 30일 지난 알림 삭제
create or replace function thj_purge_old_notifications(days int default 30)
returns integer language plpgsql security definer as $$
declare n int;
begin
  delete from notifications where created_at < now() - (days || ' days')::interval;
  get diagnostics n = row_count; return n;
end $$;

do $$ begin
  if exists (select 1 from pg_extension where extname='pg_cron') then
    perform cron.schedule('thj-notif-cleanup', '17 4 * * *',
      $cron$ select thj_purge_old_notifications(30); $cron$);
  end if;
exception when others then null; end $$;
