# 언제볼까 (whenwemeet)

개인 또는 팀이 하나의 달력을 같이 쓰며 "언제 볼까?" 를 바로 잡는 공유 일정 서비스.

- 프론트 `apps/web` — Next.js 16
- 백엔드 `apps/api` — NestJS 12 + Prisma + MySQL 8
- 로그인 — 카카오

작업 규칙과 진행 방식은 [CLAUDE.md](./CLAUDE.md), 역할별 지침은 [agents/](./agents) 를 본다.

## 실행 (인프라 단계 완료 후 갱신 예정)
```bash
cp .env.example .env && cp apps/api/.env.example apps/api/.env && cp apps/web/.env.example apps/web/.env.local
docker compose up -d
pnpm install
pnpm dev   # web :3000, api :4000
```
