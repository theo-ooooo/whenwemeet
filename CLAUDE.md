# CLAUDE.md — 언제볼까 (whenwemeet)

이 디렉토리 안에서 작업할 때는 상위 `cce-ai-hub/CLAUDE.md` 대신 **이 파일을 따른다** (CCE 규칙은 적용하지 않음).

## 한 줄 정의
개인 / 커플 / 가족 / 팀이 하나의 달력을 같이 쓰며 "언제 볼까?" 를 바로 잡는 공유 일정 서비스. 실서비스 목표. 모바일 웹 우선.

## 확정 사항 (2026-11-09)
| 항목 | 결정 |
|------|------|
| 이름 | 언제볼까 / `whenwemeet` |
| 단위 | **팀(Group)** — type: `personal`(나만), `team`(여럿). 커플/가족도 전부 team. 한 사용자가 여러 팀 소속 가능 |
| MVP 범위 | 기본 일정 + 기념일 D-day + 빈 시간 찾기. 알림은 제외(앱 안 '새 소식'만). 초대는 링크 + 6자리 코드 |
| 프론트 | Next.js 16 (App Router, TS, Tailwind 4) — `apps/web` |
| 백엔드 | NestJS 12 — `apps/api`, prefix `/v1` |
| DB | MySQL 8 (docker-compose) + **Prisma** |
| 인증 | 카카오 로그인을 NestJS 가 직접 OAuth 처리 → 자체 JWT 발급. 브라우저는 httpOnly 쿠키, Next route handler 가 API 로 프록시 |
| 패키지 | pnpm workspace (`apps/*`) |
| 언어 | 코드 주석, 문서, 커밋 메시지 한국어 |

## 파이프라인
```
/기획 → 기획 승인 → /설계 → 설계 승인 → /백엔드 + /프론트 + /인프라 (병렬) → /QA
```
- 각 단계는 `agents/<역할>.md` 를 **먼저 읽고** 그 범위 안에서만 작업한다.
- 승인은 사용자가 "기획 승인", "설계 승인" 으로 입력.
- 승인 전 단계의 산출물(코드)을 미리 만들지 않는다. 현재 `apps/` 는 CLI 스캐폴드만 있고 기능 코드는 없다.

## 에이전트
| 역할 | 파일 | 수정 가능 영역 | 산출물 |
|------|------|---------------|--------|
| 기획 | `agents/planning.md` | `docs/기획/` | `docs/기획/<주제>.md` |
| 설계 | `agents/design.md` | `docs/설계/` | 화면 흐름, API 명세, Prisma 스키마 초안 |
| 백엔드 | `agents/backend.md` | `apps/api/`, `apps/api/prisma/` | Nest 모듈, 마이그레이션, 테스트 |
| 프론트 | `agents/frontend.md` | `apps/web/` | 화면, 컴포넌트, 프록시 라우트 |
| 인프라 | `agents/infra.md` | `docker-compose.yml`, `.env.example`, 배포 설정 | 로컬 환경, 배포 절차 |
| QA | `agents/qa.md` | `docs/QA/` | 시나리오 테스트 결과 |

## Git 정책
- 원격: `github.com/theo-ooooo/whenwemeet`. 커밋 계정은 이 저장소 로컬 설정(theo-ooooo / kkw.theo@gmail.com) 사용
- `main` 에 직접 push 금지. **모든 변경은 이슈 → 브랜치 → PR → 머지**
- 브랜치: `<type>/<이슈번호>-<짧은-영문>` (예: `docs/1-planning`, `feat/4-auth-kakao`, `fix/12-event-overlap`)
- 커밋: `<type>: 메시지 (#이슈번호)` — type 은 feat, fix, docs, chore, refactor, test, infra
- PR 제목 = 커밋 type 규칙과 동일. 본문은 `.github/PULL_REQUEST_TEMPLATE.md` 채움. 머지는 squash
- GATE 승인(기획/설계) 은 **해당 PR 승인 또는 "기획 승인" 댓글** 로 대체
- 이슈 라벨: `planning` `design` `backend` `frontend` `infra` `qa` `bug`. 마일스톤 `MVP`
- **병렬 작업은 각자 `git worktree`** 에서 한다 (`git worktree add ../whenwemeet-<이슈> -b <브랜치> main`). 한 워킹 트리에서 두 에이전트가 브랜치를 바꾸면 서로의 파일이 섞인다

## 토큰 절약 규칙
- 에이전트 md 는 **그 역할에 필요한 것만** 담는다. 공통 내용은 이 파일에만 둔다.
- 서브 에이전트에 위임할 때 이 파일 + 해당 역할 md + 직전 단계 산출물 경로만 넘긴다. 대화 내역을 통째로 넘기지 않는다.
- 산출물은 결정 사항 중심으로 쓴다. 대안 나열, 배경 설명 반복 금지.
- 진행 상태는 `docs/status/YYYY-MM-DD_HHMMSS.json` 에 기록하고, 컨텍스트 압축 후에는 최신 파일을 먼저 읽는다.

## 디렉토리
```
whenwemeet/
  CLAUDE.md          ← 이 파일
  agents/            ← 역할별 하네스
  docs/기획 docs/설계 docs/QA docs/status
  apps/web           ← Next.js
  apps/api           ← NestJS (+ prisma/)
  docker-compose.yml ← MySQL (인프라 단계에서 생성)
```

## 금지
- Supabase, 다른 DB 재도입 제안 (결정 완료)
- 커플 전용 용어를 코드/스키마에 쓰는 것 (`couple` 대신 `group`)
- 비밀값(.env) 커밋, 카카오 Client Secret 을 문서에 기록
