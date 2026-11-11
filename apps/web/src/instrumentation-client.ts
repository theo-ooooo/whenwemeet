// (#185) 브라우저 오류 수집. NEXT_PUBLIC_SENTRY_DSN 이 비면 띄우지 않는다 (docs/운영/모니터링.md)
// 환경과 릴리스는 next.config.ts 가 빌드 때 넣는다. 화면 전환 추적(onRouterTransitionStart)은 트레이싱이라 쓰지 않는다
import * as Sentry from "@sentry/nextjs";
import { sentryOptions } from "@/lib/sentry";

const options = sentryOptions({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.SENTRY_CLIENT_ENVIRONMENT,
  release: process.env.SENTRY_CLIENT_RELEASE,
});
if (options) Sentry.init(options);
