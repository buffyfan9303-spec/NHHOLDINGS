# SNS·AI 계정 연결 준비 안내

확인일: 2026-10-07. 이 문서는 NURI ONE 운영자가 직접 준비할 계정과 발급 정보를 안내합니다. **연결 코드 준비, 운영 배포, 실제 계정 인증, 실제 게시 성공은 각각 별도 확인 대상입니다.** 현재 실제 SNS 계정·키가 없어 Instagram·Threads·X의 공식 동의, 토큰 갱신, 외부 게시까지 성공했다고 확인하지 않았습니다.

공통 도구·보안·팀 기준과 기존 운영 검증 기록은 [프로젝트 README](https://github.com/buffyfan9303-spec/NHHOLDINGS/blob/codex/nuri-unified/README.md)의 ‘운영 계약’, ‘확인 기록’, ‘통합 설정과 자산’을 따릅니다. 키와 비밀번호를 이 문서, 대화창, 공개 저장소에 적지 마세요.

## 먼저 준비할 것

### 글쓰기·디자인 초기 기준 (2026-10-08)

실제 저장된 규칙은 NURI ONE의 **프롬프트 · 반복 설정**에서 수정합니다. 공통 규칙과 채널별 규칙을 함께 사용하며, 변경은 이후 생성에 적용됩니다. 기존 글을 자동으로 덮어쓰지 않습니다.

| 채널 | 기본 작성·디자인 기준 |
| --- | --- |
| 블로그 | 한 검색 질문에 답하기 → 첫 문단에 답과 조건 → 필요한 단계·예시·출처. 본문은 흰 배경·네이비 글자, 18px·줄높이 1.85·최대 860px. 미리보기·HTML 본문 복사·문서 다운로드에 같은 읽기 스타일을 사용합니다. |
| Instagram | 1080×1350 카드 3장, 크림·차콜·앰버, 넓은 여백과 짧은 문장. 관심과 공감이 우선이며 서비스 홍보는 선택입니다. 현재 API 단일 이미지 게시와 수동 캐러셀을 구분합니다. |
| Threads | 한 장면·한 생각을 짧은 문단으로 구성합니다. Instagram 캡션을 그대로 복사하거나 반응을 강요하지 않습니다. 게시할 전용 프로필을 먼저 확인합니다. |

이미지는 설명에 도움이 될 때만 넣고 실제 화면과 설명용 삽화를 구분합니다. 상업 사용 권리, 정확한 대체 텍스트·캡션, 공개 이미지 로딩과 모바일 줄바꿈을 확인합니다. 티스토리에는 **HTML 본문**을 붙여 넣고 제목은 제목 칸에 입력합니다. 전체 HTML 문서의 메타·JSON-LD를 티스토리 본문에 붙여 넣지 않습니다. 플랫폼이 스타일을 제거할 수 있으므로 공개 결과를 다시 확인합니다.

SEO·GEO는 검증한 답변·근거·주체·조건·날짜를 기준으로 합니다. 제목·설명 길이와 편집 점수는 작업 가이드이며 검색 순위 기준이 아닙니다. 별도 AI 검색용 태그를 필수로 만들거나 노출을 보장하지 않습니다. [Google AI 검색 안내](https://developers.google.com/search/docs/appearance/ai-features), [제목 링크](https://developers.google.com/search/docs/appearance/title-link), [검색 설명](https://developers.google.com/search/docs/appearance/snippet)을 참고합니다.

발행 수·시각은 **발행 운영 설정**에서 관리합니다. 초기 목표는 하루 5편, 한국 시각 08·12·16·20·22시이며 검증된 검색 피크가 아닌 시험 일정입니다. 자료 부족·중복·품질 미달이면 수량을 채우려고 발행하지 않습니다. 초기 규칙 저장과 외부 자동 발행 활성화는 별개입니다.

### 발행 확인과 오류 대응 (2026-10-08)

티스토리 기본 편집기는 HTML을 붙여 넣을 때 CSS·글자 크기·대체 텍스트를 제거할 수 있습니다. 본문만 붙여 넣고 제목·카테고리를 따로 지정한 뒤 이미지 alt를 편집기에서 확인하세요. 미리보기와 공개 페이지의 제목 색상·배경·정렬·이미지 로딩·모바일 넘침을 각각 확인합니다. 어두운 박스에 검은 제목처럼 읽을 수 없는 결과가 있으면 다음 발행을 보류합니다.

| 표시·상황 | 확인 범위와 다음 행동 |
| --- | --- |
| 직접 게시 URL 등록 | 게시물을 외부에서 확인한 뒤 URL을 기록한 상태입니다. 공급자 API가 게시했다는 의미는 아닙니다. 동일 URL 재등록·오래된 저장본의 등록을 막습니다. |
| 티스토리 게시 확인 | 사이트맵에 글 URL이 포함됐는지 확인합니다. 본문·이미지 품질과 검색 색인은 별도 확인합니다. |
| SNS API 게시 완료 | 실제 게시 결과 ID를 받은 상태입니다. 공급자에서 공개 글과 대상 계정을 다시 확인합니다. |
| 응답 중단·잘못된 성공 응답 | ‘확인 필요’로 보관하고 자동 재전송하지 않습니다. 채널에서 게시 유무를 먼저 확인합니다. |

X 길이는 [공식 twitter-text](https://github.com/twitter/twitter-text)의 URL·이모지 가중 계산을 사용합니다. Instagram API는 현재 단일 이미지이며 캐러셀·영상 게시와 구분합니다. 글·이미지 생성은 기존 구독 도구를 사용할 수 있지만 Claude·ChatGPT 구독과 서버 API 연결은 별도입니다. 추가 과금이나 크레딧 구매를 자동 활성화하지 않습니다.

이번 보완은 기존 Git·NPM·CUA·Supabase/Vercel MCP와 앱 자동화를 재사용했습니다. 공식 `twitter-text` 3.1.0(Apache-2.0)만 추가했으며 새 플러그인·hooks·외부 계정은 만들지 않았습니다. UI 담당은 `public/one/app.js`·`studio.js`, 보안 담당은 `src/server/dashboard.cjs`·발행 회귀 검사, 글자 수 담당은 `content-tools.cjs`·`tests/x-text.cjs`를 맡았습니다. 좁은 탐색/UI 작업은 gpt-6-luna low/medium, 동시성·성공 판정은 gpt-6.1-sol high로 제한했습니다. 주 에이전트가 빌드·배포·실제 화면을 통합 확인하며, 모의 API 테스트는 실제 계정 게시 성공을 대신하지 않습니다.

처음에는 SNS 전용 Instagram·Threads·X 계정을 **각 1개씩** 준비하면 충분합니다. SNS 자동화·수익화는 다른 누리 서비스와 독립 운영하며, 서비스는 SNS로 고정됩니다. ‘계정 표시 이름’은 운영자가 알아보기 위한 이름입니다. 실제 게시 대상은 공식 동의 후 확인된 SNS 계정입니다. 기존 웹사이트 현황 조회는 유지합니다.

- 회사가 관리하는 로그인 이메일과 계정 복구 수단을 확인합니다. 가능하면 다중 인증을 설정합니다.
- Instagram은 비즈니스 또는 크리에이터 계정으로 준비합니다. Threads는 게시할 실제 프로필을 준비합니다.
- Meta 개발자 계정에서 Instagram Login·Threads 앱을, X Developer Portal에서 OAuth 2.0 앱을 준비합니다.
- AI 초안이 필요하면 OpenAI API 프로젝트·결제 설정·프로젝트 API 키를 준비합니다. ChatGPT 유료 구독만으로 API 사용 권한이나 크레딧이 생기지 않습니다.
- WordPress를 쓴다면 사이트 관리자에게 HTTPS 사이트 주소, 게시 권한 사용자명, Application Password를 요청합니다. 티스토리는 기존 계정으로 직접 발행합니다.

## NURI에서 연결하는 순서

운영 설정은 **앱 설정 저장 → SNS 고정·계정 표시 이름 입력 → SNS 계정 연결 → 공식 동의 → 연결 결과 확인** 흐름으로 준비합니다. 화면과 API 통합·배포 여부는 운영자가 확인한 뒤 사용하세요.

1. `설정 · 계정 연결`에서 공급자별 Client ID와 Client Secret을 입력합니다. 서버에서 암호화 보관하며, 저장 후 비밀값 원문을 공개 화면에 다시 표시하지 않습니다.
2. SNS 독립 운영 표시를 확인하고 `회사 공용 Instagram`처럼 구분 가능한 계정 표시 이름을 적습니다.
3. `SNS 계정 연결`을 눌러 해당 SNS의 **공식 동의창**을 엽니다. 게시할 회사 계정인지 확인하고 필요한 권한을 허용합니다.
4. NURI로 돌아온 뒤 실제 사용자명·계정 ID와 연결 상태를 확인합니다. 표시 이름만 저장되거나 버튼을 눌렀다는 사실은 인증 성공의 증거가 아닙니다.
5. 운영자가 승인한 테스트 콘텐츠 1건으로 실제 게시와 외부 URL을 확인합니다. 연결·갱신·게시 실패는 각각 구분해 처리합니다.

Instagram·Threads·X의 액세스 토큰을 개발자 도구에서 직접 복사해 붙이는 절차는 기본 연결 방식이 아닙니다. 공식 동의 결과로 서버가 토큰을 발급·보관하고, 유효한 갱신 조건에서 갱신하도록 준비합니다.

### 입력 필드

| 공급자 | 사용자가 준비할 필드 | 주의점 |
| --- | --- | --- |
| Instagram | Instagram App ID를 Client ID로, Instagram App Secret을 Client Secret으로 입력 | Instagram Login 제품의 값을 사용합니다. Meta 앱의 다른 제품 ID와 혼동하지 마세요. |
| Threads | Threads App ID를 Client ID로, Threads App Secret을 Client Secret으로 입력 | Threads 제품에 표시되는 앱 자격 증명을 사용합니다. |
| X | OAuth 2.0 Client ID·Client Secret | API Key·API Key Secret이나 앱 전용 Bearer Token과 다릅니다. |
| 공통 SNS 계정 | 서비스·계정 표시 이름 | 실제 사용자명·계정 ID는 공식 인증 응답으로 확인합니다. |
| WordPress | HTTPS 사이트 주소·게시 사용자명·Application Password | 일반 로그인 비밀번호 대신 별도로 발급한 Application Password를 입력합니다. |
| 티스토리 | 블로그 주소·발행 후 글 URL | 종료된 글쓰기 API의 키나 토큰을 준비할 필요가 없습니다. |
| OpenAI | 프로젝트 API 키·사용할 모델·AI 사용 동의 | NURI 설정에 입력합니다. 모델의 Chat Completions JSON 응답 지원과 API 지출 범위를 확인합니다. |

### 콜백 주소 — 그대로 등록

| 공급자 | 승인된 리디렉션·OAuth 콜백 URL | 요청 권한 |
| --- | --- | --- |
| Instagram | `https://nhholdings.xyz/api/social/instagram` | `instagram_business_basic`, `instagram_business_content_publish` |
| Threads | `https://nhholdings.xyz/api/social/threads` | `threads_basic`, `threads_content_publish` |
| X | `https://nhholdings.xyz/api/social/x` | `tweet.read`, `tweet.write`, `users.read`, `offline.access` |

위 경로는 연결 시작 `POST`와 공급자가 돌아오는 콜백 `GET`에 함께 사용됩니다. 개발자 콘솔에는 **HTTPS·도메인·경로·끝 슬래시까지 동일한 URL**을 등록하세요. 주소창에서 콜백을 직접 열어도 연결되지 않습니다. NURI 설정의 연결 버튼으로 시작해야 합니다. Google 로그인용 Supabase 콜백과 SNS 콜백은 서로 다릅니다.

## Instagram: 전문 계정과 Instagram Login

1. 게시할 Instagram 계정을 비즈니스 또는 크리에이터 계정으로 전환합니다. 이번 연결은 **Instagram Login 방식**으로, Facebook 페이지 연결이 필수 조건이 아닙니다. [공식 개요](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/)
2. Meta for Developers에서 회사가 관리할 앱을 만들거나 기존 앱에 Instagram Login 구성을 추가합니다. 콘솔의 제품·사용 사례 명칭은 변경될 수 있으므로 Instagram Login 문서를 기준으로 선택합니다.
3. Instagram 제품의 앱 ID와 비밀값을 확인하고 위 Instagram 콜백을 등록합니다. 앱 도메인·공개 개인정보처리방침·데이터 삭제 안내 등 콘솔에서 요구하는 정보를 실제 운영 URL로 입력합니다.
4. `instagram_business_basic`, `instagram_business_content_publish`를 요청하도록 구성합니다. 예전 `business_*` 권한 이름이나 Facebook Login용 권한 목록을 대신 입력하지 마세요. [공식 Meta Instagram 예제](https://www.postman.com/meta/workspace/instagram/documentation/23987686-9386f468-7714-490f-9bfc-9442db5c8f00)
5. 개발 모드에서는 앱 역할·테스터로 허용된 계정인지 확인하고 필요한 초대를 수락합니다. 외부 계정에 공개할 때는 해당 앱의 권한 수준·앱 검수·사업자 확인 요구를 콘솔에서 완료합니다. 회사 계정이라는 이유만으로 검수가 자동 면제되는 것은 아닙니다.
6. NURI에 앱 자격 증명을 저장하고 계정 표시 이름을 입력한 뒤 공식 동의를 진행합니다. 돌아온 실제 Instagram 사용자명이 맞는지 확인합니다.
7. 승인한 이미지 1장과 본문으로 테스트합니다. 현재 게시 코드는 단일 이미지와 캡션용입니다. 이미지 주소는 Instagram 서버가 읽을 수 있는 HTTPS 주소여야 합니다. AI 초안 생성은 이미지를 자동으로 만들어 주지 않으며, 캐러셀·릴스·영상 게시까지 구현됐다고 간주하지 마세요.

## Threads: 프로필과 앱 자격 증명

1. 회사 Threads 프로필에 로그인할 수 있는지 확인합니다. Meta 앱에서 Threads API 구성을 준비합니다.
2. **Threads App ID·Threads App Secret**을 확인하고 위 Threads 콜백을 등록합니다. 일반 Meta 앱 ID와 Threads 제품 값을 혼동하지 마세요.
3. `threads_basic`, `threads_content_publish`를 요청합니다. 개발 모드의 역할·테스터 초대와 공개 사용에 필요한 검수·접근 수준을 확인합니다. [공식 시작 안내](https://developers.facebook.com/docs/threads/get-started/)
4. NURI에 앱 자격 증명을 저장한 뒤 계정 표시 이름을 입력하고 회사 Threads 계정으로 동의합니다.
5. 실제 사용자명과 연결 결과를 확인하고 승인된 텍스트 1건의 외부 게시 URL을 확인합니다. 현재 연결된 게시 경로는 텍스트 게시 기준입니다. [공식 Meta Threads API 예제·토큰 안내](https://www.postman.com/meta/threads/documentation/dht3nzz/threads-api)

## X: OAuth 2.0과 별도 API 사용 요금

1. 회사 X 계정과 X Developer Portal의 앱을 준비합니다. 개발자 포털의 API 이용 가능 상태와 청구·지출 한도를 확인합니다. **X Premium 구독과 X API 이용 요금은 별개**입니다. 비용은 변동하므로 [공식 API 가격·청구 안내](https://docs.x.com/x-api/getting-started/pricing)에서 확인하세요. 이 작업은 유료 크레딧 구매나 자동 충전을 켜지 않습니다.
2. 앱의 User authentication 설정에서 OAuth 2.0을 구성합니다. 서버에서 비밀값을 보관하는 Web App 유형에 맞춰 설정하고 위 X 콜백과 실제 웹사이트 URL을 등록합니다.
3. OAuth 2.0 **Client ID·Client Secret**을 발급합니다. API Key·Secret, 앱 전용 Bearer Token은 이번 사용자 동의 연결의 대체값이 아닙니다.
4. NURI가 `tweet.read tweet.write users.read offline.access` 권한을 요청합니다. `offline.access`는 이후 갱신 토큰을 받기 위해 필요합니다. NURI는 PKCE를 사용합니다. [공식 OAuth 2.0 Authorization Code·PKCE 안내](https://docs.x.com/fundamentals/authentication/oauth-2-0/authorization-code)
5. 앱 자격 증명을 NURI에 저장하고 실제 회사 X 계정으로 동의합니다. 연결된 사용자명·계정 ID를 확인합니다.
6. 승인한 텍스트 1건을 게시하고 X의 실제 게시 URL을 확인합니다. API 사용 권한·결제 상태·쓰기 권한이 충족되지 않으면 계정 로그인에 성공해도 게시가 실패할 수 있습니다.

## WordPress: 별도 Application Password

1. 운영할 사이트가 HTTPS로 열리고 WordPress REST API를 사용할 수 있는지 확인합니다.
2. 게시 권한이 있는 WordPress 사용자로 로그인해 사용자 프로필의 Application Passwords에서 `NURI ONE`용 비밀번호를 새로 발급합니다. 지원하지 않는 경우 호스팅·보안 플러그인 설정을 관리자에게 확인합니다.
3. 사이트 주소·사용자명·발급된 Application Password를 NURI 설정에 입력합니다. 일반 로그인 비밀번호를 공유하지 않습니다.
4. 권한 있는 테스트 글의 저장·발행 결과와 실제 URL을 확인합니다. 이 연결은 SNS OAuth와 별도로 동작합니다. [WordPress 공식 REST API 인증 안내](https://developer.wordpress.org/rest-api/using-the-rest-api/authentication/)

## 티스토리: 초안 복사 후 직접 발행

티스토리는 Open API 종료를 공식 공지했습니다. NURI에서 티스토리용 API 키를 발급하거나 자동 글쓰기 OAuth를 연결하는 절차를 안내하지 않습니다. [티스토리 공식 종료 공지](https://notice.tistory.com/2664)

1. NURI에서 AI 초안을 생성하거나 본문을 작성합니다.
2. 제목·본문을 복사해 티스토리 글쓰기 화면에 붙여 넣고 이미지·링크·공개 범위를 검토합니다.
3. 티스토리에서 사용자가 직접 발행합니다.
4. 실제 공개 글을 열어 제목·본문을 확인한 뒤 발행 URL을 NURI에 등록합니다. URL 저장과 외부 글 확인 전에는 ‘자동 게시 성공’으로 표시하지 않습니다.

공개 사이트맵을 읽어 기존 글을 조회하는 기능과 새 글을 작성·발행하는 기능은 다릅니다. 수동 발행 경로는 기존 게시 내역·일정 관리와 함께 사용합니다.

## OpenAI: 텍스트 초안용 API 키

1. OpenAI API 플랫폼에서 회사 프로젝트·결제 상태·사용 한도를 확인합니다. ChatGPT 구독 비용과 API 사용 비용은 별개입니다. [공식 API 가격](https://developers.openai.com/api/docs/pricing)
2. 해당 프로젝트의 API 키를 발급합니다. 필요 권한만 부여하고 회사의 승인된 사용 한도를 정합니다. [API 키 관리](https://platform.openai.com/api-keys)
3. 키를 대화창으로 보내지 말고 NURI의 AI 설정에 입력합니다. 공급자·모델을 선택하고 AI 사용에 동의합니다. 현재 서버는 `Chat Completions`의 `response_format: json_object`로 텍스트 JSON을 요청하므로 선택 모델의 지원 여부를 확인합니다.
4. 승인된 소량의 테스트 요청으로 초안 생성·저장·재조회와 API 사용량을 확인합니다. 실제 청구 API 호출 검증 전에는 연결 준비와 생성 성공을 구분합니다.
5. 제목·본문·해시태그를 검토한 뒤 게시합니다. **현재 이미지·영상·음성 생성은 구현하지 않았습니다.** Instagram용 이미지는 직접 준비해야 하며, 다른 이미지 API의 키가 있다고 자동 연결되는 것도 아닙니다.

Anthropic을 사용할 때도 별도 API 계정·키·결제 확인이 필요합니다. 기존 코드와 모델 지원 여부를 설정에서 확인하세요. [Anthropic API 안내](https://docs.anthropic.com/en/docs/intro-to-claude), [공식 가격](https://www.anthropic.com/pricing)

## 만료·연결 해제·실패 처리

- 서버는 공급자별 만료 정보와 갱신 조건에 맞춰 토큰 갱신을 준비합니다. 갱신 코드가 있다는 사실만으로 실제 계정의 장기 연결이 검증된 것은 아닙니다.
- 권한 철회, 비밀번호 변경, 앱 설정 변경, 계정 제한, 토큰 만료가 발생하면 공식 동의를 다시 진행해야 할 수 있습니다. 새 토큰을 채팅으로 전달하지 마세요.
- 토큰 갱신 실패를 게시 성공으로 표시하지 않습니다. 재연결 후 실제 계정과 대기 콘텐츠를 확인합니다.
- 게시 응답이 중단되거나 불확실하면 먼저 SNS에서 실제 글이 생성됐는지 확인합니다. 중복 게시 위험이 있으므로 확인 없이 반복 발행하지 않습니다.
- 앱 비밀값을 변경하면 NURI 설정도 갱신하고 다시 연결 상태를 확인합니다. 계정 연결 해제와 공급자 측 앱 권한 철회는 각각 확인합니다.

## 지금 사용자가 할 일과 확인 기준

| 순서 | 사용자 준비·확인 | 완료 증거 |
| --- | --- | --- |
| 1 | 회사 공용 Instagram 전문 계정·Threads·X 선택 | 실제 로그인 가능, 회사 관리 이메일·복구 수단 확인 |
| 2 | Meta·X 앱 생성 및 콜백·권한 등록 | 콘솔에서 정확한 ID·콜백·권한을 재확인 |
| 3 | 필요 시 검수·역할·테스터 초대 완료 | 연결할 계정이 앱을 이용할 수 있는 상태 |
| 4 | 앱 비밀값을 NURI 설정에 저장 | 저장 후 비밀값 원문 노출 없이 설정 상태 확인 |
| 5 | 서비스·표시 이름 선택 후 공식 동의 | 실제 SNS 사용자명·계정 ID 저장·재조회 |
| 6 | 승인한 테스트 게시·갱신 확인 | 외부 게시 URL 및 공급자 응답을 대조, 갱신 결과 확인 |
| 선택 | WordPress·OpenAI 연결 | 실제 글 URL 또는 텍스트 초안 저장·재조회·사용량 확인 |

Google로 NURI에 로그인했다는 사실만으로 SNS 게시 권한이나 GA4·Search Console 조회 권한이 생기지 않습니다. 분석을 사용할 때는 별도 API 활성화·서비스 계정 권한·숫자 GA4 속성 ID 또는 정확한 Search Console 속성 주소를 준비합니다. 기존 Supabase·Vercel 운영 프로젝트를 중복 생성할 필요는 없습니다. SMTP는 발송 서비스·도메인 인증·서버 연결 설정 후 실제 인증 메일 도착까지 확인해야 합니다.

## 이 안내의 범위·도구·검증

담당 파일은 `src/lib/integration-catalog.ts`와 `public/docs/sns-setup.md`입니다. 자료 담당은 12개 연동 항목과 앱 발급 절차·공식 문서를 정리하며, 주 에이전트가 OAuth·토큰 갱신·설정 화면·보안·배포를 통합합니다. 기존 팀의 모델 배정은 디자인 GPT-6.1 high, 자료 GPT-6.1 medium, 주 에이전트 통합과 지정된 GPT-6 Astra high 보안 검토로 제한해 중복 비용을 줄였습니다.

이번 작업은 기존 Node·Git·Next.js·PostgreSQL·CUA 브라우저·MCP 환경을 재사용합니다. 이 안내 작성에는 로컬 코드 확인, Git/Node CLI와 공식 웹 문서 조회를 사용했습니다. 인증된 Git CLI, 실제 Supabase·Vercel 운영 연결의 기존 확인 기록은 README에 있습니다. 사용 가능한 호출 도구에서 Meta·X·Postiz 전용 MCP는 확인되지 않아 해당 도구의 설치·인증·호출 성공을 주장하지 않습니다. 추가 설치, hooks·별도 자동화, 외부 계정 생성, 유료 API 호출이나 운영 설정 변경은 하지 않았습니다. 예약 실행은 프로젝트의 기존 Vercel Cron 범위입니다.

수용 기준은 카탈로그 12개 항목 유지, 항목별 요약 3~5단계, 위 세 콜백·권한과 서버 코드 일치, 비밀값 없는 공개 안내, TypeScript 확인입니다. **실제 SNS 인증·갱신·게시, AI 유료 생성, SMTP 발송은 사용자 계정 준비 후 별도 실검증해야 합니다.** Meta 개발자 문서의 직접 조회가 일시 제한된 부분은 공식 Meta Postman 문서와 기존 서버 코드를 대조했으며, 실제 앱 콘솔에서 요구하는 최신 검수 조건을 연결 시 다시 확인합니다.
