# 개인 파일함 Google Drive 연결

개인 화면의 파일함에서 Google Drive 계정을 연결하고 파일을 올립니다. 앱은 해당 계정에 업로드 세션을 생성합니다. 브라우저에서 Google Drive로 파일 본문을 전송하고 앱에서 저장 결과를 확인합니다. 파일당 상한은 100 MB입니다. 다운로드 링크를 열 때 Google이 연결된 계정의 로그인을 요청할 수 있습니다.

## 배포 설정

1. NURI ONE에서 사용할 Google OAuth 프로젝트의 Drive API를 활성화합니다. Google Workspace 조직 계정용이면 OAuth 동의 화면과 조직 관리자 정책에서 해당 사용자가 사용할 수 있도록 설정합니다.
2. OAuth 동의 화면에 `https://www.googleapis.com/auth/drive.file`을 등록합니다. 기존 NURI ONE 웹 OAuth 앱을 이용하는 경우에도 Drive 용도로 사용할 인증 정보와 승인된 주소를 확인합니다.
3. OAuth 웹 애플리케이션의 승인된 리디렉션 URI에 배포 기본 주소 뒤에 `/api/personal/files/oauth`를 붙여 등록합니다. 기본 주소는 배포의 `MARKET_ORIGIN`과 같습니다.
4. 해당 OAuth 웹 앱 Client ID와 Client Secret을 각각 배포 환경의 `PERSONAL_DRIVE_CLIENT_ID`, `PERSONAL_DRIVE_CLIENT_SECRET`에 설정합니다.
5. `/personal#files`에서 사용자별로 Google Drive 연결에 동의합니다. 연결 뒤 자신의 파일 올리기, 새로고침, 내려받기를 확인합니다. 두 NURI 계정 간 파일 분리도 확인합니다.

Google Drive 접근 토큰과 갱신 토큰은 서버에서 암호화합니다. 개인 파일함은 해당 NURI 계정으로 올린 파일을 조회합니다. 브라우저의 파일 업로드 주소는 해당 파일의 Google Drive 업로드 세션 범위에서 유효합니다.

- [Google Drive 권한 범위](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)
- [Google 웹 서버 OAuth](https://developers.google.com/identity/protocols/oauth2/web-server)
- [Google Drive 파일 업로드](https://developers.google.com/workspace/drive/api/guides/manage-uploads)
- [Google Drive 파일 다운로드](https://developers.google.com/workspace/drive/api/guides/manage-downloads)
