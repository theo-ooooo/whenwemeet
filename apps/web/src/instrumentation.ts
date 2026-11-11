// (#185) 서버(Node, Edge) 오류 수집. SENTRY_DSN 이 비면 띄우지 않는다 (docs/운영/모니터링.md)
import * as Sentry from "@sentry/nextjs";
import { serverSentryOptions } from "@/lib/sentry";

export function register(): void {
  const options = serverSentryOptions(process.env);
  if (options) Sentry.init(options);
}

/** 서버 컴포넌트, route handler, proxy 에서 던진 오류. SDK 가 꺼져 있으면 아무것도 하지 않는다 */
export const onRequestError = Sentry.captureRequestError;
