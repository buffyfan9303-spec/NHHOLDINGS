# NHHOLDINGS

NURI ONE 통합 운영실과 NURI MARKET을 제공하는 Next.js 16 웹입니다. Node.js 24, Supabase PostgreSQL/Auth/Storage, Vercel을 사용합니다.

| 경로 | 용도 |
| --- | --- |
| `/`, `/nurimarket` | 쇼핑몰 |
| `/login` | 공통 로그인·이메일 인증 가입 |
| `/dashboard` | 서버에서 지정한 운영자 전용 통합 현황 |
| `/dashboard?sample=1` | 운영자 전용 가상 샘플 |
| `/nurimarket/admin` | 운영자 전용 쇼핑몰 관리 |

운영자 여부는 확인된 이메일과 서버 환경변수 `OPERATOR_USER_ID`를 모두 검사합니다. 일반 회원은 마켓으로 이동합니다. 모든 관리 API에서 다시 권한을 검사합니다.

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
- `/api/cron`은 `CRON_SECRET` Bearer 인증 후 5분마다 수집·예약을 실행합니다. 게시 응답이 불확실하거나 중단되면 확인 필요 상태로 남기며 자동 재게시하지 않습니다.
- 티스토리 사이트맵은 공개 글 조회에 사용합니다. GA 측정 ID만으로 분석 조회 권한이 생기지 않습니다. Google 서비스 계정 JSON과 숫자 GA4 속성 ID는 운영 화면에서 연결합니다. 티스토리 글쓰기는 발행 URL 직접 등록 방식입니다.
- 현재 마켓은 `MARKET_MODE=preview`입니다. 실제 결제·발송은 판매자 정보, 상품, 정책, PG 계약·키를 확인한 후 운영 모드로 전환합니다.

## 확인 기록

2026-10-07: 로컬 빌드, 금액·주문 통합 테스트, 클라우드 저장·재조회·트랜잭션·권한 검증, 320/390/768/1440px의 32개 화면 검증을 수행했습니다. 실제 SNS 게시, AI 과금 API, Google 분석 조회, 실결제는 계정 미연결로 검증하지 않았습니다.

Codex가 기존 마켓·대시보드 코드를 재사용해 통합했습니다. 인증·금액·배포를 함께 검증하기 위해 현재 호스트의 기본 모델을 사용했습니다. Supabase MCP/CLI와 Vercel MCP는 인증 및 실제 호출을 확인했고, GitHub는 인증된 Git CLI를 사용했습니다. Vercel CLI 인증은 사용하지 않았습니다. DNS는 가비아의 기존 로그인 세션에서 설정했습니다. 추가 플러그인·유료 API·hooks·별도 자동화는 설치하지 않았으며 예약은 기존 Vercel Cron 기능을 사용합니다.
