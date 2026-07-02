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

> 📂 **SQL 파일은 프로젝트 루트의 `sql/` 폴더**에 따로 있습니다. GitHub Pages 등 정적 호스팅에는 **`app/` 폴더만** 올리세요 — `.sql` 은 배포하지 말고 Supabase 대시보드에서만 실행합니다.

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
| 7 | `presence.sql` | 접속자 수 60초 하트비트(서버 수신·저장) | ⬜ 선택 |
| 8 | `security.sql` | **관리자 비밀번호 서버검증 + 열린 정책 잠금** — 위 파일들을 쓴다면 **맨 마지막에** 실행 | 🔴 **출시 필수** |
| 9 | `admin-extra.sql` | 관리자 **사용자 목록 / 토론 수정** 게이트 RPC — `security.sql` **다음에** 실행(미실행이어도 직접쿼리 폴백으로 동작) | ⬜ 선택 |
| 10 | `creator-attribution.sql` | 토론 카드·상세에 **만든이 닉네임** 표시용 컬럼 1개(`debates.creator_nick`). 조인 없이 기존 `select('*')`에 그대로 딸려와 쿼리 부하 0 | ⬜ 선택(미실행이어도 폴백으로 동작) |
| 11 | `best.sql` | **베스트 의견(개념글) + 명예의 전당** — `comments.like_count` 집계 컬럼+트리거. 상세에 공감 상위 의견 고정, 전당의 명언·논객 랭킹 활성화. 열린 정책을 만들지 않아 `security.sql` 전/후 언제 실행해도 안전 | ✅ 권장(미실행이어도 폴백으로 동작) |

각 파일을 안 돌려도 앱은 **정상 작동**합니다(자동 폴백). 단:
- `optimize.sql` 미실행 → 매 피드 로드마다 votes/comments 전체 집계(트래픽 ↑). 출시 전 권장.
- `analytics.sql` 미실행 → 관리자 "사용자 현황"이 추정 모드(DAU/WAU 대신 오늘 댓글·투표 수).
- `presence.sql` 미실행 → "현재 접속중" 숫자가 예전 Realtime Presence(웹소켓)로 동작. 실행하면 60초 하트비트 방식(서버가 60초에 1번 수신·저장)으로 전환.
- `security.sql` 미실행 → anon 키만으로 관리자 작업(삭제·제재·블라인드·공지·정리)을 직접 호출할 수 있는 **무방비 상태**입니다. 클라이언트 비밀번호 게이트는 콘솔에서 우회되므로 이 SQL이 유일한 실질 방어입니다. **공개 출시 전 반드시**(다른 SQL을 모두 돌린 뒤 마지막에) 실행해 그 구멍을 닫으세요.
- `best.sql` 미실행 → 상세의 베스트 의견은 첫 페이지에서 클라이언트 선정(부정확), 전당의 명언·논객 랭킹은 비활성화. 레전드 토론은 동작합니다.

> ⚠ `security.sql` 은 `announcements.sql`·`admin-actions.sql`·`cleanup.sql`·`extreme.sql`(사용하는 것들)을 실행한 **다음에** 돌려야 합니다. 그 파일들이 만든 열린 정책/인증 없는 RPC 권한을 회수하기 때문입니다.

---

## 2. 저장 용량(디스크) 관리

서버 저장량을 줄이는 건 `cleanup.sql` · `extreme.sql` 입니다 (`optimize.sql`은 트래픽용).

- **`extreme.sql` 을 1회 실행하면** 내장 pg_cron 이 매일 새벽 마감된 토론의 원본 행을 자동으로 비웁니다 — 그 뒤로는 아무것도 다시 안 돌려도 됩니다.
- pg_cron 이 꺼져 있으면(Database → Extensions) 관리자 페이지의 **[자동정리 지금 실행]** 버튼으로 수동 실행하세요.
- 실제 절감량은 관리자 → **데이터 관리** 탭의 바이트 수치를 정리 전후로 비교해 확인합니다.

---

## 3. 관리자 페이지

`admin.html` 진입 시 비밀번호 인증. 소스에는 **SHA-256 해시만** 저장돼 평문이 노출되지 않습니다.

관리자 페이지 기능:
- **신고 관리** — 신고 목록(전체/미처리/블라인드 필터) · 블라인드 · 댓글삭제 · 유저제재
- **토론 관리** — 제목 검색 + 카테고리·상태 필터 · 제목/카테고리/설명 **수정** · 마감/재개 · 삭제
- **사용자 관리** — DAU/WAU 통계 + **사용자 목록**(닉네임 검색·정지중 필터·댓글수) · 인라인 **정지/해제**
- **데이터 관리** — DB 용량 + 오래된 데이터 정리

> 사용자 목록·토론 수정은 `security.sql` 적용 환경에서 `admin-extra.sql` 의 게이트 RPC로 동작합니다. 둘 다 미설치면 직접 쿼리(폴백)로 그대로 동작합니다.

`security.sql` 을 실행하면 인증이 **서버에서도 검증**됩니다 — 게이트를 통과한 비밀번호가 모든 관리자 조치(삭제·제재·블라인드·공지·정리)의 게이트 RPC(`thj_admin_*`)로 전달돼 서버가 같은 해시로 확인하고, 인증 없이는 어떤 쓰기도 막힙니다.

**비밀번호 변경** — 새 비밀번호의 SHA-256 해시를 구해 두 곳에 반영합니다.
1. `admin.html` 의 `PW_HASH`
2. 서버: `update app_config set value='<새해시>' where key='admin_pw_hash';` (또는 `security.sql` 의 `thj_set_admin_pw` 호출)
```js
// 브라우저 콘솔에서 해시 구하기:
crypto.subtle.digest('SHA-256', new TextEncoder().encode('새비밀번호'))
  .then(b => console.log([...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('')));
```
> `security.sql` 의 기본 해시는 `admin.html` 의 기본 `PW_HASH` 와 같아, 별도 설정 없이도 기존 비밀번호가 클라이언트·서버 양쪽에서 그대로 동작합니다.

> **HTTPS 권장** — 비밀번호 해시 계산은 보안 컨텍스트(HTTPS·localhost)에서 가장 잘 동작합니다. HTTP·IP 주소로 접속하면 일부 브라우저가 `crypto.subtle` 을 막는데, 이를 대비해 순수 JS 폴백이 들어가 있어 그 경우에도 로그인은 됩니다. 다만 운영은 **HTTPS 호스팅**(Vercel/Netlify/Cloudflare Pages — 모두 기본 HTTPS)을 쓰세요.

---

## 4. API 키가 F12(개발자도구)에 보이는 것 — 정상입니다

`supabase.js` 의 `SUPABASE_URL` 과 `SUPABASE_KEY` 는 **숨길 수 없고, 숨길 필요도 없습니다.**

- 이 키는 이름 그대로 **publishable(공개용) anon 키**입니다. 모든 Supabase 웹앱이 브라우저에 그대로 싣는, 공개되도록 설계된 키예요. 난독화·서버숨김 같은 건 의미가 없습니다(어차피 네트워크 탭에 다 보임).
- **진짜 보안은 키가 아니라 RLS 정책**입니다. 키를 알아도 RLS 가 허용한 일만 할 수 있어요. `security.sql` 을 돌리면:
  - 삭제·제재·블라인드·공지·정리 = **관리자 비밀번호 게이트 RPC** 로만 가능 (서버가 비번 검증)
  - 신고 목록(신고자 신원) = 관리자만 (`thj_admin_reports`, anon 직접 조회 차단)
  - 관리자 비밀번호 해시·접속자 하트비트 테이블(`app_config`·`presence_pings`) = **anon 조회 불가**(RLS 정책 없음 = 기본 거부)
  - 모든 핵심 테이블 RLS 강제 + 남은 열린 쓰기 정책을 SQL 실행 로그(Messages)에 경고로 표시
- ⚠ **절대 클라이언트에 넣으면 안 되는 키**는 `service_role`(시크릿) 키입니다. 현재 코드엔 없습니다(확인 완료). `.env`/서버에서만 쓰고 절대 `supabase.js` 같은 프런트 파일에 넣지 마세요.
- 비밀번호 해시(`PW_HASH`)도 소스에 보이지만 **단방향 해시**라 평문이 드러나진 않습니다. `security.sql` 적용 후엔 서버 검증이 우선이라 소스의 해시는 폴백용일 뿐 — 원하면 `PW_HASH` 를 빈 문자열로 비워 클라이언트에서 완전히 없애도 됩니다(서버가 검증하므로 로그인은 그대로 동작). 단, **추측하기 쉬운 비밀번호는 피하세요**(해시가 보이면 약한 비번은 오프라인 대입이 가능).

---

## 5. 인앱 알림 (notifications.sql)

벨 아이콘 + 드롭다운 패널 + 실시간 + 브라우저 알림. `notifications.sql` 을 SQL Editor 에 붙여넣고 Run 하면 켜집니다(재실행 안전).

- **공감 알림** — 내 의견에 누가 공감(좋아요)하면 `'like'` 알림.
- **새 의견 알림** — 내가 참여한 토론에 새 댓글이 달리면 `'reply'` 알림. 참여자당 안읽음 1건으로 합쳐 행 폭증을 막습니다.
- **공지 broadcast** — 관리자 공지(`announcements`)가 별도 행 없이 벨 패널에 함께 표시됩니다(읽음은 기기별 localStorage).
- **실시간** — `notifications`·`announcements` 가 Realtime publication 에 추가돼 벨이 즉시 갱신됩니다.
- **브라우저 알림** — 탭이 백그라운드일 때 OS 알림으로 뜹니다(벨 패널의 “켜기”로 권한 허용). iOS 는 PWA 설치 후 지원.
- **용량 관리** — `select thj_purge_old_notifications(30);` 또는 pg_cron 이 켜져 있으면 매일 새벽 자동 정리.

> 의존: 공지를 쓰려면 `announcements.sql` 이 먼저 필요합니다. 미설치 시에도 개인 알림은 동작합니다.

---

## 6. 토론 주제 즉시 투입 (topics-seed.sql)

빈 피드는 첫 방문자의 100% 이탈로 이어집니다. `topics-seed.sql` 은 **진짜로 의견이 갈리는 접전 주제 50개**(정치·축구·연예·게임·사회·경제)를 투표 시드와 함께 한 번에 채웁니다.

- SQL Editor 에 붙여넣고 Run — 재실행해도 **중복 제목은 건너뜁니다**.
- 각 주제에 40~190명의 시드 투표가 40~60% 접전으로 자동 생성돼 50:50 으로 굳지 않습니다.
- 시의성 있는 주제로 바꾸려면 파일의 `values (...)` 목록만 교체하면 됩니다.
- 운영 중 새 주제는 앱의 **토론 열기**(create.html)로도 추가할 수 있습니다.

> 마케팅 실행 계획은 프로젝트 루트의 **`마케팅 전략.html`** 참고 (인쇄/공유용 1페이지).

---

## 7. 출시 전 체크리스트

- [ ] `supabase.js` 의 URL·KEY 가 운영 프로젝트로 설정됨
- [ ] 기본 스키마 + `seed-data.sql` + `optimize.sql` 실행 완료
- [ ] 관리자 비밀번호를 기본값에서 변경 (`PW_HASH` **+ 서버 `app_config`**)
- [ ] **`security.sql` 을 맨 마지막에 실행** — 관리자 작업을 비밀번호 게이트 RPC로 잠금
- [ ] 정적 호스팅에 `app/` 폴더 전체 업로드 (Vercel/Netlify/Cloudflare Pages 등)
- [ ] 공유 미리보기 확인 — 카카오톡/X 에 링크를 붙여 `og.png` 썸네일이 뜨는지
- [ ] (선택) `extreme.sql` 실행 + pg_cron 활성화로 디스크 자동 관리
- [ ] (선택) `announcements.sql` → `notifications.sql` 실행으로 인앱/브라우저 알림 켜기
- [ ] (선택) `topics-seed.sql` 실행으로 접전 주제 50개 + 투표 시드 투입

---

## 7. SEO · 정적 페이지 생성 (GitHub Pages 자동 배포)

순수 정적 호스팅은 서버 렌더링이 없어, 토론마다 **진짜 HTML 파일**을 미리 구워야
구글이 내용을 크롤링하고 공유 미리보기가 토론별로 뜹니다. 이 리포는 그걸 자동화합니다.

**구성**
- **경로 라우팅** — 상세 링크가 `…#d/<id>` 가 아니라 `…/d/<id>` (`share.js` · `app.js`).
  예전 `#d/`·`?d=` 링크도 `thjRouteId()` 가 함께 인식(하위호환).
- **`app/404.html`** — 아직 정적 페이지가 없는 새 토론 딥링크를 앱(`?d=<id>`)으로 보내는
  GitHub Pages 폴백. 앱이 상세를 열고 주소를 `/d/<id>` 로 정규화.
- **`scripts/build-seo.mjs`** — Supabase(anon 키, 라이브와 동일 읽기 경로)에서 `debates`·
  `comments` 를 읽어 토론마다 `app/d/<id>/index.html` 생성: 토론별 `<title>`·description·
  canonical·OG/트위터 카드·JSON-LD(QAPage)·찬반 집계·양측 대표 의견을 HTML 에 미리 구움.
  + `app/sitemap.xml` · `app/robots.txt` 자동 생성.
- **`.github/workflows/deploy.yml`** — main 푸시 / 3시간 cron / 수동 실행 시
  빌드 후 `app/` 를 GitHub Pages 로 배포.

**최초 1회 설정**
1. 리포 **Settings → Pages → Source: GitHub Actions** 로 변경.
2. (커스텀 도메인) **Settings → Secrets and variables → Actions → Variables** 에
   `SITE_ORIGIN` 추가 (예 `https://토론하자.kro.kr` 의 퓨니코드 `https://xn--6o2bu1z0rh3yd.kro.kr`).
   `app/CNAME` 에 도메인 한 줄도 커밋.
3. 푸시하면 Actions 가 빌드·배포. 이후 새 토론은 cron(최대 3h) 또는 수동 **Run workflow** 로 반영.

> **즉시 반영(선택):** Supabase **Database Webhooks** 에서 `debates` INSERT 시
> GitHub `repository_dispatch`(`event_type: rebuild`) 를 호출하면 새 토론이 바로 빌드됩니다.

**로컬 테스트:** `node scripts/build-seo.mjs` → `app/d/<id>/index.html` 확인.

> ⚠ RLS: 빌드는 `debates`·`comments` 의 **읽기(SELECT)** 가 anon 키에 열려 있어야 동작합니다
> (라이브 피드가 이미 그 키로 읽으므로 정상). 막혀 있으면 빌드가 데이터를 못 가져옵니다.

---

## 파일 구조

```
app/
├─ index.html · app.js          메인 피드 + 토론 상세
├─ 404.html                     SPA 딥링크 폴백 (GitHub Pages)
├─ d/<id>/index.html            ⚙ 자동생성 — 토론별 SEO 정적 페이지
├─ sitemap.xml · robots.txt     ⚙ 자동생성
├─ create.html · create.js      토론 생성
├─ admin.html · admin.js        관리자 (신고·토론·사용자·데이터)
├─ supabase.js                  데이터 계층 (서버 구동)
├─ share.js                     공유 + 딥링크 (외부 SDK 0)
├─ onboard.js                   첫 방문 온보딩 + 닉네임
├─ notify.js                    인앱 알림 (벨·패널·실시간·브라우저)
├─ icons.js · style.css         아이콘 스프라이트 · 디자인
├─ og.png · favicon-*.png       공유/탭 이미지
└─ site.webmanifest            PWA 매니페스트

sql/                            ⚠ 배포 제외 — Supabase SQL Editor 에서만 실행
└─ *.sql                        서버 설정 스크립트 (seed / optimize / security / notifications / topics-seed 등)

scripts/build-seo.mjs           ⚠ 배포 제외 — 토론별 정적 페이지·sitemap 생성기
.github/workflows/deploy.yml    GitHub Pages 빌드·배포 워크플로우
```
