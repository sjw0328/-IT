// 로딩화면 2초 후 숨기기
window.addEventListener("load", () => {
    setTimeout(() => {
      document.getElementById("loading").style.display = "none";
      document.getElementById("mainContent").style.display = "block";
    }, 2000);
  });
  
  // 다크모드 토글
  const toggleBtn = document.getElementById('darkModeToggle');
  toggleBtn.addEventListener('click', () => {
    document.body.classList.toggle('dark-mode');
    toggleBtn.textContent = document.body.classList.contains('dark-mode') ? '☀️' : '🌙';
  });
  
  // 별점 클릭 이벤트
  const stars = document.querySelectorAll('.stars span');
  stars.forEach((star, idx) => {
    star.addEventListener('click', () => {
      stars.forEach((s, i) => {
        s.textContent = i <= idx ? '⭐️' : '⭐';
      });
      alert(`별 ${idx + 1}개 선택! 감사합니다 :)`);
    });
  });
  

  