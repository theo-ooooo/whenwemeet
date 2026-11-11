// (#185) 웹 오류 수집 공통 옵션 (docs/운영/모니터링.md, 결정기록 D-149).
// - DSN 이 비면 SDK 를 아예 띄우지 않는다 (로컬, 테스트, CI). 브라우저는 NEXT_PUBLIC_SENTRY_DSN, 서버는 SENTRY_DSN
// - 오류만 보낸다. 트레이싱, 리플레이, 로그, 세션 집계는 켜지 않는다 (무료 한도 월 5천 건)
// - 개인정보: SDK 수집을 dataCollection 으로 끄고, beforeSend/beforeBreadcrumb 에서 한 번 더 지운다
import { scrubBreadcrumb, scrubEvent } from "./sentry-scrub";

/** Sentry.init 에 넘기는 옵션 중 여기서 정하는 것. 브라우저, 서버 SDK 양쪽 옵션에 공통으로 있는 항목만 쓴다 */
export interface SentryCommonOptions {
  dsn: string;
  environment: string;
  release?: string;
  tracesSampleRate: undefined;
  dataCollection: {
    userInfo: false;
    cookies: false;
    httpHeaders: { request: { allow: string[] }; response: false };
    httpBodies: [];
    urlQueryParams: false;
    stackFrameVariables: false;
  };
  integrations: (defaults: Array<{ name: string }>) => Array<{ name: string }>;
  beforeSend: <T extends object>(event: T) => T;
  beforeBreadcrumb: <T extends object>(crumb: T) => T;
}

/** 세션(릴리스 상태) 집계. 오류가 아니라서 끈다 */
export const DROPPED_INTEGRATIONS = ["BrowserSession", "ProcessSession"];

function text(value: string | undefined): string {
  return value?.trim() ?? "";
}

/**
 * dsn 이 비면 null. environment 는 SENTRY_ENVIRONMENT > VERCEL_ENV > NODE_ENV,
 * release 는 빌드한 커밋 (Vercel 의 VERCEL_GIT_COMMIT_SHA). 브라우저용 값은 next.config.ts 가 빌드 때 넣는다
 */
export function sentryOptions(input: { dsn?: string; environment?: string; release?: string }): SentryCommonOptions | null {
  const dsn = text(input.dsn);
  if (!dsn) return null;
  const release = text(input.release);
  return {
    dsn,
    environment: text(input.environment) || "development",
    ...(release ? { release } : {}),
    tracesSampleRate: undefined,
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: { request: { allow: ["accept", "accept-language", "content-length", "content-type", "host", "user-agent"] }, response: false },
      httpBodies: [],
      urlQueryParams: false,
      stackFrameVariables: false,
    },
    integrations: (defaults) => defaults.filter((i) => !DROPPED_INTEGRATIONS.includes(i.name)),
    beforeSend: (event) => scrubEvent(event),
    beforeBreadcrumb: (crumb) => scrubBreadcrumb(crumb),
  };
}

/** 서버(Node, Edge) 런타임 옵션 */
export function serverSentryOptions(env: Record<string, string | undefined>): SentryCommonOptions | null {
  return sentryOptions({
    dsn: env.SENTRY_DSN,
    environment: text(env.SENTRY_ENVIRONMENT) || text(env.VERCEL_ENV) || text(env.NODE_ENV),
    release: env.VERCEL_GIT_COMMIT_SHA,
  });
}

/** 렌더 오류 경계(error.tsx, global-error.tsx) 가 보낼지. digest 가 있으면 서버에서 난 오류라 onRequestError 가 이미 보냈다 */
export function shouldReportBoundaryError(error: { digest?: string }): boolean {
  return !error.digest;
}
