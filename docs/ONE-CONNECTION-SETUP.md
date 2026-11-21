# 누리원 개인 연동 시작 가이드

일반 사용자는 누리원에서 채널을 고르고 제공사 계정으로 로그인해 동의합니다. 누리원 운영자가 채널별 공용 OAuth 앱을 한 번 설정해 두면 이 흐름을 사용할 수 있습니다. 연결마다 본인 계정의 권한을 별도로 승인합니다.

공용 앱이 준비되기 전에는 각자 만든 앱을 `개발자 앱 설정`에서 사용할 수 있습니다. 로그인 계정과 게시 계정은 제공사 동의 화면에서 확인합니다. SNS를 연결한 뒤에도 게시 원고와 시각은 별도로 승인합니다.

## 공용 앱을 설정할 때

1. 채널별로 공식 개발자 콘솔에서 웹 OAuth 앱을 만들고 누리원 화면에 표시되는 콜백 주소를 그대로 등록합니다.
2. 운영 배포의 보안 설정에 등록된 앱의 ID와 Secret을 저장합니다. 사용자별 접근 토큰은 각 로그인 계정에만 묶입니다.
3. 제한된 테스트 계정으로 제공사 동의, 누리원 복귀, 연결 목록 표시, 잘못 선택한 계정에서의 재연결 거부를 확인합니다.
4. 일반 사용자에게 열기 전에 제공사가 요구하는 앱 심사나 검증, 테스트 사용자 제한, 필요한 API 권한을 확인합니다.

| 채널 | 운영 설정 이름 | 제공사에서 확인할 것 |
| --- | --- | --- |
| Google Drive | `PERSONAL_DRIVE_CLIENT_ID`, `PERSONAL_DRIVE_CLIENT_SECRET` | `drive.file`로 앱에서 만들거나 허용한 파일만 처리 |
| Gmail | `PERSONAL_MAIL_CLIENT_ID`, `PERSONAL_MAIL_CLIENT_SECRET` | `gmail.send`로 예약된 메일 발송 |
| YouTube | `PERSONAL_SOCIAL_YOUTUBE_CLIENT_ID`, `PERSONAL_SOCIAL_YOUTUBE_CLIENT_SECRET` | YouTube Data API v3, 웹 애플리케이션 OAuth, 채널 선택 |
| Instagram | `PERSONAL_SOCIAL_INSTAGRAM_CLIENT_ID`, `PERSONAL_SOCIAL_INSTAGRAM_CLIENT_SECRET` | Instagram Login, 비즈니스 또는 크리에이터 계정, 게시 권한 |
| Threads | `PERSONAL_SOCIAL_THREADS_CLIENT_ID`, `PERSONAL_SOCIAL_THREADS_CLIENT_SECRET` | Threads 앱과 게시 권한, 공개 앱 심사 |
| X | `PERSONAL_SOCIAL_X_CLIENT_ID`, `PERSONAL_SOCIAL_X_CLIENT_SECRET` | OAuth 2.0 읽기·쓰기와 게시 API 접근 |

Google Drive는 파일 범위가 제한된 `drive.file`을 사용하므로 첫 공용 연결 후보로 적합합니다. 운영자가 사용 테스트를 먼저 마치고, Gmail이나 게시 채널은 각 제공사의 조건을 확인한 뒤 공개할 수 있습니다.

[Google Drive 권한](https://developers.google.com/workspace/drive/api/guides/api-specific-auth) · [Gmail 권한](https://developers.google.com/workspace/gmail/api/auth/scopes) · [Google 민감 권한 검증](https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification) · [YouTube 웹 OAuth](https://developers.google.com/youtube/v3/guides/auth/server-side-web-apps) · [Instagram Login](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/business-login/) · [Threads API](https://developers.facebook.com/docs/threads/get-started/) · [X OAuth](https://docs.x.com/fundamentals/authentication/oauth-2-0/authorization-code)
