# 누리원 협업

작업 전에 [docs/COLLAB.md](docs/COLLAB.md)와 [AGENTS.md](AGENTS.md)를 읽는다. 역할·파일 소유권·실제 도구 상태·검증·남은 일은 공통 문서에 기록한다.

Claude는 배정받은 구현을 `claude/*`에서 검사·commit·push·PR까지 직접 진행한다. `main`과 `codex/*`는 수정하지 않는다. Codex와 서로 독립 검토하고, 정확한 근거로 지적·수정·재확인한다. 사용자 비밀키·비공개 원문은 커밋하지 않는다. 기존 구독과 사용자 승인 범위를 존중하며 추가 과금과 권한 우회를 켜지 않는다.

## 통합 안정화 (2026-11-16)

nhholdings.xyz 하나가 누리원(운영실)과 누리마켓(쇼핑몰)을 함께 호스팅한다. 이 저장소가 정본이고 Mac의 `NURI ONE`·`NURI MARKET` 폴더는 레거시 샘플이다. 작업 전 `docs/UNIFIED-ONE-MARKET.md`(설계·수용 기준)와 `docs/ops/TASKS.json`(작업 원장, 정본)을 읽는다. 우선순위는 P0(T1~T4) → P1. 완료는 실행 증거로만 주장하고 로컬·미리보기·운영 검증을 구분한다.

- `.claude/hooks/nh-guard.mjs`가 Edit/Write 전에 클라이언트 번들(`src/components`, `public/`)의 비밀 환경변수 참조, 비밀 키 문자열, 코드에서의 `LIVE_APPROVED`·`MARKET_MODE` 변경, `.private/` 수정을 차단한다. `.env*`·`.private/`는 읽지 않는다. 환경변수 값을 읽지 않고, 운영 DB에 쓰지 않으며, 실결제·`MARKET_MODE` 변경을 하지 않는다.
- 위 규칙과 `AGENTS.md`·`docs/COLLAB.md`의 브랜치 규칙(`claude/*`만 수정)이 충돌하면 더 엄격한 쪽을 따른다.
