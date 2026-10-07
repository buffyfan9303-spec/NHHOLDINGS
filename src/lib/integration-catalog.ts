// Public provider information only. Status describes code availability, never live authentication.
export const integrationCatalogCheckedAt = '2026-10-07';
export type Integration = {
  id: string; name: string; category: 'infrastructure' | 'analytics' | 'publishing' | 'ai' | 'email';
  description: string; status: 'existing-code' | 'requires-setup' | 'manual-only';
  requirements: readonly string[]; freeUsage: string; docsUrl: string; pricingUrl: string;
};
export const integrationCatalog: readonly Integration[] = [
  {
    id: 'supabase', name: 'Supabase', category: 'infrastructure', status: 'existing-code',
    description: '기존 로그인·파일 저장 코드가 있습니다. 실제 프로젝트 연결 상태는 운영 화면에서 별도 확인합니다.',
    requirements: ['프로젝트 URL·공개 키', '서버 전용 서비스 키', '접근 정책·운영자 설정'],
    freeUsage: '무료 플랜 한도 내 사용 가능. 용량·트래픽·인증 한도와 비활성 프로젝트 일시 정지를 확인하세요.',
    docsUrl: 'https://supabase.com/docs', pricingUrl: 'https://supabase.com/pricing',
  },
  {
    id: 'vercel', name: 'Vercel', category: 'infrastructure', status: 'requires-setup',
    description: 'Next.js 배포·도메인·환경 변수 관리. 요금제 확인 후 기존 프로젝트를 연결합니다.',
    requirements: ['배포 프로젝트 권한', '상업 이용에 맞는 요금제', '서버 환경 변수'],
    freeUsage: 'Hobby는 개인·비상업 용도만 허용됩니다. 상업 서비스는 Pro 등 적합한 유료 플랜이 필요합니다.',
    docsUrl: 'https://vercel.com/docs', pricingUrl: 'https://vercel.com/docs/plans/hobby',
  },
  {
    id: 'ga4', name: 'Google Analytics 4', category: 'analytics', status: 'requires-setup',
    description: '방문·유입·전환 보고서를 Google Analytics Data API로 조회합니다.',
    requirements: ['GA4 속성 ID', 'Google Cloud API 활성화', '속성 조회 권한을 부여한 서비스 계정 또는 OAuth'],
    freeUsage: '표준 Analytics와 Data API의 할당량을 확인하세요. Analytics 360·BigQuery·다른 Cloud 서비스 비용은 별도입니다.',
    docsUrl: 'https://developers.google.com/analytics/devguides/reporting/data/v1/quickstart',
    pricingUrl: 'https://developers.google.com/analytics/devguides/reporting/data/v1/quotas',
  },
  {
    id: 'search-console', name: 'Google Search Console', category: 'analytics', status: 'requires-setup',
    description: '검색 노출·클릭·검색어·색인 상태를 조회합니다.',
    requirements: ['확인된 사이트 속성', 'Search Console API 활성화', '속성 접근 권한을 가진 서비스 계정 또는 OAuth'],
    freeUsage: 'Search Console API는 무료이며 요청·부하 할당량이 적용됩니다.',
    docsUrl: 'https://developers.google.com/webmaster-tools', pricingUrl: 'https://developers.google.com/webmaster-tools/pricing',
  },
  {
    id: 'instagram', name: 'Instagram', category: 'publishing', status: 'requires-setup',
    description: '전문 계정의 미디어 게시·인사이트 연동 후보입니다. 로그인 방식별 권한을 먼저 확인합니다.',
    requirements: ['Business 또는 Creator 계정', 'Meta 앱·OAuth 토큰', '게시 권한·앱 검수 및 사용 제한 확인'],
    freeUsage: '무료 무제한 사용으로 보장하지 않습니다. Meta 정책·권한·게시 한도를 확인해야 하며 광고비는 별도입니다.',
    docsUrl: 'https://developers.facebook.com/docs/instagram-platform/',
    pricingUrl: 'https://developers.facebook.com/docs/graph-api/overview/rate-limiting/',
  },
  {
    id: 'threads', name: 'Threads', category: 'publishing', status: 'requires-setup',
    description: 'Threads 게시와 계정 인사이트 연동 후보입니다.',
    requirements: ['Meta 앱·Threads OAuth', 'threads_basic·게시 권한', '외부 계정 사용 전 앱 검수'],
    freeUsage: '무료 무제한 사용으로 보장하지 않습니다. 권한·게시 할당량·플랫폼 약관을 확인하세요.',
    docsUrl: 'https://developers.facebook.com/docs/threads/',
    pricingUrl: 'https://developers.facebook.com/docs/threads/overview/',
  },
  {
    id: 'x', name: 'X', category: 'publishing', status: 'requires-setup',
    description: 'X 게시·조회 API는 비용 승인 후 연결합니다.',
    requirements: ['개발자 앱·사용자 OAuth', 'API 크레딧·지출 한도', '유료 호출 승인'],
    freeUsage: '사용량 과금 API입니다. 프로모션 크레딧을 상시 무료로 간주하지 않으며 자동 충전을 켜지 않습니다.',
    docsUrl: 'https://docs.x.com/x-api', pricingUrl: 'https://docs.x.com/x-api/getting-started/pricing',
  },
  {
    id: 'wordpress', name: 'WordPress', category: 'publishing', status: 'requires-setup',
    description: '관리 권한이 있는 WordPress 사이트의 REST API로 초안·게시물을 관리합니다.',
    requirements: ['사이트 REST API 주소', 'HTTPS·게시 권한', '서버 전용 Application Password 또는 해당 호스트 OAuth'],
    freeUsage: '자체 WordPress REST API는 별도 호출료가 없지만 호스팅·유료 플러그인·WordPress.com 플랜 비용은 별도입니다.',
    docsUrl: 'https://developer.wordpress.org/rest-api/', pricingUrl: 'https://wordpress.com/pricing/',
  },
  {
    id: 'tistory', name: 'Tistory', category: 'publishing', status: 'manual-only',
    description: '공식 Open API 종료로 직접 글쓰기 화면에서 게시합니다. 자동 게시 연결을 제공하지 않습니다.',
    requirements: ['블로그 관리자 화면에서 직접 로그인·게시'],
    freeUsage: '기존 Open API 쓰기·수정·첨부 기능은 종료되었습니다. 링크 이동·수동 게시만 사용합니다.',
    docsUrl: 'https://notice.tistory.com/2664', pricingUrl: 'https://notice.tistory.com/2664',
  },
  {
    id: 'anthropic', name: 'Anthropic Claude API', category: 'ai', status: 'requires-setup',
    description: '글·요약·운영 초안 생성 후보입니다. 결과는 게시 전 검토합니다.',
    requirements: ['서버 전용 API 키', 'API 결제·지출 한도', '사용할 모델·정보 전송 범위 승인'],
    freeUsage: '토큰·도구 사용량 과금입니다. Claude 구독 포함 한도와 API 결제를 혼동하지 않습니다.',
    docsUrl: 'https://platform.claude.com/docs/en/api/overview', pricingUrl: 'https://platform.claude.com/docs/en/about-claude/pricing',
  },
  {
    id: 'openai', name: 'OpenAI API', category: 'ai', status: 'requires-setup',
    description: '글·이미지·음성 작업 후보입니다. 유료 생성은 승인 후 실행합니다.',
    requirements: ['서버 전용 프로젝트 API 키', 'API 결제·지출 한도', '모델·데이터 전송 범위 승인'],
    freeUsage: '모델·토큰·도구별 과금입니다. ChatGPT 구독이 API 무료 사용을 의미하지 않습니다.',
    docsUrl: 'https://developers.openai.com/api/docs', pricingUrl: 'https://developers.openai.com/api/docs/pricing',
  },
  {
    id: 'smtp', name: 'SMTP · Resend', category: 'email', status: 'requires-setup',
    description: '로그인·주문·운영 알림 메일 후보입니다. 발송 도메인을 먼저 인증합니다.',
    requirements: ['SMTP 자격 증명 또는 Resend 서버 API 키', '발신 도메인 DNS 인증', '발송 동의·반송 처리'],
    freeUsage: 'Resend 무료 플랜은 월 3,000건·하루 100건 한도입니다. SMTP 제공업체별 요금과 제한은 별도입니다.',
    docsUrl: 'https://resend.com/docs/send-with-smtp', pricingUrl: 'https://resend.com/pricing',
  },
];
