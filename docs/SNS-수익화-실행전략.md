# NURI ONE SNS 수익화 실행 전략

> **이 문서는 2026-10-07의 이전 범위 조사 기록이다. 실행 기준은 [월 운영이익 300만원 계획](../public/docs/sns-monetization.md)으로 대체한다.** 현재 대상은 티스토리·Instagram·Threads, 수입은 광고·제휴·협찬이다. 아래 자체 판매·상담·신규 SNS 제안은 실행하지 않는다. 미연결·미승인 수익의 현재 실적은 0이 아니라 미확인이며, 새 경로의 예상 계산과 구분한다. 금액·API 단가·자격 조건은 실행 시 공식 원문을 다시 확인한다.

조사 기준일: 2026-10-07. 대상은 국내에서 운영자 1명과 동료 2명이 운영하는 NURI ONE 콘텐츠 운영 도구다. 외부 계정·앱·결제 크레딧은 만들거나 활성화하지 않았다. 공식 플랫폼 문서와 도움말을 근거로 한 계획이며 수익·노출·승인을 보장하지 않는다.

## 현재 상태와 수익 목표

저장소 README에 따르면 게시 예약·상태, Instagram·Threads·X OAuth 코드, WordPress 자동 발행, 티스토리 발행 URL 등록, 사이트맵·GA4·Search Console 조회가 구현되어 있다. 다만 코드·설정 화면이 있다는 사실과 실제 승인·계정 연결·공개 게시 성공은 다르다. README는 Meta·X 앱 미연결과 실제 게시 미검증을 기록한다. Facebook·YouTube·TikTok·Pinterest·LinkedIn은 이번 작업에서 초안·직접 게시 URL 관리 대상으로 추가했다. 공식 자동 게시 API 연동은 구현·검증하지 않았다.

사용자 최신 지시에 따라 NURI CRM·MIND·HOLDEM·MARKET과 SNS 자동화·수익화는 연결하지 않는다. 기존 웹사이트 현황 조회는 유지한다. SNS 캠페인·초안·실적은 독립 SNS 범위에서 운영하며 다른 서비스 데이터에 쓰지 않는다. 초기 목표는 플랫폼 지급에 기대기보다 **독립 원본 콘텐츠 → 검색/SNS 유입 → 콘텐츠 사업의 상품·제휴·상담 → 실제 전환**을 추적하는 것이다. 매출 경로는 자체 판매, 리드·제휴, 제휴 수수료, 플랫폼 광고/크리에이터 직접 보상 순으로 검증한다. 플랫폼 직접 보상은 자격·초대·심사·조회 규모 때문에 초기 계획에 매출로 넣지 않는다.

## 채널별 게시·수익 조건

| 채널 | 게시 API 및 필요 계정 | 직접 보상과 외부 전환 | 비용·승인 및 판단 |
|---|---|---|---|
| **티스토리/블로그** | 티스토리 Open API는 글쓰기·수정·첨부·댓글 기능까지 종료 공지됨. RSS/사이트맵 조회와 공개 글 URL 등록은 가능하나 게시물은 티스토리 에디터에서 사람이 발행. WordPress는 앱 연동 코드가 있지만 실제 게시 검증은 별도. | AdSense 승인 후 광고 수익, 제휴 링크, 자체 서비스/상품, 문의·견적 유입. | 티스토리 자동 발행 불가. AdSense는 독창적이고 유용한 콘텐츠, 사이트 HTML/광고코드 접근, 정책 준수와 사이트 심사가 필요하며 승인은 보장되지 않는다. [종료 공지](https://notice.tistory.com/2664) · [AdSense 자격](https://support.google.com/adsense/answer/9724) |
| **Instagram** | Business/Creator 프로 계정. Meta API의 Facebook 로그인 방식은 연결된 Facebook Page가 필요하며, Instagram Login은 별도 경로다. Meta 앱·게시 권한·계정별 OAuth 동의 필요. 게시 권한 이름은 경로별로 달라 실제 신청 시 확인. | 협찬·무상 제공·제휴 관계는 파트너십/유료 콘텐츠 표기, 자체 상품·서비스는 프로필/랜딩 유입. | 호출 요금표는 공식 자료에서 확인하지 못함(무료라고 단정하지 않음). 앱 역할 사용자 테스트와 외부 사용자 운영의 App Review/Advanced Access를 구분. 콘텐츠 코드가 있으므로 승인·실계정 확인 후 기존 연동을 우선 검증. [공식 API 컬렉션](https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api) · [파트너십 표기](https://www.facebook.com/help/instagram/616901995832907?locale=en_GB) |
| **Threads** | Meta 앱의 Threads 사용 사례, threads_basic 및 threads_content_publish 등 권한, 사용자 OAuth 동의. | 외부 랜딩·리드·자체 판매. 일반 게시 기반 상시 크리에이터 보상 경로는 확인하지 못함. | 공식 호출료 공개표 확인 못함. Instagram 문구 복제 대신 글쓴이 의견·대화형으로 재작성. 기존 OAuth 코드를 계정 3개로 시험한 뒤 공개 자동화. [API](https://www.postman.com/meta/threads/documentation/dht3nzz/threads-api) · [변경 기록](https://developers.facebook.com/docs/threads/changelog) |
| **Facebook Page** | Pages API/Page 토큰, pages_manage_posts 등 권한, 운영자 Page 역할. 앱 역할 외 사용자 운영에는 Advanced Access와 앱 심사가 필요할 수 있음. | Facebook Content Monetization은 영상·사진·텍스트 성과 기반이지만 초대형. 소규모 팀은 자체 판매·상담·협찬 우선. | 공식 API 호출료는 확인 못함. 초대 전 직접 수익으로 계산하지 말고 Professional Dashboard에서 자격 확인. [공식 수익화 공지](https://about.fb.com/news/2026/03/creator-fast-track-grow-your-audience-earn-money-on-facebook/) |
| **X** | X API 앱+사용자 OAuth. 현재 사용량 기반 크레딧: 게시 1회 $0.015, URL 포함 게시 $0.20, 일반 Post 읽기 건당 $0.005, 내 데이터 Owned Read $0.001. 가격은 변경될 수 있음. | 외부 리드/판매 우선. 2026-09 시작한 Original Content Rewards는 한국 포함, Premium 구독, 최근 90일 인증 사용자 홈 피드 노출 50만, 인증 팔로워 500명과 신청 심사 등 필요. 본인 관점의 원본이어야 하고 자동 생성/자동 게시 콘텐츠는 보상 대상에서 제외됨. | 구 Creator Revenue Sharing 신규 모집은 2026-08-07 종료, 09-07 종료. 보상을 노리는 계정은 앱 자동발행 대신 사람이 작성·게시. URL 게시 단가가 커서 초기 우선순위 낮음. [가격](https://docs.x.com/x-api/getting-started/pricing) · [새 보상 기준](https://help.x.com/en/using-x/original-content-rewards) |
| **YouTube** | Data API videos.insert, Google Cloud 프로젝트/API 활성화, youtube.upload OAuth. 미검증 API 프로젝트 업로드는 비공개로 제한; 공개 해제는 API Terms 준수 감사 필요. 기본 할당량은 API Console 확인, 추가 할당은 감사. | YPP 확대: 구독자 500+최근 90일 공개 업로드 3개+공개 시청 3,000시간 또는 Shorts 300만으로 일부 팬 후원/쇼핑 기능 신청. 광고 수익배분은 1,000 구독자+4,000시간 또는 Shorts 1,000만. 한국 YouTube Shopping 제휴도 가능하나 YPP 및 자격/초대 필요. | API 관문은 호출료보다 할당량과 프로젝트 감사. 템플릿 대량·반복·재사용은 채널 전체 수익화 제한 위험. 실존 인물/사건처럼 보이는 AI 합성·변형은 공개. [업로드](https://developers.google.com/youtube/v3/docs/videos/insert) · [YPP](https://support.google.com/youtube/answer/13429240?hl=ko) · [수익화 정책](https://support.google.com/youtube/answer/1311392) · [AI 표시](https://support.google.com/youtube/answer/14328491) · [한국 제휴](https://support.google.com/youtube/answer/13376398?hl=ko) |
| **TikTok** | Content Posting API video.publish 승인, 앱 등록·Direct Post 설정, 대상 사용자 OAuth. URL 전송은 미디어 도메인 확인. 미감사 앱은 SELF_ONLY/비공개 게시만 가능하고, 24시간 최대 5명이며 계정도 비공개여야 함. | Creator Rewards: 한국 포함 지원 국가, 개인 계정, 한국 만 19세, 팔로워 1만, 최근 30일 조회 10만, 1분 이상 독창 영상 등. Series는 일반적으로 팔로워 1만·최근 30일 조회 1천 등 별도 자격/심사. | API 가격표는 확인 못함. 특히 Direct Post 공식 Intended Use는 본인·팀 계정 업로드용 내부/개인 도구를 허용하지 않는다. NURI의 현재 내부 전용 형태로 공개 자동 게시 앱 승인을 기대하면 안 된다. 수동 게시 또는 해당 용도를 지원하는 공식 승인 도구를 사용한다. 자동생성/재사용은 직접 보상에 부적합; 상업 콘텐츠 표시, 권리, 현실적인 AI 영상 표시를 준수. 초기에는 앱에서 수동 업로드. [Direct Post](https://developers.tiktok.com/docs/en/content-posting-api-reference-direct-post) · [미감사 제한](https://developers.tiktok.com/docs/en/content-sharing-guidelines) · [Creator Rewards](https://support.tiktok.com/en/business-and-creator/creator-rewards-program/creator-rewards-program) · [Series](https://support.tiktok.com/en/business-and-creator/tiktok-series/about-tiktok-series) |
| **Pinterest** | API v5 앱 승인·OAuth boards:write/pins:write. 앱은 Trial로 시작하며 Trial에서 만든 Pin은 작성자에게만 노출. Standard 승인은 실제 로그인/게시를 담은 데모 영상 요구. | 상시 플랫폼 보상은 공식 경로 확인 못함. 검색형 Pin에서 제품·제휴·랜딩 유입. 협찬 표기는 모바일 앱의 Paid Partnership 기능. | API 가격표 확인 못함. Trial은 일일 호출 제한; Standard는 더 큰 한도. 제휴 링크 Pin은 일부 광고 프로모션 제외. [Access Tiers](https://developers.pinterest.com/docs/key-concepts/access-tiers/) · [Pin API](https://developers.pinterest.com/docs/work-with-organic-content-and-users/create-boards-and-pins/) · [협찬 라벨](https://help.pinterest.com/en/business/article/paid-partnerships-for-creators) |
| **LinkedIn** | Posts API: 개인 w_member_social 또는 조직 w_organization_social, Page의 적절한 관리자 역할. Community Management API는 앱·조직·사용 사례 심사. Development는 기본 500 호출/앱/일 및 100/회원/일, Standard는 영상 시연 등 별도 검토 후 제한 해제. | B2B 상담·견적·서비스 리드·외부 제휴/협찬. 공식 상시 게시물 수익 배분은 확인하지 못함. | 호출료 공개표 확인 못함. 회사 페이지/도메인/개인정보 보호정책과 앱 검토가 필요해 초기는 수동 게시. [Posts API](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api?view=li-lms-2026-07) · [앱 검토](https://learn.microsoft.com/en-us/linkedin/marketing/community-management-app-review?view=li-lms-2026-05) |

Meta·Pinterest·LinkedIn·TikTok API 공식 가격표는 확인하지 못했다. 이는 무료라는 뜻이 아니다. 토큰/앱 심사, 호스팅·미디어 저장, 제작 도구, 광고비·세금 비용을 분리해 확인한다. 유료 크레딧이나 광고 집행은 사전 비용 승인 전 사용하지 않는다.

## 자동 생성, 저작권, SEO/GEO

AI는 조사·목차·초안·채널별 편집 보조에만 쓰고, 세 명 중 한 명이 사실·저작권·광고표시·최종본을 승인한다. 원문마다 직접 해 본 일, 출처 링크, 자체 사진/화면, 작성자 판단 중 하나를 더한다. 기사/RSS를 말만 바꿔 쓰거나 동일 템플릿에서 키워드만 갈아 끼운 대량 발행은 금지한다. YouTube는 AI 자체는 허용하지만 비진정성/대량/재사용 콘텐츠는 채널 전체 수익화에 영향을 줄 수 있다. 사실처럼 보이는 실존 인물·사건 AI 변형은 표시한다. X 보상 정책은 자동 생성 또는 자동 게시 콘텐츠를 제외한다. TikTok은 AI 라벨·상업 관계 표시·원본성을 확인한다. Meta 역시 생성형 이미지/음성/영상 라벨과 Facebook 비원본 콘텐츠 정책을 운영한다.

Google은 AI 검색용 별도 GEO 태그·llms.txt·청크 분할을 요구하지 않는다. 크롤링 허용, 내부 링크, 읽기 쉬운 본문, 도움이 되는 고유 정보, 모바일 경험과 본문에 맞는 구조화데이터가 기본이다. Search Console은 사이트 소유 확인 후 검색/색인 상태를 관찰하는 도구이며 색인·AI 노출을 보장하지 않는다. [AI 검색 가이드](https://developers.google.com/search/docs/fundamentals/ai-optimization-guide) · [생성형 AI 콘텐츠](https://developers.google.com/search/docs/fundamentals/using-gen-ai-content) · [스팸 정책](https://developers.google.com/search/docs/essentials/spam-policies) · [구조화데이터](https://developers.google.com/search/docs/appearance/structured-data/sd-policies)

## 우선순위와 투자 판단

1. **1~2주: 현재 보유한 블로그·랜딩으로 전환을 계측.** 질문형 원본 글 2개, 자체 제품/서비스 1개 CTA, 링크별 UTM을 적용한다. 티스토리는 사람 발행, 이미 구현된 WordPress/Meta/X는 실계정과 권한을 먼저 확인한다.
2. **3~4주: SNS는 Instagram/Threads 먼저, 추가 채널은 하나만 수동 시험.** 시각 검색형 상품이면 Pinterest, B2B 문의면 LinkedIn, 직접 제작 가능한 영상이면 YouTube 또는 TikTok 중 하나. 앱 심사 전에 자동화 개발을 확장하지 않는다.
3. **X 자동화는 보류.** 현재 API 단가 중 URL 게시가 20센트이며 보상은 자동 게시 콘텐츠를 제외할 수 있다. 게시물당 업무 시간 절감이 비용보다 큰지 확인된 뒤에만 재검토한다.
4. **AdSense/플랫폼 보상은 관문형.** 먼저 유용한 원본·방문·문의 데이터를 쌓고 자격 상태를 확인한다. 승인 대기·미연결 계정의 잠재 수익은 0으로 계산한다.

## ROI를 위한 최소 제품 보강안

- 콘텐츠에 campaign_id, 원본/변형, 채널, 작성·검수자, 게시 URL/시각, CTA, 실제 비용을 연결한다.
- UTM 생성기: utm_source=instagram/threads/youtube 등, utm_medium=organic_social/referral/affiliate, utm_campaign, utm_content=콘텐츠ID/형식. 이름·전화·이메일 등 개인정보는 UTM에 넣지 않는다.
- SNS 전용 랜딩의 GA4 이벤트가 별도로 설정되면 유입·전환을 확인한다. NURI CRM 및 다른 서비스의 고객·주문 데이터와는 연결하지 않는다. 현재 도구는 확인한 캠페인 실적을 수기로 기록하며, UTM URL 생성 자체가 전환 수집을 뜻하지 않는다. Search Console은 검색어·노출·클릭·랜딩 관찰용이다.
- 주간 채널 보고서: 게시 수, 도달/저장/완주율(가능한 경우), 프로필/랜딩 클릭, 유효 리드, 주문, 기여이익, 광고비, API 비용, 제작 시간을 나란히 표시한다. 플랫폼 조회수를 매출로 오인하지 않는다.
- 자동화 전에 역할별 초안→검수→발행 승인, 광고/제휴/AI/저작권 체크, API 비용 상한, 게시 중복 차단, 실패 확인 상태가 필요하다. 공개 발행과 지출은 계정/비용 승인을 받고 실제 플로우로 검증한다.

## 30일 실행 계획 (운영자 1명 + 동료 2명)

| 기간 | 담당과 산출물 | 수용 기준 |
|---|---|---|
| 1~3일 | 운영자: 판매/상담 제안과 랜딩·응답 담당. 동료 A: 출처·저작권. 동료 B: UTM·GA4 이벤트. | 테스트 클릭이 GA4에서 채널별 확인되고 UTM에 개인정보 없음. |
| 4~7일 | 세 명이 고객 질문 10개를 모아 주제 3개, 각 글 근거·독자 효익·CTA 승인. | 반복 키워드 글이 아니라 직접 경험·근거가 각 글에 들어감. |
| 8~14일 | 원본 2개 발행. Instagram/Threads에 형식을 바꿔 총 6~8개 게시. Pinterest 또는 LinkedIn 중 한 곳에 2~3개 수동 게시. | 각 게시에 URL·담당자·UTM 기록, 협찬/제휴 표시는 실제 앱 화면에서 확인. |
| 15~21일 | 제목·CTA를 한 번씩 개선하고 문의를 응답/주문까지 기록. 영상역량이 확인되면 YouTube 또는 TikTok 한 곳에 수동 1편. | 클릭과 유효 문의/주문을 콘텐츠 ID로 귀속. 미감사 API 게시를 공개 성공으로 기록하지 않음. |
| 22~30일 | 세 명이 제작시간·채널비용·취소/환불 후 기여이익을 보고 지속/중단 결정. | 데이터가 부족하면 ROI는 미확정. 다음 채널·심사·광고투자는 증거가 있을 때만 결정. |

초기 실험량은 원본 2개와 채널 변형 6~10개다. 이는 성장 약속이 아니라 팀이 검수·게시·후속 응답·전환 귀속까지 끝낼 수 있는 양이다. 실적 자료가 없으므로 매출 목표를 숫자로 보장하지 않는다.

## 확인 경계와 조사 역할

2026-10-07 공식 문서를 확인했으며 변동 가능한 API 권한·가격·수익화 정책은 신청/실게시 직전에 재확인한다. 실제 계정 소유, 앱 승인, 토큰 발급/재조회, 공개 게시, 제휴 계약, 플랫폼 지급 계좌·세금 설정과 구매 전환은 확인하지 않았다. 문서 외 설치·계정 생성·광고/크레딧 결제는 하지 않았다.

조사: Codex GPT-6 Luna medium(공식 자료 수집과 채널별 비교). 주 에이전트가 핵심 비용·정책 출처를 재확인하고 코드·DB·화면 검증을 통합한다. 디자인과 신규 서버 기능은 GPT-6.1 Sol high, 좁은 보안 반증도 GPT-6.1 Sol high로 분담했다. 역할 가정은 사용자 지시에 따른 운영자 1명과 동료 2명이다.

### 주요 공식 출처

- 티스토리 [Open API 종료 공지](https://notice.tistory.com/2664), [API 안내](https://github.com/tistory/document-tistory-apis/blob/master/apis/README.md)
- Google [AI 검색 가이드](https://developers.google.com/search/docs/fundamentals/ai-optimization-guide), [Search Console](https://developers.google.com/search/docs/monitor-debug/search-console-start), [AdSense 사이트 준비](https://support.google.com/adsense/answer/7299563)
- Meta [Instagram](https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api), [Threads](https://www.postman.com/meta/threads/documentation/dht3nzz/threads-api), [AI 라벨](https://about.fb.com/news/2024/04/metas-approach-to-labeling-ai-generated-content-and-manipulated-media/), [Facebook 원본성](https://about.fb.com/news/2026/03/rewarding-original-creators-on-facebook/)
- X [API 가격](https://docs.x.com/x-api/getting-started/pricing), [Original Content Rewards](https://help.x.com/en/using-x/original-content-rewards)
- YouTube [업로드 API](https://developers.google.com/youtube/v3/docs/videos/insert), [YPP](https://support.google.com/youtube/answer/13429240?hl=ko), [재사용/비진정성](https://support.google.com/youtube/answer/1311392), [AI 공개](https://support.google.com/youtube/answer/14328491)
- TikTok [게시 API 제한](https://developers.tiktok.com/docs/en/content-sharing-guidelines), [보상](https://support.tiktok.com/en/business-and-creator/creator-rewards-program/creator-rewards-program)
- Pinterest [Access Tiers](https://developers.pinterest.com/docs/key-concepts/access-tiers/), [Pins](https://developers.pinterest.com/docs/work-with-organic-content-and-users/create-boards-and-pins/)
- LinkedIn [Posts API](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api?view=li-lms-2026-07), [앱 심사](https://learn.microsoft.com/en-us/linkedin/marketing/community-management-app-review?view=li-lms-2026-05)
