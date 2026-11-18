# 내 업무 Gmail 연결

개인 Gmail 계정으로 메일을 보낼 수 있도록 발송 권한을 연결합니다. 예약을 생성할 때 연결 ID를 저장합니다. Gmail을 다시 연결하거나 설정을 바꾸면 이전 연결의 예약은 새 계정으로 발송되지 않습니다.

1. 사용자의 Google OAuth 프로젝트에서 Gmail API를 활성화합니다. OAuth 앱 유형으로 웹 애플리케이션을 선택합니다.
2. OAuth 동의 화면에 `https://www.googleapis.com/auth/gmail.send`를 등록합니다. Google이 이 권한을 민감한 범위로 분류하므로 앱 배포 범위에 맞는 동의 및 검증 절차를 확인합니다.
3. 승인된 리디렉션 URI에 배포 기본 주소 뒤에 `/api/personal/mail/oauth`를 붙여 등록합니다. 기본 주소는 배포의 `MARKET_ORIGIN`과 같습니다.
4. 내 업무의 메일 설정에서 Client ID와 Client Secret을 저장하고 실제 Gmail 계정으로 연결에 동의합니다. 공통 앱을 쓰는 배포에서는 `PERSONAL_MAIL_CLIENT_ID`와 `PERSONAL_MAIL_CLIENT_SECRET`을 설정할 수 있습니다.

Client Secret과 OAuth 토큰은 서버에서 암호화합니다. 연결을 끊으면 앱에 저장된 발송 토큰과 진행 중인 동의를 제거합니다.

- [Gmail 권한 범위](https://developers.google.com/workspace/gmail/api/auth/scopes)
- [Google 웹 서버 OAuth](https://developers.google.com/identity/protocols/oauth2/web-server)
