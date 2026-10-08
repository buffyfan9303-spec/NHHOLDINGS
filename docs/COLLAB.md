# 누리원 · Codex / Claude 협업 기준

적용일: 2026-10-08 KST. 저장소: `buffyfan9303-spec/NHHOLDINGS`. 이 문서와 [AGENTS.md](../AGENTS.md), 최신 사용자 지시를 함께 따른다. 비밀키와 사용자 비공개 자료를 작업 지시문에 복사하지 않는다.

## 목표와 역할

Codex가 작업 분해·배정·통합·실제 동작 검증을 맡는다. 사용자는 Codex가 Claude에 필요한 하위 작업을 직접 지시하고 결과를 검토해 반영하는 것을 허용했다. **Claude도 배정된 작업을 자기 브랜치에서 구현·검사·커밋·push·PR 생성까지 직접 진행할 수 있다. Codex는 검수 후 main 통합·배포·운영 확인까지 맡는다.** 이미 허용된 범위의 매 단계마다 다시 승인을 묻지 않는다. 별도의 사용자 전달을 기다릴 필요는 없다. 상대 모델이 항상 더 잘한다고 가정하지 않고 실제 결과와 증거로 채택한다.

사용자가 새 요구를 말하면 **Codex가 리드**하여 역할·파일·수용 기준을 정하고, 독립적으로 진행 가능한 조사/구현/검토는 내부 에이전트와 Claude로 나눈다. 작업자가 서로 가설을 제안·반박·보완하고 총괄이 증거를 확인해 통합한다. 단순 작업은 최소 인원으로 처리하며, 같은 검색이나 전체 이력을 여러 팀에 중복 전달하지 않는다. 각 단계 완료 시 Codex와 Claude의 활성 작업을 점검하고 끝난 하위 에이전트·백그라운드 명령·자신이 띄운 개발/미리보기 서버·작업용 Chrome 탭은 즉시 종료한다. 결과물·commit·PR·검증 증거와 사용자 원래 탭·다른 프로젝트 프로세스는 보존한다. 재시작이나 상태 지연만으로 유실을 단정해 중복 작업자를 띄우지 않는다.

| 역할 | 기본 담당 | 소유 범위와 수용 기준 |
|---|---|---|
| 총괄·통합 | Codex | 요구사항·파일 배정·PR·실제 도메인/브라우저 검증, 완료와 미검증 분리 |
| 화면·작업 흐름 | Codex | 배정된 `public/one/`, `src/app/` 등. 모바일/PC, 권한, 저장→재조회→화면 확인 |
| 한국어 편집·콘텐츠 구성·이미지 비평 | Claude | 지정 원고·이미지만 읽는 독립 검토를 우선. 채널별 원고·구도·검수안 제출, 허위 성과/출처 금지 |
| 서버·보안·금액·어려운 오류 | 작업마다 지정 | API/DB/회귀검사 담당 한 명, 다른 모델이 독립 검토. 입력·권한·중복·금액 정확성을 생략하지 않음 |
| 이미지 제작 | 사용 가능한 전용 이미지 도구 | Claude가 콘셉트/한국어/시각 구성 비평, Codex가 제작과 모든 결과 이미지 실제 검수. 텍스트 모델의 의견을 이미지 생성·렌더 확인으로 가장하지 않음 |

각 배정에는 목표, 정확한 파일/worktree 경로, 변경 허용·금지 범위, 허용 도구(읽기/쓰기/git/필요한 네트워크), 모델/effort 이유, 수용 기준, 반환할 증거를 적는다. 읽기 전용 검토는 브랜치 생성 없이 가능하다. 구현 담당자가 둘이면 서로 다른 worktree와 파일 소유권을 먼저 정한다. 같은 checkout에서 동시에 브랜치를 바꾸지 않는다. 겹치는 파일·공통 스키마 변경은 총괄이 순서를 정한다.

## 서로 보완하는 검토 흐름

1. 담당자가 요구사항·변경·검사·남은 위험을 제출한다. Codex 구현은 Claude가, Claude 구현은 Codex가 독립 검토한다. 단순 문구 수정은 짧게, 권한·금액·DB·발행 중복은 재현 가능한 검사까지 확인한다.
2. 검토자는 정확한 파일/위치, 재현 조건, 사용자 영향, 최소 수정안으로 지적한다. 원고·이미지는 실제로 읽고 모든 장을 보며 문법·출처·가독성·내용 일치를 확인한다. 읽거나 실행하지 않은 검사를 통과했다고 쓰지 않는다.
3. 담당자가 수정하거나, 채택하지 않은 이유와 증거를 남긴다. 검토자는 변경된 부분을 다시 확인한다. 서로의 결론에 자동 동의하지 않고 수치·공식 원문·실제 화면·테스트로 반박할 수 있다.
4. 의견이 갈리면 사용자 요구→재현 결과→현재 공식 자료→측정 가능한 실험 순서로 판단한다. 두 번의 수정·재검토에도 풀리지 않으면 양쪽 의견과 대안을 짧게 기록한다. Codex가 결정에 관여했더라도 Claude의 이견과 채택/보류 근거를 지우지 않는다. 검증 불가능한 권한·금액·데이터 손실 위험은 보류하고 사용자 판단이 필요한 쟁점만 묻는다. 사용자 취향·새 비용·추가 권한 이외의 통상적 구현은 Codex가 근거를 남겨 결정한다.
5. 승인된 범위의 수정→검사→자기 branch push→PR→검토→통합→Vercel READY→실제 동작을 이어서 진행한다. 한 모델의 ‘완료’ 보고를 다른 모델의 확인으로 대체하지 않는다. 코드 검사 통과와 운영 배포, 브라우저 로그인과 API 연결, 이미지 파일 생성과 공개 게시를 구분한다.

둘 다 상대에게 조사·수정·검토를 제안할 수 있다. 현재 세션에서는 Codex가 실제 Claude CLI 호출과 결과 전달을 수행하고, Claude의 지적·요청을 검토해 Codex 작업에 반영한다. 두 제품이 별도 설정 없이 영구히 서로를 호출하는 상시 서비스라는 뜻은 아니다. 기존 도구와 이 문서로 시작하며 별도 에이전트 서버·유료 오케스트레이션은 만들지 않는다.

### Claude Code의 GitHub 클라우드 작업

클라우드는 해당 저장소의 최신 `main`과 이 공통 기준을 읽고 `claude/*` 작업 브랜치를 사용한다. 이 PC의 `C:/...` 경로, Chrome 로그인, 로컬 MCP 인증, `.env`를 사용할 수 있다고 가정하지 않는다. 클라우드의 실제 모델·GitHub 접근·실행 도구를 그 환경에서 확인하고 기록한다. 코드·로컬 검사·commit·push·PR을 진행하고, Codex가 PR을 확인해 로컬/운영 연결과 화면을 검증한다. 운영 비밀키를 코드/PR/작업 프롬프트로 옮기지 않는다. 클라우드에서 불가능한 실제 로그인·발행 검증은 완료했다고 쓰지 않는다.

## 브랜치와 통합

- Codex는 `codex/<작업명>`, Claude는 `claude/<작업명>`에서 구현·commit·push한다. branch push와 PR 생성은 사용자 승인 범위에 포함된다. `main`은 Codex가 통합 관리하며 기본 경로는 검증된 PR 병합이다. Claude는 `main`에 직접 commit/push하지 않는다. Codex도 작업 브랜치를 사용하며 force push로 검사를 우회하지 않는다. 적용 전 이미 배포된 변경과 이후 변경을 구분한다.
- 상대 브랜치의 수정·reset·rebase·force push·삭제를 하지 않는다. 읽기/비교는 가능하다. 통합은 검토한 PR이나 명시적으로 선택한 커밋으로 한다.
- 시작 시 실제 경로, 최신 인계, branch/HEAD/status/diff, 진행 중 담당을 확인한다. 타인의 미커밋 변경을 덮어쓰지 않는다.
- PR 전에 `npm run typecheck`와 `npm test`를 모두 통과시킨다. 화면/런타임 변경에는 필요한 build·브라우저 확인도 추가한다. 실패·미실행은 그대로 기록한다.
- PR 생성은 배포 완료가 아니다. 병합·Vercel READY·실제 도메인 동작을 각각 확인한다. 이번 사용자 승인에 따라 Codex는 배정된 누리원 변경의 검수 후 병합·배포까지 직접 진행한다. 비단순 변경의 병합 전 상대 검토를 완료한다. 상대 한도/접속 문제로 검토가 불가능하면 불가 사유와 대체 독립 검토·대상 검사를 기록하며 고위험 미해결 항목은 병합하지 않는다. 저장소 보호 규칙·필수 검사·실패한 검사를 우회하지 않는다. 별도 확인이 필요한 결제·보안 설정·삭제 등은 이 승인으로 확대 해석하지 않는다.
- DB 스키마는 `db/` 마이그레이션 파일로만 변경하고 PR에 영향·리허설·복구 방법을 적는다. `npm run db:migrate`는 대상 DB를 확인한 뒤 실행한다. 운영 DB는 리허설→독립 검토→승인 범위 확인→적용→사후 대조를 거친다.

## 모델·구독·도구

단순 탐색은 빠르고 효율적인 모델, 한국어 편집·디자인·보안·금액·복잡한 오류는 높은 추론을 쓴다. 사용자가 Claude 활용을 요청했으므로 필요한 깊이의 검토를 맡기되 같은 자료를 여러 팀이 중복 조사하지 않는다. 현재 사용 가능한 모델 목록과 CLI를 확인하고 별칭/effort를 선택한다. Claude 모델 ID를 Codex 모델 호출에 넣지 않는다.

Claude는 기존 구독 로그인과 포함 한도를 사용한다. 호출 전 `claude auth status`의 로그인 방식/구독 상태와 API 인증 환경변수 존재 여부를 확인하되 값은 출력하지 않는다. 구독 호출 프로세스에서는 `ANTHROPIC_API_KEY`·`ANTHROPIC_AUTH_TOKEN` 등의 API 인증 환경을 제거하고 구독 인증을 확인한다. API 키 인증으로 몰래 전환하거나 추가 사용량·자동 충전·유료 크레딧·플랜을 켜지 않는다. 한도에 걸리면 한계를 기록하고 가능한 다른 작업을 진행한다. 설치/활성/인증/실제 호출 성공을 구분한다. CLI로 검토할 때는 지정 Read 도구만 주는 등 작업에 필요한 최소 권한을 부여하고, 구현에 필요한 쓰기는 배정한 worktree로 제한한다. 무제한 권한 우회 옵션을 기본값으로 쓰지 않는다.

관련 스킬·플러그인·MCP·커넥터·CLI·hooks·자동화를 확인하되 모두 설치/실행하지 않는다. 기존 기능·표준 라이브러리·플랫폼 기본 기능을 우선한다. Next.js 코드를 바꾸기 전 `node_modules/next/dist/docs/`의 관련 문서를 읽는다. 현재 `package.json` 기준 Next 16.4.0, React 19.3.0, pg/PGlite이며 실행 명령은 `npm run dev`, `npm run typecheck`, `npm test`, `npm run build`, `npm run db:migrate`다.

외부 발송·공개 게시·업로드는 사용자가 허용한 계정·목적·콘텐츠 범위에서만 한다. 인증/보안 설정·약관 동의·결제 등 도구가 요구하는 별도 확인을 우회하지 않는다. 비밀번호 변경·본인 인증을 대신 우회하지 않는다. `.env`, 토큰, 비밀키, 개인 검색 실적·인사이트 원문은 커밋하지 않는다. 공개 문서에는 비공개 운영 증거를 넣지 않는다.

## SNS 운영 경계

티스토리는 검색형 정보 매체, Instagram·Threads는 계정 자체 성장으로 운영한다. 누리 사이트 판매/가입 유도를 기본 삽입하지 않는다. NURI CRM 등 다른 서비스에 새로 연동하지 않으며 기존 현황 조회 범위는 유지한다. 현재 집중 채널은 티스토리·Instagram·Threads다. [편집·실험 기준](../public/docs/sns-growth.md)을 적용한다.

발행 전 최신 트렌드, 실제 제공되는 검색 수요, 조회/공개 반응 표본, 한국어, 모든 이미지·전체 화면을 확인한다. 비공개는 미확인으로 남긴다. 검색 순서·좋아요를 조회수 순위로 바꾸지 않는다. 기존 유명인 문장/그림 복제, 가짜 경험·출처·성과, 자동 수익 약속을 하지 않는다. 초안·검수·실제 공개 URL·예약·실패를 구분하고 게시 여부가 불명확하면 중복 재시도하지 않는다.

SNS 조사도 역할을 나눈다. 티스토리 담당은 검색 의도·본인 Search Console·기존 카테고리·현재 공식 자료를, Instagram 담당은 실제 원게시물/모든 카드·문장/여백/가독성과 공개 반응을, Threads 담당은 독립적인 원문·관점/유머/어투와 실제 조회/답글을 확인한다. 작업 크기에 따라 한 사람이 여러 역할을 맡을 수 있다. 출처 URL·관찰 시각·지역/기간·표시 지표·미확인·추론을 남기고 다른 검토자가 원문과 해석을 대조한다. 의견의 개수를 성과 증거로 삼지 않는다. 최신 흐름은 발행 당일 다시 확인하고 실제 게시 후 같은 경과시간의 지표로 작성 규칙을 수정한다.

## 시작·종료 기록

각 작업의 시작과 끝에 아래 형식으로 이 파일에 짧게 누적한다. 담당·파일 소유권은 작업 중 바뀌면 바로 갱신한다. 비공개 원문·로그는 `.gitignore`된 `artifacts/operations/`에 두고 여기에는 경로와 검증 결과만 적는다.

`날짜/시각(KST) | 시작/종료 | 담당·역할·실제 모델/effort(반환 기록 기준) | branch/HEAD | 변경 파일 | 검사·증거 | 남은 일`

### 2026-10-08

- 시작 · 12:07 KST · Codex 총괄, `codex/nuri-unified`, 시작 HEAD `67b2471`. 신규 협업 규칙 적용. 소유 파일 `docs/COLLAB.md`, `AGENTS.md`의 협업 링크, `public/docs/sns-growth.md`, 자체 생성 이미지. Claude는 지정 파일 Read 전용으로 한국어·구성·이미지 비평을 수행했고 코드/브랜치를 수정하지 않았다.
- 확인된 도구: Claude Code 2.1.280의 기존 Max 로그인, Opus/high 실제 3턴 검토 성공(`artifacts/operations/claude-editorial-review-2026-10-08.json`). 웹·Chrome 원게시물/본인 Search Console 조회, Supabase SQL 읽기, 실제 누리원 프롬프트/캠페인 UI 저장과 재조회 성공. Codex 내부 Luna 조사·독립 검토 완료. 기존 content-creation/performance-report/imagegen 스킬 사용, 새 플러그인·hooks·유료 API는 추가하지 않았다. 기존 Vercel 배포 `67b2471`은 READY 확인됐으며 이 문서의 추가 변경은 별도 PR 대상이다.
- 작업 중 · 실제 Search Console 근거와 공개 Threads 조회를 구분해 편집 가이드 보강, 공통/티스토리/Instagram/Threads 프롬프트 UI 저장, 샘플 수치 없이 실제 실험 가설 캠페인 5개 저장·재조회. 한국어·이미지 개선안은 가설이며 성장 성과가 검증됐다는 뜻이 아니다.
- 승인 갱신 · 사용자가 push까지 직접 진행하도록 허용. Claude의 자기 branch commit/push/PR, Codex의 검수·main 통합·배포를 명시했다. 상대 branch 수정과 무단 유료/보안 변경은 허용하지 않는다.
- 보완 · 사용자 요청에 따라 Codex↔Claude 교차 검토, 근거가 있는 반박·재검토·충돌 해결, 실제 운영 확인을 완료 조건으로 추가. Claude용 시작 파일도 이 공통 기준을 읽도록 연결한다.
- Claude 교차 검토 · 실제 반환 모델 `claude-sonnet-5-5`·medium, Read 전용 4턴 성공. 검토 불가 시 대체 절차, 이견 보존, 배정 도구, 인증/실제 모델 기록 권고를 반영했다. 시작 파일마다 공통 기준을 중복 복사하는 권고는 채택하지 않고 링크를 유지했다. 사용자 원문 요지는 2026-10-08 ‘푸쉬까지 해도 되게’, ‘서로서로 보완’이며 branch push/PR과 Codex 통합 범위로 구체화했다. 사용자 직접 지시는 커밋 전에도 적용된다.
- 인증 증거 · `claude auth status`에서 `loggedIn:true`, `authMethod:claude.ai`, `subscriptionType:max` 확인. 두 검토 프로세스의 API 인증 환경변수는 제거했다. CLI 비용 출력은 모델의 표시 비용이며 실제 청구 확인 자료가 아니다. Codex 하위 에이전트 `/root/social_publish_audit`와 `/root/publication_check`의 조사/독립 검토 완료 보고를 확인했고 총괄이 원문·UI·DB를 별도로 대조했다.
- GitHub 권한 확인 · GitHub CLI 인증과 저장소 원격 조회 성공. `gh api .../branches/main`에서 `protected:false`를 확인했다. 역할별 branch 제한은 현재 협업 규칙이며 기술적으로 차단된 권한이라고 주장하지 않는다. 보호 규칙·계정 권한은 이번 문서 작업에서 변경하지 않았다.
- 로컬 검증 종료 · `npm run typecheck`, `npm test`, `npm run build`, `git diff --check` 통과. 공통/채널 프롬프트 7개 DB 원문 대조 일치, 실제 운영 가설 캠페인 5개 UI 저장→DB→새로고침 일치. 기존 실제 금액 기록 0건·지문 유지. 성장 대시보드 데스크톱/390px 실제 확인, 미측정 성과는 미확인으로 유지. 새 문서·가이드·이미지는 검토 PR로 통합하며 운영 배포 결과와 남은 연동은 로컬 운영 인계에 별도로 기록한다.
- 리드 규칙 확정 · 사용자 지시에 따라 Codex 리드, 독립 역할 배정, 서로 반박·보완하는 검토, SNS 채널별 원문 조사와 근거 대조를 기본 흐름으로 명시했다. [PR #1](https://github.com/buffyfan9303-spec/NHHOLDINGS/pull/1)에서 협업 기준을 통합한다.
- 시작 · 12:26 KST · Claude 클라우드 리드(`claude-opus-5-5`, 세션 effort medium, `get_session` 반환 기준), `claude/sharp-lovelace-ewn57g`, 시작 HEAD `67b2471` → clean 상태에서 `origin/main` `8bcb834`로 fast-forward. 환경: Claude Code 2.1.293, OAuth 로그인(`claude auth status` 표시값 `authMethod:oauth_token`, 구독 종류는 표시되지 않아 미확인), API 인증 환경변수 없음, GitHub MCP·WebSearch/WebFetch·Agent 도구 사용 가능. 클라우드에 이 PC의 Chrome 로그인·`.env`·운영 DB 없음.
- 팀 구성 · `.claude/agents/`에 4개 역할 정의를 새로 추가했으나 실행 중 세션에서는 인식되지 않음(`Agent type 'nuri-sns-research' not found`). 대신 `general-purpose` Agent에 model/effort를 지정해 실행: research ×2 = `haiku`/medium(티스토리 / Instagram·Threads), builder = `sonnet`/medium, editor = `sonnet`/high, reviewer = `opus`/high. Agent 결과에 실제 응답 모델 ID는 표시되지 않으므로 요청 별칭만 기록한다. 소유: builder `src/server/dashboard.cjs`, `public/one/app.js`, `public/one/studio.js`, `tests/content-tools.cjs` · editor `public/docs/sns-growth.md` · 리드 `.claude/agents/`, `docs/COLLAB.md`. research·reviewer는 읽기 전용.
- 실제 실행 · research ×2(`haiku`/medium) 완료. 네트워크 정책이 `doto1.tistory.com`, `developers.google.com`, `instagram.com`, `threads.com/.net`, Meta 공식 도메인을 차단(curl `CONNECT tunnel failed, response 403`, WebFetch `ENOTFOUND`)해 원문은 하나도 열지 못했고 WebSearch 요약만 확보했다. 원문 검증은 Codex 인계 목록(`docs/SNS-7일-실행표.md` 6절)으로 넘긴다. builder(`sonnet`/medium) 구현 완료, editor(`sonnet`/high) 원고·실행표 완료, reviewer(`opus`/high) 1차 검토(blocker 0, major 1, minor 6) → 리드가 수정 → 재검토(`opus`/high)에서 전 항목 해결 확인. 컨테이너 재시작 후 유실로 오인해 다시 띄운 editor·reviewer 중복 2건은 원 작업 결과를 확인한 즉시 중지했다. 개발 서버·브라우저는 실행하지 않았다.
- 종료 · 12:37 KST · Claude 리드, `claude/sharp-lovelace-ewn57g`. 변경: `src/server/dashboard.cjs`(`socialPermalink`·`/api/studio/manual`만), `public/one/app.js`, `public/one/studio.js`, `tests/content-tools.cjs`, `public/docs/sns-growth.md`(미확인 2차 요약 주석 1단락), `docs/SNS-7일-실행표.md`(신규), `.claude/agents/`(4개). 검사: `npm run typecheck`, `npm test`, `npm run build`, `git diff --check` 통과, lock 단언은 변이 검사로 실패 확인 후 복원. DB 스키마 변경 없음. 미검증: 1440/390/320px 화면과 로그인 실사용, 실제 계정 URL 등록, 원문 재검증은 Codex 검증 대기. 남은 위험: API로 게시한 Instagram의 permalink 조회가 실패해 `link`가 비면 같은 게시물 수동 등록을 중복으로 잡지 못함(media ID≠shortcode), 수동 등록 시 이전 API 시도 `container` ID를 비움(감사 로그는 남음), 거절 문구가 일반적.
- Codex 교차 검토 반영 · 12:43 KST · Claude 리드 단독(하위 에이전트 없음). 기존 13:05 표기는 commit `3da579f`의 UTC 시각 03:43:26과 대조해 정정했다. X `/i/web/status/{id}` 입력이 `https://x.com/i/status/{id}`로 저장되던 문제를 `m[1]||'i/web'`로 수정하고 저장 URL·중복 key 테스트를 추가했다. username 경로와 key 비교는 그대로다. `npm run typecheck`, `npm test` 통과.
- 통합 확인 · 12:51 KST · Codex가 Claude PR #2를 독립 검토·검사 후 main `37fb0e6`에 병합, Vercel `dpl_BTs4vnkQsgAVJd3xyS9A3uvpdP93` READY 및 실제 도메인 수동 URL 등록→DB 재조회 확인. 수동 기록은 `manual:true`, `registered`, `checkedAt:null`로 API 검증과 구분한다. 완료된 Claude 작업·Chrome 탭·Codex 검사 프로세스를 종료했다.
- 시작 · 12:53 KST · Codex 총괄, `codex/nuri-unified` / `37fb0e6`. 소유: `public/one/app.js`, `public/one/studio.js`, 기존 성장 검사, 이 문서·성장 가이드·7일 실행표. 수동 URL 등록 시각 표시와 정리 규칙, 실제 실행 상태만 보완. Luna/medium은 두 UI 파일과 모든 날짜 사용처를 읽기 전용 검토, 확정 결함 없음 보고 후 종료했다. 스키마·권한·새 의존성 변경 없음. 티스토리 /155는 원문·개선 원고를 보관했으나 HTML 전환 확인창이 브라우저 제어를 막아 미저장 상태로 보류; 사용자는 지금 클릭할 수 없다고 답했다. 공개 글 변경 없음, 해당 탭의 종료도 실패했으므로 종료 완료로 기록하지 않는다.
- 종료 · 13:04 KST · 수동 시각의 PC/모바일 상세·게시 목록·캘린더 라벨을 URL 등록으로 구분. 기존 검사에 수동 등록/API 게시의 월 경계·예약·구형 기록 fallback 확인을 추가했으며 `npm run typecheck`, `npm test`, `npm run build`, `git diff --check` 통과. Luna 독립 검토 완료; 추가 Claude CLI Read 검토는 기존 Max 인증을 확인하고 API 인증 환경을 제거했으나 모델 미인식 출력 뒤 결과가 없어 해당 프로세스만 종료했다. 기존 Claude cloud PR 검토와 이번 Luna 검토·실행 검사를 근거로 최소 UI 변경을 통합하며 추가 검토 성공으로 주장하지 않는다. 현재 Instagram 공개 캡션에서 AI 제작 설명을 제거·재조회했고 플랫폼 라벨은 유지. 후속 Threads 관찰 원고를 캠페인 D에 연결해 누리원 UI로 초안 저장했다. 실제 배포·반응형 증거는 로컬 인계에 남긴다. 미해결: 티스토리 확인창, Meta 공식 API 연결, 아직 측정 시점이 안 된 성장 성과.
