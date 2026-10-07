# NHHOLDINGS

NURI ONE 통합 운영실과 NURI MARKET을 제공하는 Next.js 16 웹입니다. Node.js 24, Supabase PostgreSQL/Auth/Storage, Vercel을 사용합니다.

| 경로 | 용도 |
| --- | --- |
| `/`, `/nurimarket` | 쇼핑몰 |
| `/login` | NURI ONE 로그인·승인 신청 |
| `/nurimarket/login` | 쇼핑몰 전용 로그인·가입 |
| `/access-pending` | 누리원 사용 승인 대기·권한 상태 |
| `/dashboard` | 운영자·승인된 조회 계정의 통합 현황 |
| `/dashboard?sample=1` | 승인 계정도 볼 수 있는 가상 샘플 · 변경은 운영자만 |
| `/nurimarket/admin` | 운영자 전용 쇼핑몰 관리 |

운영자 여부는 확인된 이메일과 서버 환경변수 `OPERATOR_USER_ID`를 모두 검사합니다. 쇼핑몰 로그인은 운영자만 대시보드로, 다른 계정은 마켓으로 이동합니다. 누리원 로그인은 이메일 인증과 운영자 승인을 모두 검사합니다. 승인 계정은 조회만 가능하며 매 요청에 권한을 다시 확인해 회수 즉시 차단합니다. 승인·거절·회수는 버전 충돌 검사와 감사 이력을 남깁니다. 모든 변경·쇼핑몰 관리 API는 운영자만 사용할 수 있습니다.

## 로컬 실행

```sh
npm ci
node scripts/setup.mjs
# .env.local에 .env.example의 연결값 입력
npm run dev
npm run typecheck
npm test
npm run build
# 별도 터미널에서 npm start 후, TEST_OWNER_PASSWORD를 로컬 환경변수로 지정
npm run test:browser
```

비밀키는 서버 환경에만 둡니다. `.private/`, `.env.local`, 실제 데이터, 사업자등록증 원본은 저장소에 넣지 않습니다. 테스트는 임시 인증 계정을 생성·정리하고 sample 작업공간에 가상 콘텐츠를 씁니다. 운영 금전 원장은 변경하지 않습니다.

## 운영 계약

- `db/schema.sql`은 마켓, `db/dashboard.sql`은 통합 운영 데이터입니다. `nh_web`은 앱용 제한 계정이며 브라우저의 anon/authenticated 역할에는 이 테이블 접근권한이 없습니다. 노출 테이블에는 RLS가 적용됩니다.
- `db/source-snapshots/*.sql`의 고정 집계 함수만 전용 계정에 허용합니다. 소스 CRM/HOLDEM의 고객 사업장 매출은 직영 지정 전에는 누리 매출에 포함하지 않습니다. 원장·수납·청구를 서로 합산하지 않습니다.
- `live`와 `sample` 작업공간은 구분됩니다. 샘플 게시·AI 생성은 외부 API를 호출하지 않습니다. 실환경 AI/SNS는 연결 설정과 확인된 계정이 있어야 실행됩니다.
- `/api/cron`은 `CRON_SECRET` Bearer 인증 후 5분마다 수집·예약과 미결제 주문 재고 예약 정리를 실행하고 마지막 실행 상태를 저장합니다. 게시 응답이 불확실하거나 중단되면 확인 필요 상태로 남기며 자동 재게시하지 않습니다.
- 티스토리 사이트맵은 공개 글 조회에 사용합니다. GA 측정 ID만으로 분석 조회 권한이 생기지 않습니다. Google 서비스 계정 JSON과 숫자 GA4 속성 ID는 운영 화면에서 연결합니다. 티스토리 글쓰기는 발행 URL 직접 등록 방식입니다.
- 현재 마켓은 `MARKET_MODE=preview`입니다. 실제 결제·발송은 판매자 정보, 상품, 정책, PG 계약·키를 확인한 후 운영 모드로 전환합니다.

## 확인 기록

2026-10-07: 로컬 빌드, 금액·주문 통합 테스트, 클라우드 저장·재조회·트랜잭션·권한 검증, 320/390/768/1440px의 32개 화면 검증을 수행했습니다. 실제 SNS 게시, AI 과금 API, Google 분석 조회, 실결제는 계정 미연결로 검증하지 않았습니다.

Codex가 기존 마켓·대시보드 코드를 재사용해 통합했습니다. 인증·금액·배포를 함께 검증하기 위해 현재 호스트의 기본 모델을 사용했습니다. Supabase MCP/CLI와 Vercel MCP는 인증 및 실제 호출을 확인했고, GitHub는 인증된 Git CLI를 사용했습니다. Vercel CLI 인증은 사용하지 않았습니다. DNS는 가비아의 기존 로그인 세션에서 설정했습니다. 추가 플러그인·유료 API·hooks·별도 자동화는 설치하지 않았으며 예약은 기존 Vercel Cron 기능을 사용합니다.

## 통합 설정과 자산

대시보드 `설정 · 계정 연결`에서 시스템 상태, 계정 승인, 쇼핑몰 운영, API·게시 계정을 관리합니다. SMTP 정보는 서버에서 암호화 보관하며 Supabase SMTP 적용·실제 발송 전까지 연결 준비로 표시합니다. SMTP 미연결 상태에서는 외부 일반 회원의 이메일 인증 발송을 완료했다고 볼 수 없습니다.

[자산·API 출처와 라이선스](THIRD_PARTY_NOTICES.md)에 상업 이용 가능한 Lucide·Fluent Emoji와 각 API의 요구 계정·요금 조건이 있습니다. API 키를 배포 코드나 브라우저에 넣지 않습니다.

2026-10-07 추가 작업 팀: 디자인 GPT-6.1 high(로그인·로고), 보안 GPT-6 Astra high(승인·회수·권한 검토), 자료 GPT-6.1 medium(공식 라이선스·API), 주 에이전트(통합·실제 흐름·배포). 높은 비용 모델은 지정된 보안 검토에만 사용했고 독립 파일 소유권으로 중복 편집을 줄였습니다. 기존 Node/Next·PostgreSQL·MCP·CLI·브라우저를 사용했으며 추가 라이브러리·유료 API·hooks는 설치하지 않았습니다. 실제 수용 기준은 승인 계정 조회200·변경403·회수 후 기존 세션403, 두 로그인 경로 구분, 반응형 넘침0과 콘솔 오류0입니다.

추가 검증 완료: `npm test` 3개 통합 시나리오 통과, TypeScript·Next production 빌드 통과, 실제 Supabase 계정 승인·CAS 충돌·조회 전용·즉시 회수 확인, 320/390/768/1440px 40개 화면 및 설정 4개 탭의 넘침0·콘솔 오류0. 아이콘 SVG 문법 오류와 단일 PostgreSQL 트랜잭션 안의 병렬 조회 경고를 수정했습니다. 49개 외부 SVG의 XML·SHA256·위험 내용 검사와 실제 비밀값 유출 검사도 통과했습니다. SMTP·실제 SNS 발행·AI 유료 호출·PG 결제는 미연결 또는 미활성 상태입니다.

2026-10-07 디자인 마감: 원본 벡터 워드마크·파비콘을 적용하고 차콜·민트 로그인, 메뉴 전환, 상품·입력·버튼 반응을 CSS 및 브라우저 View Transition으로 구현했습니다. `animate` 스킬을 사용했으며 외부 모션 라이브러리는 추가하지 않았습니다. 자동 데이터 갱신에는 등장 효과를 재생하지 않고 동작 줄이기 설정을 존중합니다. 회사 전화는 `070-8098-1727`로 설정·재조회했습니다.

Google 로그인은 `/api/auth/google` → Supabase → `/api/auth/callback`의 PKCE 흐름을 사용합니다. 10분 만료·암호화 HttpOnly 쿠키로 브라우저를 연결하고, 공급자 응답 뒤 실제 인증 사용자와 기존 운영자 UUID·이메일·승인 권한을 다시 검사합니다. 공급자 토큰은 브라우저에 반환하지 않습니다. Google 클라이언트 비밀값은 Supabase 인증 설정에만 적용하며 저장소·공개 화면에 넣지 않습니다. Google 콘솔의 승인된 리디렉션 URI는 `https://ytyrqzajjtovvywvadcf.supabase.co/auth/v1/callback`입니다. Supabase 설정을 CLI로 갱신할 때에는 `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID` 및 `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_SECRET` 환경변수가 필요합니다.

최종 검증: Google 콘솔 콜백 주소를 사용자 승인 후 저장·재조회했고, 실제 Google 운영자 로그인으로 대시보드에 진입했습니다. 기존 운영자 UUID가 유지되며 email·google identity 연결을 재조회했습니다. 로그인 직후 구형 로그인 폼이 잠깐 표시되던 부분을 로딩 상태로 교체했습니다. 빠른 연속 메뉴 전환과 reduced-motion 검증도 통과했습니다.
