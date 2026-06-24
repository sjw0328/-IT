/* ───────────────────────────────────────────────
   supabase.js 에 추가할 알림 DB 메서드.
   기존 supabase.js 의 const DB = { … } 객체 안,
   unsubscribe(ch){…} 메서드 바로 다음에 붙여넣으세요.

   ⚠ 이 메서드들은 supabase.js 내부 변수에 의존합니다:
      · sb        → supabase.createClient(...) 결과
      · MY_UID    → 현재 익명 유저 id (localStorage 'thj_uid')
   다른 프로젝트로 옮길 땐 이 두 가지를 동일하게 준비하세요.
   ─────────────────────────────────────────────── */

/* ── 알림(notifications) ──────────────────────────
   · 개인 알림(좋아요/답글) = notifications 테이블 (내 user_id 대상)
   · 공지 broadcast = announcements (행 추가 없이 패널에 함께 표시, 읽음은 localStorage)
   notifications.sql 미실행이어도 공지만으로 동작(개인 알림은 0). */
async notifications(limit = 30) {
  if (!sb) return [];
  const out = [];
  if (MY_UID) {
    const { data } = await sb.from('notifications')
      .select('*').eq('user_id', MY_UID)
      .order('created_at', { ascending: false }).limit(limit);
    (data || []).forEach(n => out.push({
      id: n.id, kind: n.type, title: n.title, body: n.body,
      debateId: n.debate_id || null, actor: n.actor_nick || null,
      created_at: n.created_at, read: !!n.is_read, personal: true,
    }));
  }
  const seen = +localStorage.getItem('thj_notif_seen') || 0;
  const { data: anns } = await sb.from('announcements')
    .select('*').eq('is_active', true)
    .order('created_at', { ascending: false }).limit(10);
  (anns || []).forEach(a => out.push({
    id: 'ann_' + a.id, kind: 'announce', title: '공지사항', body: a.body,
    debateId: null, actor: null, created_at: a.created_at,
    read: new Date(a.created_at).getTime() <= seen, personal: false,
  }));
  out.sort((x, y) => new Date(y.created_at) - new Date(x.created_at));
  return out.slice(0, limit);
},
async unreadCount() {
  if (!sb) return 0;
  let n = 0;
  if (MY_UID) {
    const { count } = await sb.from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', MY_UID).eq('is_read', false);
    n += count || 0;
  }
  const seen = +localStorage.getItem('thj_notif_seen') || 0;
  const { data } = await sb.from('announcements')
    .select('created_at').eq('is_active', true)
    .order('created_at', { ascending: false }).limit(10);
  (data || []).forEach(a => { if (new Date(a.created_at).getTime() > seen) n++; });
  return n;
},
async markAllRead() {
  localStorage.setItem('thj_notif_seen', String(Date.now()));
  if (!sb || !MY_UID) return;
  await sb.from('notifications').update({ is_read: true })
    .eq('user_id', MY_UID).eq('is_read', false);
},
subscribeNotifications(onChange) {
  if (!sb) return null;
  const ch = sb.channel('rt-notify-' + (MY_UID || 'anon'));
  if (MY_UID) {
    ch.on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'notifications', filter: 'user_id=eq.' + MY_UID },
      ({ new: row }) => onChange({ id: row.id, kind: row.type, title: row.title, body: row.body, debateId: row.debate_id || null, created_at: row.created_at }));
  }
  ch.on('postgres_changes',
    { event: 'INSERT', schema: 'public', table: 'announcements' },
    ({ new: row }) => { if (row.is_active) onChange({ id: 'ann_' + row.id, kind: 'announce', title: '공지사항', body: row.body, created_at: row.created_at }); });
  ch.subscribe();
  return ch;
},
