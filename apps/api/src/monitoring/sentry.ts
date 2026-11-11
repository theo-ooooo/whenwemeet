import * as Sentry from '@sentry/nestjs';
import type { NodeOptions } from '@sentry/nestjs';
import { ApiException, type ErrorCode } from '../common/errors.js';
import { scrubBreadcrumb, scrubEvent } from './sentry-scrub.js';

/**
 * (#185) API 오류 수집 (docs/운영/모니터링.md, 결정기록 D-149).
 * - `SENTRY_DSN` 이 비면 SDK 를 아예 띄우지 않는다 (로컬, 테스트, CI). 이때 `reportError` 는 아무것도 하지 않는다
 * - 오류만 보낸다. 트레이싱, 프로파일링, 로그는 켜지 않는다 (무료 한도 월 5천 건)
 * - 개인정보: SDK 수집을 `dataCollection` 으로 끄고, `beforeSend`/`beforeBreadcrumb` 에서 한 번 더 지운다
 */

/** 의도해서 던지는 5xx 중 보고하지 않는 코드. 설정이 비었거나(503) DB 점검(health) 은 버그가 아니라 상태다 */
export const QUIET_5XX_CODES: ReadonlySet<ErrorCode> = new Set<ErrorCode>([
  'KAKAO_NOT_CONFIGURED',
  'APPLE_NOT_CONFIGURED',
  'STORAGE_NOT_CONFIGURED',
  'EMAIL_NOT_CONFIGURED',
  'DB_UNAVAILABLE',
]);

/** SDK 가 스스로 모으는 것을 모두 끈다. 헤더는 진단에 필요한 몇 개만 (나머지는 scrubEvent 가 한 번 더 거른다) */
export const PRIVATE_DATA_COLLECTION: NonNullable<NodeOptions['dataCollection']> = {
  userInfo: false,
  cookies: false,
  httpHeaders: { request: { allow: ['accept', 'accept-language', 'content-length', 'content-type', 'host', 'user-agent'] }, response: false },
  httpBodies: [],
  urlQueryParams: false,
  graphQL: { document: false, variables: false },
  genAI: { inputs: false, outputs: false },
  mcp: { inputs: false, outputs: false },
  databaseQueryData: false,
  queues: false,
  stackFrameVariables: false,
};

function text(value: string | undefined): string {
  return value?.trim() ?? '';
}

/** env 로 init 옵션을 만든다. DSN 이 비면 null (끔) */
export function sentryOptions(env: NodeJS.ProcessEnv): NodeOptions | null {
  const dsn = text(env.SENTRY_DSN);
  if (!dsn) return null;
  return {
    dsn,
    environment: text(env.SENTRY_ENVIRONMENT) || text(env.NODE_ENV) || 'development',
    // release 는 비워 두면 SDK 가 SENTRY_RELEASE, RAILWAY_GIT_COMMIT_SHA 순으로 채운다
    tracesSampleRate: undefined,
    tracesSampler: undefined,
    dataCollection: PRIVATE_DATA_COLLECTION,
    beforeSend: (event) => scrubEvent(event),
    beforeBreadcrumb: (crumb) => scrubBreadcrumb(crumb),
  };
}

/** main.ts 가 Nest 를 만들기 전에 한 번 부른다. 켜졌으면 true */
export function initSentry(env: NodeJS.ProcessEnv = process.env): boolean {
  const options = sentryOptions(env);
  if (!options) return false;
  Sentry.init(options);
  return true;
}

/** 이 예외를 Sentry 로 보낼지. 5xx 만, 그중 의도한 상태(설정 없음, DB 점검)는 빼고 */
export function shouldReport(exception: unknown, status: number): boolean {
  if (status < 500) return false;
  return !(exception instanceof ApiException && QUIET_5XX_CODES.has(exception.code));
}

/** 오류 하나를 보낸다. SDK 가 꺼져 있으면 아무것도 하지 않는다. `where` 는 HTTP 밖(스케줄러 등)에서 난 곳 */
export function reportError(exception: unknown, where?: string): void {
  if (!Sentry.isInitialized()) return;
  Sentry.captureException(exception, where ? { tags: { where } } : undefined);
}
