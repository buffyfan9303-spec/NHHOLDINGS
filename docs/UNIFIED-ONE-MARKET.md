# 누리원 + 누리마켓 통합 설계와 실행 계획 (2026-11-16)

이 문서는 nhholdings.xyz에서 NURI ONE(운영실)과 NURI MARKET(쇼핑몰)이 **제대로 같이 돌아가도록** 하는 설계서이자 Claude Code 작업 지시서다. 협업 규칙은 `AGENTS.md`·`docs/COLLAB.md`가 우선한다(Claude는 `claude/*`에서 작업, `main`·`codex/*`는 수정하지 않는다, 배포·실서비스 검증·`main` 통합은 Codex).

## 1. 현재 상태 (2026-11-16 직접 관측)

| 항목 | 관측 | 근거 |
|---|---|---|
| 도메인 | `nhholdings.xyz` apex는 Vercel(216.150.1.1), `www`는 Vercel CNAME + 308 → apex. 네임서버 가비아 | `dig`, `curl -I`, Vercel 도메인 목록 |
| 호스팅 | Vercel 프로젝트 `nhholdings`(팀 nuridream, Next.js 16, icn1). 운영 배포 = `main` `cd1fcbc`(2026-10-09). `codex/nuri-unified`의 이후 배포는 미리보기(target 없음). 운영 코드와 브랜치 코드는 docs 제외 차이 없음 | Vercel API, `git diff cd1fcbc HEAD` |
| DB | Supabase 프로젝트 `NHHOLDINGS`(ap-northeast-2). 테이블 20개 모두 RLS 켜짐. 상품·주문 0건, `nh_documents` 129건. 보안 어드바이저: 유출 비밀번호 보호 꺼짐 1건뿐 | Supabase 커넥터(읽기) |
| 쇼핑몰 | 운영 `mode: live`(NODE_ENV=production이면 live), 상품 0개. 준비 점검: DB만 true, 판매자·정책·상품·배송·PG·결제운영·개시승인 모두 false → **의도대로 닫힌 상태** | `/api/catalog` |
| 출처(Origin) 문 | `https://nhholdings.xyz`는 통과, `www`·외부 출처는 403 (www는 어차피 apex로 이동) | 빈 본문 POST `/api/orders` 3종 |
| 크론 | `vercel.json` `*/5 * * * *` → `/api/cron`. 비밀 없으면 401 | 코드 |
| 타입검사 | `npm run typecheck` 오류 없음(미리보기 브랜치 작업 트리) | 실행 |

### 확인된 문제
1. **soft 404**: 모든 미정의 경로가 HTTP 200으로 쇼핑몰 첫 화면 HTML을 돌려준다. `/robots.txt`·`/sitemap.xml`(검색엔진이 HTML을 받음), `/one`·`/market`(있는 페이지처럼 보임), `/api/nonexistent`·`/api/health`(JSON 대신 HTML). 원인: `src/app/[...slug]/page.tsx`가 모든 슬러그를 `Market`에 넘기고, 유효하지 않은 섹션은 클라이언트에서 `<Empty>`만 그린다(`src/components/market.tsx` 59행, 107행 부근). 유효 섹션: `home, search, wishlist, product, cart, checkout, my, order, payment, policy`.
2. **ONE→MARKET 연결은 이미 있으나 비어 있는 칸이 있다**: `src/lib/dashboard.ts`의 `collect({id:'market'})`가 같은 DB의 `mkt_orders`·`mkt_products`·`mkt_claims`를 SQL `count`로 직접 읽는다(주문 수, 오늘, 결제완료, 입금대기, 발송 대기, 환불, 체험 주문 `is_demo`, 실주문 = 전체 − 체험, 열린 클레임). 로컬 `NURI ONE`의 "최근 N건 과소 집계"와 비밀번호 파일 읽기 문제는 호스팅본에 없다. 다만 응답의 `monthly: []`, `inventory: []`, `readiness: []`가 항상 빈 값이라 로컬 ONE이 보여 주던 월별 주문 건수·재고·준비 상태가 호스팅 ONE에는 표시되지 않는다(표시 쪽 처리는 미확인).
3. **코드 분기(drift)**: Mac의 `NURI MARKET`(2026-10-07 샘플, 모의 환불)과 호스팅본은 비교한 13개 파일 중 10개가 다르다. 호스팅본이 더 진행됐다(PG 환불 멱등 `ClaimRefundAttempt`, 운영 모드 강제, 순차 쿼리). 로컬 `NURI ONE`에는 매출·비용·손익·사업장·거래처·업무 기능이 있으나 호스팅본에 같은 기능이 있는지는 **미확인**이다.
4. 관측하지 못한 것(미확인): 로그인된 `/dashboard`, 실제 SNS·AdSense 연동 동작, 결제 흐름, 크론 실행 이력, Vercel 플랜의 크론 5분 허용 여부, Supabase Auth의 사이트 URL·리다이렉트 설정.

## 2. 설계 결정

**D1. 정본은 이 저장소(NHHOLDINGS) 하나다.** 로컬 `NURI MARKET`·`NURI ONE`은 참고·샘플(레거시)로 둔다. 기능 이식은 6장의 패리티 점검 결과로 정하고, 두 코드를 기계적으로 합치지 않는다.

**D2. 같은 도메인, 경로 분리.** 공개 쇼핑몰(`/`, `/nurimarket/*`)과 비공개 운영실(`/login`, `/dashboard`, `/access-pending`, `/api/dashboard/*`)을 한 앱에서 유지한다. 경로는 명시적 허용 목록만 200이고 나머지는 진짜 404다. `/one`은 `/dashboard`로 보내는 별칭(리다이렉트)만 둔다. 하위 도메인 분리(`one.nhholdings.xyz`)는 쿠키·인증 범위를 분리할 수 있으나 가비아 DNS·Supabase Auth URL·쿠키 도메인 변경이 필요하므로 P2 결정 사항이다.

**D3. ONE↔MARKET 연결은 지금처럼 같은 DB 서버측 읽기 전용 집계로 유지하고, 빈 칸을 채운다.** HTTP 관리 API·관리자 비밀번호 파일 읽기 방식은 쓰지 않는다. `collect({id:'market'})`(`src/lib/dashboard.ts`)에 월별 주문 건수(KST), 상품별 재고 합계, 준비 점검 상태(`readiness`), 미답변 문의 수를 SQL 집계로 추가한다. 고객 이름·연락처·주소는 집계에 넣지 않는다. 실주문은 `is_demo=false`로만 센다. 실매출 합산은 PG 운영 검증 전까지 하지 않는다(기존 계약).

**D4. 모드와 개시는 게이트 뒤에 둔다.** 쇼핑몰은 준비 점검 7항목과 `LIVE_APPROVED`가 모두 충족되기 전까지 판매하지 않는다. 코드에서 모드를 바꾸지 않는다. 실결제·실환급은 사용자의 별도 지시와 PG 테스트 모드 검증 뒤에만 한다.

**D5. 비밀·권한.** 비밀은 서버 환경에만 둔다(`src/components`·클라이언트에 금지). 운영자는 이메일+`OPERATOR_USER_ID` 이중 확인을 유지한다. 새 서버 읽기 경로는 서비스롤 키를 서버 모듈에서만 사용한다.

## 3. 작업 목록 (우선순위·의존성·수용 기준)

상태는 `docs/ops/TASKS.json`이 정본이다. 완료 주장은 실행 증거로만 한다. 로컬 검증, 미리보기 배포 검증, 운영 검증, 사용자 입력이 필요한 외부 설정은 서로 다른 증거다.

### P0 — 동작 위생 (코드 위험 낮음, 먼저)
- **T1 soft 404 제거**: 서버에서 `slug[0]`이 허용 목록(`home, search, wishlist, product, cart, checkout, my, order, payment, policy`)이 아니면 `notFound()`. 먼저 실제 경로 배치를 확인한다: `/nurimarket`은 `src/proxy.ts`가 `/`로 rewrite, `/nurimarket/admin`·`/nurimarket/login`은 실제 페이지(`src/app/nurimarket/*`), `/admin`은 proxy가 `/nurimarket/admin`으로 리다이렉트, `public/one/`은 운영실 정적 자산(`/one/app.js`, `/one/fonts/*` 등). `market.tsx`의 `section === "admin"` 분기는 도달 가능성을 확인하고 허용 목록에 넣을지 정한다. `src/app/not-found.tsx`는 상태 404와 쇼핑몰 안내 화면. `/api/*` 미정의 경로는 JSON 404. 수용: 아래 6장 curl 표가 모두 기대값, 기존 유효 경로(`/`, `/product/x`, `/cart`, `/checkout`, `/my`, `/policy/x`, `/nurimarket/*`)는 변함없음, `npm run typecheck`·`npm test` 통과.
- **T2 robots·sitemap·health**: `src/app/robots.ts`(공개 쇼핑몰만 허용, `/login`·`/dashboard`·`/api`·`/nurimarket/admin` 차단), `src/app/sitemap.ts`(공개 정적 경로 + 공개 상품, 상품 0개여도 유효), `src/app/api/health/route.ts`(`{ok,commit,mode}`만, 비밀·개인정보 없음, `Cache-Control: no-store`). 수용: `/robots.txt`·`/sitemap.xml`의 content-type이 text/plain·xml, `/api/health` JSON 200.
- **T3 `/one` 별칭**: `next.config.ts` redirects로 **정확히 `/one`만** `/dashboard`(308, 로그인은 기존 흐름이 처리). `/one/*`은 `public/one`의 정적 자산(대시보드·로그인·승인대기 화면이 사용)이라 절대 리다이렉트하지 않는다. 수용: `/one`은 `/login`까지 이동, `/one/app.js`·`/one/fonts/pretendard.css`는 기존처럼 200.
- **T4 회귀 테스트**: T1~T3을 지키는 테스트를 `tests/`에 추가하고 `npm test`에 포함. 출처 문(허용/차단) 기존 동작을 고정하는 테스트도 포함(`ALLOWED_ORIGINS` 값은 읽지 않고 주입).

### P1 — 연결과 기능
- **T5 ONE 대시보드의 MARKET 집계 빈 칸 채우기** (D3). 먼저 `monthly`·`inventory`·`readiness`가 대시보드 화면(`src/server/dashboard.cjs`, `public/one/app.js`)에서 어떻게 소비되는지 읽고, 빈 배열일 때 화면이 무엇을 보여 주는지 확인한다. 수용: 샘플 모드와 실제 DB(읽기)에서 숫자가 SQL 직접 조회와 일치, 개인정보 필드 없음, 실패 시 마지막 성공값 보존·표시, 권한 없는 계정은 접근 불가, 기존 `collect` 필드 계약 불변.
- **T6 패리티 점검 → 이식 목록**: 로컬 `NURI ONE` 기능(매출·비용·손익, 월별 입력 완전성, 사업장, 거래처, 업무, 서비스별 탭)과 호스팅본 `/dashboard`를 대조해 표로 만든다. **이식 여부는 사용자 결정**이므로 목록과 권장안만 낸다.
- **T7 쇼핑몰 개시 준비**(사용자 입력 필요): 판매자 정보·사업자번호·통신판매번호·정책·배송 설정·상품 등록·PG(토스) 테스트 키. Claude는 입력 UI·검증·테스트 모드 흐름까지 만든다. 실결제 개시(`LIVE_APPROVED`)는 사용자 지시와 운영 검증 후 Codex가 한다. 법률·세무 문구는 전문가 확인 필요로 표시.
- **T8 운영 관측**: 크론 실행 이력과 Vercel 플랜의 크론 주기 허용을 읽기로 확인하고, 실패 시 대시보드에 상태를 표시.

### P2 — 구조 결정
- **T9 하위 도메인 분리 검토**(결정 문서만): 쿠키·Auth 리다이렉트·SEO·보안 이득과 변경 범위를 정리해 사용자에게 선택지를 낸다.
- **T10 로컬 레거시 폴더 정리**: README에 정본이 NHHOLDINGS임을 명시. 삭제·이동 금지.

## 4. 사용자만 할 수 있는 일
- Supabase 대시보드: 유출 비밀번호 보호 켜기(플랜 지원 여부 확인), Auth 사이트 URL·리다이렉트 확인.
- 쇼핑몰 개시 입력(판매자 정보·사업자 번호·PG 계약·상품 사진·정책 문구)과 개시 승인.
- 하위 도메인 분리를 원하면 가비아 DNS 레코드 추가 승인.

## 5. 하지 않는 것
- 운영 DB 쓰기, 실결제·실환급, `MARKET_MODE`·`LIVE_APPROVED` 변경, 환경변수 값 읽기, `main`·`codex/*` 수정, 새 유료 호출, 사용자 승인 없는 push.

## 6. 검증 표 (T1~T3 수용 기준)

| 요청 | 기대 |
|---|---|
| `GET /`, `/nurimarket`, `/product/{id}`, `/cart`, `/checkout`, `/my`, `/policy/{kind}` | 200 (기존과 동일) |
| `GET /robots.txt` | 200, `text/plain`, `/dashboard`·`/login`·`/api` 차단 |
| `GET /sitemap.xml` | 200, `application/xml` |
| `GET /api/health` | 200, JSON, 비밀 없음 |
| `GET /does-not-exist`, `/market`, `/api/nonexistent` | 404 (API는 JSON) |
| `GET /one` | 308 → `/dashboard` → 307 → `/login` |
| `GET /one/app.js`, `/one/fonts/pretendard.css` | 200 (정적 자산, 리다이렉트 금지) |
| `GET /nurimarket`, `/nurimarket/login`, `/nurimarket/admin` | 기존과 동일(`/nurimarket/admin`은 로그인 상태에 따라 로그인 화면 또는 관리자) |
| `GET /dashboard` (비로그인) | 307 → `/login` (기존) |
| `GET /api/dashboard/summary` (비로그인) | 401 JSON (기존) |
| `GET /api/cron` (비밀 없음) | 401 (기존). **검증 때 이 주소를 호출하지 않는다**(비밀 없이도 안전하지만 불필요) |

## 7. 진행 방식
1. `claude/unified-ops`에서 T1→T4(P0) 순서로 구현하고 `npm run typecheck`·`npm test`를 실행해 결과를 적는다.
2. 각 작업을 커밋하고 `docs/COLLAB.md`에 시작·종료·소유 파일·검사·남은 일을 기록한다.
3. Codex가 미리보기 배포·`main` 통합·운영 검증을 맡는다. Claude는 `main`을 건드리지 않는다.
4. P1은 P0 검증 뒤에 시작하되 T6·T7처럼 사용자 결정·입력이 필요한 항목은 질문 목록으로 정리해 보고한다.

## 8. 로컬 기능 대조와 운영 주소 선택 (2026-11-18 KST)

### 로컬 NURI ONE과 호스팅 NURI ONE

| 기능 | 로컬 원본 | 호스팅본 | 처리 |
|---|---|---|---|
| 매출·비용·손익 | 증빙 입력, 거래 고유번호, 취소 | 같은 입력을 사용하며 월별 손익과 이익률을 조회 | 기존 호스팅 경로 사용 |
| 월별 입력 완전성 | 서비스 자체와 직영 사업장별 확인 | 같은 확인 흐름, 거래 변경 시 확인 해제 | 기존 호스팅 경로 사용 |
| 사업장 | 서비스별 원천 관측, 직영 지정 | 사업장 화면과 직영 범위로 통합 집계 | 기존 호스팅 경로 사용 |
| 거래처 | 등록·수정·검색 | 서비스 범위와 연결된 거래처 관리 | 기존 호스팅 경로 사용 |
| 업무 | 등록·상태·기한 | 업무 목록과 서비스·사업장별 연결 | 기존 호스팅 경로 사용 |
| 서비스별 관리 | 개요·재무·운영·업무·거래처·콘텐츠·연결 | 같은 탭을 유지하고 MARKET 운영, SNS 승인함을 제공 | 운영용 호스팅본 사용 |
| 샘플·저장소 | 별도 샘플 로그인과 SQLite 저장소 | Supabase Auth와 PostgreSQL, 운영자·조회 전용 권한 구분 | 로컬 데이터 이식은 데이터 소유자가 필요 범위를 결정 |

개별 기능은 로컬과 호스팅 소스를 대조한 결과입니다. 운영 로그인 이후의 계정별 데이터와 변경 이력은 해당 세션에서 다시 확인합니다.

### 주소 구조

| 선택 | 영향과 확인할 항목 |
|---|---|
| 현재 `nhholdings.xyz/one` 유지 | 기존 `/dashboard` 및 이 호스트에서 발급되는 인증 쿠키를 사용. 쇼핑몰 푸터와 누리원, 쇼핑몰 관리자 이동에서 같은 운영 세션을 쓸 수 있음 |
| `one.nhholdings.xyz` 분리 | 별도 브라우저 원점. DNS·TLS·Vercel 별칭, Supabase 인증 허용 주소, OAuth 콜백, Passkey RP 설정, 서비스 워커, 출처 제한, 기존 별칭 연결과 로그인을 함께 검증해야 함 |

당장은 기존 주소를 사용합니다. 운영 사이트는 공개 경로로 검색을 허용하고, 운영실·관리자 경로는 인증과 검색 차단 설정을 적용합니다. 하위 도메인의 로그인 분리와 DNS 변경은 필요할 때 별도로 결정합니다.
