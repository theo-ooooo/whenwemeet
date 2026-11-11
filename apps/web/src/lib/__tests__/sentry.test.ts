import { describe, expect, it } from "vitest";
import { DROPPED_INTEGRATIONS, sentryOptions, serverSentryOptions, shouldReportBoundaryError } from "../sentry";
import { FILTERED } from "../sentry-scrub";

const DSN = "https://public@o0.ingest.sentry.io/0";

describe("sentryOptions", () => {
  it("DSN 이 비거나 공백이면 null (SDK 를 띄우지 않음)", () => {
    expect(sentryOptions({})).toBeNull();
    expect(sentryOptions({ dsn: "  " })).toBeNull();
    expect(serverSentryOptions({ NODE_ENV: "production" })).toBeNull();
  });

  it("오류만: 트레이싱 표본 없음, 개인정보 수집 끔, 세션 집계 뺌", () => {
    const o = sentryOptions({ dsn: ` ${DSN} `, environment: "production", release: "abc123" });
    expect(o).toMatchObject({ dsn: DSN, environment: "production", release: "abc123", tracesSampleRate: undefined });
    expect(o?.dataCollection).toMatchObject({ userInfo: false, cookies: false, httpBodies: [], urlQueryParams: false, stackFrameVariables: false });
    const kept = o?.integrations([{ name: "GlobalHandlers" }, ...DROPPED_INTEGRATIONS.map((name) => ({ name }))]);
    expect(kept).toEqual([{ name: "GlobalHandlers" }]);
    expect(sentryOptions({ dsn: DSN })).not.toHaveProperty("release");
    expect(sentryOptions({ dsn: DSN })?.environment).toBe("development");
  });

  it("beforeSend, beforeBreadcrumb 가 거른다", () => {
    const o = sentryOptions({ dsn: DSN });
    expect(o?.beforeSend({ message: "a@b.com" })).toEqual({ message: FILTERED });
    expect(o?.beforeBreadcrumb({ category: "fetch", data: { url: "/api/x?token=t" } })).toEqual({ category: "fetch", data: { url: `/api/x?token=${FILTERED}` } });
  });

  it("서버 환경은 SENTRY_ENVIRONMENT > VERCEL_ENV > NODE_ENV, 릴리스는 VERCEL_GIT_COMMIT_SHA", () => {
    expect(serverSentryOptions({ SENTRY_DSN: DSN, SENTRY_ENVIRONMENT: "staging", VERCEL_ENV: "production", NODE_ENV: "production" })?.environment).toBe("staging");
    expect(serverSentryOptions({ SENTRY_DSN: DSN, VERCEL_ENV: "preview", NODE_ENV: "production" })?.environment).toBe("preview");
    expect(serverSentryOptions({ SENTRY_DSN: DSN, NODE_ENV: "production", VERCEL_GIT_COMMIT_SHA: "sha1" })).toMatchObject({ environment: "production", release: "sha1" });
  });
});

describe("shouldReportBoundaryError", () => {
  it("digest 가 있으면(서버 오류) 보내지 않는다", () => {
    expect(shouldReportBoundaryError({})).toBe(true);
    expect(shouldReportBoundaryError({ digest: "123" })).toBe(false);
  });
});
