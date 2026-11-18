# 개인 파일함 Google Drive 연결

개인 화면의 파일함에서 Google Drive 계정을 연결하고 파일을 올립니다. 앱은 해당 계정에 업로드 세션을 생성합니다. 브라우저에서 Google Drive로 파일 본문을 전송하고 앱에서 저장 결과를 확인합니다. 파일당 상한은 100 MB입니다. 다운로드 링크를 열 때 Google이 연결된 계정의 로그인을 요청할 수 있습니다.

## 사용자별 연결

1. 자신의 Google OAuth 프로젝트에서 Drive API를 활성화합니다. Google Workspace 조직 계정용이면 OAuth 동의 화면과 조직 관리자 정책에서 해당 사용자가 사용할 수 있도록 설정합니다.
2. OAuth 동의 화면에 `https://www.googleapis.com/auth/drive.file`을 등록합니다. 기존 NURI ONE 웹 OAuth 앱을 이용하는 경우에도 Drive 용도로 사용할 인증 정보와 승인된 주소를 확인합니다.
3. `/personal#files`의 Google Drive 연결 설정에서 승인된 리디렉션 주소를 확인합니다. 자신의 Google OAuth 웹 애플리케이션에 표시된 주소를 그대로 등록합니다.
4. 연결 설정에 해당 앱의 Client ID와 Client Secret을 저장하고 Google Drive 연결을 선택합니다.
5. Google 동의가 끝나면 파일 올리기와 내려받기를 확인합니다.

배포 관리자가 공통 OAuth 앱을 제공하는 경우 기본값으로 `PERSONAL_DRIVE_CLIENT_ID`와 `PERSONAL_DRIVE_CLIENT_SECRET`을 설정할 수 있습니다. 공통 앱의 승인된 리디렉션 주소는 배포의 `MARKET_ORIGIN` 뒤에 `/api/personal/files/oauth`를 붙인 주소입니다. 개인이 저장한 앱 설정을 우선 사용합니다.

Client Secret과 Google Drive 토큰은 서버에서 암호화합니다. 개인 파일함은 해당 NURI 계정으로 올린 파일을 조회합니다. 앱 설정을 변경하거나 연결을 끊으면 이전 연결의 토큰과 진행 중인 동의를 제거합니다. Google에 이미 전달된 업로드 주소는 해당 파일의 Drive 세션 범위에서 유효합니다.

- [Google Drive 권한 범위](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)
- [Google 웹 서버 OAuth](https://developers.google.com/identity/protocols/oauth2/web-server)
- [Google Drive 파일 업로드](https://developers.google.com/workspace/drive/api/guides/manage-uploads)
- [Google Drive 파일 다운로드](https://developers.google.com/workspace/drive/api/guides/manage-downloads)
