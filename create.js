/* ═══════════════════════════════════════════════
   toronhaja — create.js
   토론 생성 폼 → DB.addTopic()
   ═══════════════════════════════════════════════ */

'use strict';

let pickedCat = null;

document.getElementById('catPick').addEventListener('click', (e) => {
  const opt = e.target.closest('.cat-opt');
  if (!opt) return;
  document.querySelectorAll('.cat-opt').forEach(o => o.classList.remove('on'));
  opt.classList.add('on');
  pickedCat = opt.dataset.cat;
});

function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 1800);
}

document.getElementById('submitBtn').addEventListener('click', async () => {
  const title = document.getElementById('titleInput').value.trim();
  const description = document.getElementById('descInput').value.trim();

  if (!pickedCat) { toast('카테고리를 선택하세요'); return; }
  if (title.length < 8) { toast('주제를 8자 이상 입력하세요'); return; }

  const btn = document.getElementById('submitBtn');
  btn.disabled = true; btn.textContent = '생성 중…';

  const topic = await DB.addTopic({ category: pickedCat, title, description });

  if (!topic || topic.error) {
    btn.disabled = false; btn.textContent = '토론 시작하기';
    const msg = topic && topic.error ? topic.error : '';
    if (/row-level security|policy/i.test(msg)) {
      toast('서버 권한 설정 필요 — debates_insert 정책을 추가하세요');
    } else {
      toast('생성 실패: ' + (msg || '서버 오류'));
    }
    console.error('[toronhaja] 토론 생성 실패:', msg);
    return;
  }

  toast('토론이 생성되었습니다 🎉');
  // 생성된 토론 상세로 바로 진입 (id 가 있으면 딥링크, 없으면 피드)
  const dest = topic && topic.id ? ('index.html#d/' + topic.id) : 'index.html';
  setTimeout(() => { location.href = dest; }, 650);
});

/* Enter 로 제출 (제목 입력 중) */
document.getElementById('titleInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('submitBtn').click();
});
