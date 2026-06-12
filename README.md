# 토론하자 — 출시 가이드

찬반이 갈리는 실시간 토론 플랫폼. 100% 서버(Supabase) 구동 · 외부 SDK 0개.

---

## 1. 설정 (Supabase)

`app/supabase.js` 상단에서 프로젝트 정보를 연결합니다.

```js
const SUPABASE_URL = 'https://<your-project>.supabase.co';
const SUPABASE_KEY = '<publishable anon key>';
```

> anon(publishable) 키는 공개돼도 되는 키입니다. 실제 보안은 아래 **RLS 정책**이 담당합니다.

### SQL 실행 순서 (Supabase → SQL Editor)

순서대로 한 번씩만 Run 하면 됩니다. 모두 **재실행해도 안전**합니다.

| 순서 | 파일 | 역할 | 필수 |
|---|---|---|---|
| 0 | *(기본 스키마)* | `users·debates·votes·comments·comment_likes·reports` 테이블 생성 | ✅ 필수 (최초 1회) |
| 1 | `seed-data.sql` | UI 보강 컬럼(category·is_hot·ends_at) + 누락 RLS 정책 + 예시 토론 | ✅ 권장 |
| 2 | `optimize.sql` | 집계 컬럼(a/b/comment_count) + 트리거 → **트래픽·디스크 절감의 핵심** | ✅ 권장 |
| 3 | `announcements.sql` | 공지 테이블 + 관리자 모더레이션 권한 | ⬜ 선택 |
| 4 | `analytics.sql` | 사용자 통계(DAU/WAU) RPC + 댓글 삭제 RPC | ⬜ 선택 |
| 5 | `cleanup.sql` | 데이터 정리 함수(오래된 종료 토론 삭제) | ⬜ 선택 |
| 6 | `extreme.sql` | 익스트림 디스크 절감 + pg_cron 자동 정리 | ⬜ 선택 |

각 파일을 안 돌려도 앱은 **정상 작동**합니다(자동 폴백). 단:
- `optimize.sql` 미실행 → 매 피드 로드마다 votes/comments 전체 집계(트래픽 ↑). 출시 전 권장.
- `analytics.sql` 미실행 → 관리자 "사용자 현황"이 추정 모드(DAU/WAU 대신 오늘 댓글·투표 수).

---

## 2. 저장 용량(디스크) 관리

서버 저장량을 줄이는 건 `cleanup.sql` · `extreme.sql` 입니다 (`optimize.sql`은 트래픽용).

- **`extreme.sql` 을 1회 실행하면** 내장 pg_cron 이 매일 새벽 마감된 토론의 원본 행을 자동으로 비웁니다 — 그 뒤로는 아무것도 다시 안 돌려도 됩니다.
- pg_cron 이 꺼져 있으면(Database → Extensions) 관리자 페이지의 **[자동정리 지금 실행]** 버튼으로 수동 실행하세요.
- 실제 절감량은 관리자 → **데이터 관리** 탭의 바이트 수치를 정리 전후로 비교해 확인합니다.

---

## 3. 관리자 페이지

`admin.html` 진입 시 비밀번호 인증. 소스에는 **SHA-256 해시만** 저장돼 평문이 노출되지 않습니다.

**비밀번호 변경** — 새 비밀번호의 SHA-256 해시를 구해 `admin.html` 의 `PW_HASH` 에 넣습니다.
```js
// 브라우저 콘솔에서:
crypto.subtle.digest('SHA-256', new TextEncoder().encode('새비밀번호'))
  .then(b => console.log([...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('')));
```
> 클라이언트 게이트는 1차 차단일 뿐입니다. 민감 작업(삭제·제재)의 진짜 보호는 Supabase RLS 정책이며, `admin.html` 에는 검색엔진 차단(noindex)이 걸려 있습니다.

---

## 4. 출시 전 체크리스트

- [ ] `supabase.js` 의 URL·KEY 가 운영 프로젝트로 설정됨
- [ ] 기본 스키마 + `seed-data.sql` + `optimize.sql` 실행 완료
- [ ] 관리자 비밀번호를 기본값에서 변경 (`PW_HASH`)
- [ ] 정적 호스팅에 `app/` 폴더 전체 업로드 (Vercel/Netlify/Cloudflare Pages 등)
- [ ] 공유 미리보기 확인 — 카카오톡/X 에 링크를 붙여 `og.png` 썸네일이 뜨는지
- [ ] (선택) `extreme.sql` 실행 + pg_cron 활성화로 디스크 자동 관리

---

## 파일 구조

```
app/
├─ index.html · app.js          메인 피드 + 토론 상세
├─ create.html · create.js      토론 생성
├─ admin.html · admin.js        관리자 (신고·토론·사용자·데이터)
├─ supabase.js                  데이터 계층 (서버 구동)
├─ share.js                     공유 + 딥링크 (외부 SDK 0)
├─ onboard.js                   첫 방문 온보딩 + 닉네임
├─ icons.js · style.css         아이콘 스프라이트 · 디자인
├─ og.png · favicon-*.png       공유/탭 이미지
├─ site.webmanifest            PWA 매니페스트
└─ *.sql                        서버 설정 스크립트 (위 표 참고)
```
