# CLAUDE.md — 언제볼까 (whenwemeet)

이 디렉토리 안에서 작업할 때는 상위 `cce-ai-hub/CLAUDE.md` 대신 **이 파일을 따른다** (CCE 규칙은 적용하지 않음).

## 한 줄 정의
개인 / 커플 / 가족 / 팀이 하나의 달력을 같이 쓰며 "언제 볼까?" 를 바로 잡는 공유 일정 서비스. 실서비스 목표. 모바일 웹 우선, 같은 웹을 띄우는 iOS/Android 앱(Expo 셸) 병행.

## 확정 사항 (2026-11-09)
| 항목 | 결정 |
|------|------|
| 이름 | 언제볼까 / `whenwemeet` |
| 도메인 | `whenwemeet.day` (웹), `api.whenwemeet.day` (API), `images.whenwemeet.day` (R2 공개). `.app/.io` 는 타인 소유라 쓰지 않음 |
| 단위 | **팀(Group)** — type: `personal`(나만), `team`(여럿). 커플/가족도 전부 team. 한 사용자가 여러 팀 소속 가능 |
| MVP 범위 | 기본 일정 + 기념일 D-day + 빈 시간 찾기. 알림은 제외(앱 안 '새 소식'만). 초대는 링크 + 6자리 코드 |
| 프론트 | Next.js 16 (App Router, TS, Tailwind 4) — `apps/web` |
| 백엔드 | NestJS 12 — `apps/api`, prefix `/v1` |
| DB | MySQL 8 (docker-compose) + **Prisma** |
| 인증 | 카카오 로그인을 NestJS 가 직접 OAuth 처리 → 자체 JWT 발급. 브라우저는 httpOnly 쿠키, Next route handler 가 API 로 프록시 |
| 앱 | Expo 셸 + WebView 로 `whenwemeet.day` 를 띄움 — `apps/mobile`. 번들/패키지 `day.whenwemeet.app`, 로그인은 카카오 SDK + Sign in with Apple, 세션은 handoff → 웹 쿠키 (D-42 ~ D-48, `docs/기획/앱.md`) |
| 패키지 | pnpm workspace (`apps/*`) |
| 언어 | 코드 주석, 문서, 커밋 메시지 한국어 |

## 작업 흐름 (pstack, #574)
에이전트 작업 흐름은 pstack 플러그인(`michael-denyer/pstack-claude`, `.claude/settings.json` 에 프로젝트 범위로 켜 둠)을 따른다.
- 여러 파일, 설계 선택, 원인 모르는 버그, 성능 문제는 `pstack:poteto-mode` 로 시작한다. 한 파일 작은 수정, 질문은 바로 한다
- 의도가 분명하면 해당 스킬로 바로: `pstack:tdd`, `pstack:architect`, `pstack:how`, `pstack:why`
- **이 파일과 아래 프로젝트 스킬이 pstack 기본값보다 우선한다**

| 프로젝트 스킬 | 언제 |
|---------------|------|
| `wwm-release` | 머지 뒤 버전 올림, develop → main 릴리스, 태그, Railway, Vercel 확인, 앱 빌드 |
| `wwm-test-db` | API 테스트, 마이그레이션, API 작업 위임 (전용 `wwm_<이슈>_test`) |
| `wwm-mock-qa` | 화면 변경을 API_MOCK 서버와 ego-browser 로 확인 |
| `wwm-decision-record` | 결정을 `docs/설계/결정기록.md` 에 D-번호로 |

- 이슈는 묻지 않고 스스로 우선순위와 설계를 정한다. 결정은 PR 과 D-번호에 남긴다. 돈, 스토어 제출, 약관 동의는 먼저 보고
- 큰 기능은 기획(`docs/기획/`) → 설계(`docs/설계/`) 문서를 먼저 쓰고 구현한다. 사용자 승인 대기는 사용자가 요청한 경우에만

## 영역별 안내 (`agents/`)
영역 작업 때 해당 md 의 규칙(계층, 수정 가능 영역, 금지)을 함께 따른다. 서브에이전트에는 이 파일 + 해당 md + 관련 스킬 경로만 넘긴다.

| 역할 | 파일 | 수정 가능 영역 | 산출물 |
|------|------|---------------|--------|
| 기획 | `agents/planning.md` | `docs/기획/` | `docs/기획/<주제>.md` |
| 설계 | `agents/design.md` | `docs/설계/` | 화면 흐름, API 명세, Prisma 스키마 초안 |
| 백엔드 | `agents/backend.md` | `apps/api/`, `apps/api/prisma/` | Nest 모듈, 마이그레이션, 테스트 |
| 프론트 | `agents/frontend.md` | `apps/web/` | 화면, 컴포넌트, 프록시 라우트 |
| 모바일 | `agents/mobile.md` | `apps/mobile/` | Expo 셸, 네이티브 로그인, 브리지, EAS 빌드 설정 |
| 인프라 | `agents/infra.md` | `docker-compose.yml`, `.env.example`, 배포 설정 | 로컬 환경, 배포 절차 |
| QA | `agents/qa.md` | `docs/QA/` | 시나리오 테스트 결과 |

## Git 정책
- 원격: `github.com/theo-ooooo/whenwemeet`. 커밋 계정은 이 저장소 로컬 설정(theo-ooooo / kkw.theo@gmail.com) 사용
- 브랜치 흐름: `feature → develop → main`. `develop` 이 기본 브랜치(통합), `main` 은 배포본. 둘 다 직접 push 금지. **모든 변경은 이슈 → 브랜치 → PR(→ develop) → 머지**
- 배포는 `develop → main` PR 하나로 (제목 `release: vX.Y.Z`), **머지 커밋으로 머지**(`gh pr merge --merge`) 후 태그. squash 하면 main 에 develop 에 없는 커밋이 생겨 다음 릴리스가 충돌한다 (#79)
- 브랜치: `<type>/<이슈번호>-<짧은-영문>` (예: `docs/1-planning`, `feat/4-auth-kakao`, `fix/12-event-overlap`)
- 커밋: `<type>: 메시지 (#이슈번호)` — type 은 feat, fix, docs, chore, refactor, test, infra
- PR 제목 = 커밋 type 규칙과 동일. 본문은 `.github/PULL_REQUEST_TEMPLATE.md` 채움. 기능/수정 PR(→ develop) 머지는 squash
- GATE 승인(기획/설계) 은 **해당 PR 승인 또는 "기획 승인" 댓글** 로 대체
- 이슈 라벨: `planning` `design` `backend` `frontend` `mobile` `infra` `qa` `bug`. 마일스톤 `MVP`
- **병렬 작업은 각자 `git worktree`** 에서 한다 (`git worktree add ../whenwemeet-<이슈> -b <브랜치> develop`). 한 워킹 트리에서 두 에이전트가 브랜치를 바꾸면 서로의 파일이 섞인다

## 토큰 절약 규칙
- 에이전트 md 는 **그 역할에 필요한 것만** 담는다. 공통 내용은 이 파일에만 둔다.
- 서브 에이전트에 위임할 때 이 파일 + 해당 역할 md + 직전 단계 산출물 경로만 넘긴다. 대화 내역을 통째로 넘기지 않는다.
- 산출물은 결정 사항 중심으로 쓴다. 대안 나열, 배경 설명 반복 금지.
- 진행 상태는 `docs/status/YYYY-MM-DD_HHMMSS.json` 에 기록하고, 컨텍스트 압축 후에는 최신 파일을 먼저 읽는다.

## 디렉토리
```
whenwemeet/
  CLAUDE.md          ← 이 파일
  agents/            ← 영역별 규칙
  .claude/           ← pstack 설정, 프로젝트 스킬
  docs/기획 docs/설계 docs/QA docs/status
  apps/web           ← Next.js
  apps/api           ← NestJS (+ prisma/)
  apps/mobile        ← Expo 셸 (WebView)
  docker-compose.yml ← MySQL (인프라 단계에서 생성)
```

## 금지
- Supabase, 다른 DB 재도입 제안 (결정 완료)
- 커플 전용 용어를 코드/스키마에 쓰는 것 (`couple` 대신 `group`)
- 비밀값(.env) 커밋, 카카오 Client Secret 을 문서에 기록
