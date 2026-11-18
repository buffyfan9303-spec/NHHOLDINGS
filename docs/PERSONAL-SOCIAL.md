# 개인 SNS 연결과 예약

개인 업무의 내 SNS에서 채널을 선택합니다. 각자 개발자 앱의 Client ID와 Client Secret을 앱 설정에 저장할 수 있습니다. 이미 배포 환경에 기본 앱이 설정된 채널은 로그인한 계정으로 동의하면 됩니다. 클라이언트 비밀과 채널 토큰은 서버에서 암호화해 보관합니다.

| 채널 | 개발자 앱에 등록할 콜백 | 예약 기능 |
| --- | --- | --- |
| Instagram | `https://nhholdings.xyz/api/personal/social/instagram` | 전문 계정의 이미지 한 장과 본문 |
| Threads | `https://nhholdings.xyz/api/personal/social/threads` | 본문 또는 이미지 한 장 |
| YouTube | `https://nhholdings.xyz/api/personal/social/youtube` | 본인 채널 Studio에서 처리한 비공개 영상을 예약해 공개 |
| X | `https://nhholdings.xyz/api/personal/social/x` | 가중 280자 이내의 텍스트 게시 |

동의한 뒤 초안에서 채널·원고·미디어를 확인합니다. 한국 시각으로 예약하고 게시 승인을 선택합니다. 자동화 실행 이후 계정 연결이 바뀌거나 채널 응답이 불분명한 경우에는 해당 항목의 검토 상태를 확인하세요.

- [Meta Instagram 게시](https://developers.facebook.com/docs/instagram-platform/content-publishing/)
- [Threads 게시](https://developers.facebook.com/docs/threads/posts/)
- [YouTube 동영상 수정](https://developers.google.com/youtube/v3/docs/videos/update)
- [X OAuth 2.0](https://docs.x.com/fundamentals/authentication/oauth-2-0/authorization-code) · [X 게시 API](https://docs.x.com/x-api/posts/create-post)
