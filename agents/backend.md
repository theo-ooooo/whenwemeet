# 백엔드 에이전트 — 언제볼까 (NestJS + Prisma + MySQL)

## 역할
`docs/설계/api.md`, `schema.prisma`, `인증흐름.md` 를 그대로 구현한다. 수정 영역은 `apps/api/` 만.

## 시작 전
1. `CLAUDE.md`, 설계 3개 파일 읽기
2. `apps/api/.env.example` → `.env` 복사 후 값 채움 (DB 는 인프라 에이전트의 docker-compose)
3. `pnpm --filter @whenwemeet/api install`

## 구조
```
apps/api/src/
  main.ts            CORS(WEB_ORIGIN), ValidationPipe(whitelist), prefix v1
  app.module.ts
  prisma/            PrismaModule(Global) + PrismaService
  auth/              kakao 콜백, JWT 발급/검증 Guard, @CurrentUser
  groups/            팀 생성/초대코드 참여/탈퇴/멤버
  events/            일정 CRUD (기간 조회 from~to)
  common/            응답 봉투 인터셉터, 예외 필터
apps/api/prisma/schema.prisma, migrations/
```

## 계층 (반드시)
```
Controller → Service → Repository → PrismaService
```
- **Prisma 호출(`prisma.*`, `$transaction`)은 `*.repository.ts` 에만 둔다.** Service 에는 쿼리가 한 줄도 없어야 한다. Service 는 권한 판단, 규칙, 조합만
- Repository 는 도메인 단위: `users`, `groups`, `memberships`, `events`, `anniversaries`, `event-logs`. 메서드 이름은 의도를 드러내게 (`findMemberGroupIds(userId)`, `listBusyRanges(groupIds, from, to)`), `select` 는 Repository 안에서 고정
- 여러 테이블을 한 트랜잭션으로 묶어야 하면 Repository 에 그 단위의 메서드를 하나 둔다 (`leaveGroupTx(...)`). Service 가 `$transaction` 을 열지 않는다
- 테스트: Service 는 Repository 목, Repository 는 실 DB(e2e) 로

## 규칙
- ESM(`"type": "module"`) 이므로 상대 import 는 `.js` 확장자 필수
- DTO 는 class-validator, 전역 `ValidationPipe({ whitelist, transform, forbidNonWhitelisted })`
- Prisma: 마이그레이션은 `prisma migrate dev --name <스네이크>`. 생성된 SQL 을 손으로 고치지 않음
- 권한: 모든 groups/events 서비스 메서드 첫 줄에서 멤버십 확인. 아니면 `ForbiddenException`
- 카카오: `https://kauth.kakao.com/oauth/token`, `https://kapi.kakao.com/v2/user/me`. 수집은 id, nickname, profile_image 만
- JWT: `@nestjs/jwt`, 클레임 `{ sub: userId }`, 만료 `JWT_EXPIRES_IN`
- 비밀값은 `ConfigService.getOrThrow` 로만 읽음. 하드코딩 금지

## 테스트
- vitest. 서비스 단위 테스트는 Repository 를 목으로, Repository 와 컨트롤러는 `test/` 의 e2e(supertest, 실 DB) 로
- 커밋 전 `pnpm --filter @whenwemeet/api test` 와 `build` 통과

## 금지
- `apps/web/` 수정, 설계에 없는 엔드포인트 추가
- 프론트 편의를 위한 CORS `*`
