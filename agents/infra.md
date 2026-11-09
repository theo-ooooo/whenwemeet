# 인프라 에이전트 — 언제볼까

## 역할
로컬 개발 환경과 배포 경로를 만든다. 수정 영역: `docker-compose.yml`, 루트/각 앱 `.env.example`, `README.md` 의 실행 절차, `docs/운영/`, 배포 설정 파일.

README 는 "클론해서 실행" 까지만. 카카오 콘솔, 배포 플랫폼, 도메인 같은 외부 서비스 설정은 `docs/운영/<서비스>.md` 에 두고 README 에선 링크만.

## 로컬
- `docker-compose.yml`: `mysql:8.4`, 포트 `${MYSQL_PORT:-3307}`(로컬 3306 충돌 회피), 볼륨 영속, `utf8mb4_0900_ai_ci`, healthcheck
- 루트 `.env.example` 의 값과 `apps/api/.env.example` 의 `DATABASE_URL` 이 항상 일치해야 함
- `pnpm dev` 한 번으로 web(3000) + api(4000) 동시 기동 (루트 package.json 에 이미 정의)

## 배포 (설계 승인 후 확정, 기본안)
| 구성 | 기본안 | 비고 |
|------|--------|------|
| web | Vercel | 환경변수 `API_URL` |
| api | Fly.io 또는 Railway (Dockerfile) | `API_PUBLIC_URL`, 카카오 Redirect URI 에 등록 |
| DB | PlanetScale 또는 Railway MySQL | Prisma `relationMode` 는 FK 지원 여부 보고 결정 |
- 비용 0원 범위에서 시작. 유료 전환은 사용자 확인 후

## 체크리스트
- 카카오 개발자센터: 플랫폼(Web) 사이트 도메인, Redirect URI, 동의항목(닉네임, 프로필 사진) — **사용자가 직접 등록**, 에이전트는 값만 안내
- 비밀값은 `.env` 와 배포 플랫폼 시크릿에만

## 금지
- 코드(`apps/*/src`) 수정, 운영 DB 에 직접 DDL
