# 언제볼까 API 운영 이미지 (#50, docs/운영/배포.md)
# 빌드 컨텍스트는 저장소 루트다 (pnpm workspace 의 lockfile 을 써야 해서):
#   docker build -f apps/api/Dockerfile -t whenwemeet-api .
# Railway 는 서비스 변수 RAILWAY_DOCKERFILE_PATH=apps/api/Dockerfile 로 이 파일을 쓴다 (docs/운영/railway.md)

ARG NODE_IMAGE=node:24-bookworm-slim
ARG PNPM_VERSION=9.12.3

# ---------- 1. 의존성 + 빌드 ----------
FROM ${NODE_IMAGE} AS build
ARG PNPM_VERSION
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate
WORKDIR /repo

# lockfile 만으로 패키지를 먼저 받아 둔다 (소스만 바뀐 빌드는 이 층을 재사용).
# install/deploy 에 --offline 을 붙이지 않는다: deploy 가 peer 를 다시 풀며 fetch 에 없는 메타데이터를 찾는다 (#76)
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
# pnpm patchedDependencies(모바일 iOS 빌드용 expo-modules-jsi 패치)가 root package.json 에 있어 패치 파일이 없으면 fetch 가 실패한다
COPY patches ./patches
RUN pnpm fetch

COPY apps/api ./apps/api
RUN pnpm install --frozen-lockfile --filter @whenwemeet/api \
 && pnpm --filter @whenwemeet/api build \
 && pnpm --filter @whenwemeet/api deploy --prod /out \
 && rm -rf /out/src /out/test /out/.env*

# ---------- 2. 실행 ----------
FROM ${NODE_IMAGE} AS runtime
# prisma migrate 의 schema engine 이 libssl 을 찾는다
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /out ./
USER node

# Railway 는 PORT 를 주입한다. 없으면 main.ts 기본값 4000
EXPOSE 4000
# 기동 전에 마이그레이션을 적용한다. 실패하면 컨테이너가 죽고 healthcheck 가 통과하지 않아 이전 배포가 계속 산다
CMD ["sh", "-c", "node_modules/.bin/prisma migrate deploy && exec node dist/main.js"]
