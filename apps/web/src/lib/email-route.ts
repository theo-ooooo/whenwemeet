// (#245) 이메일 로그인 route handler 공통 (이메일-로그인.md 3장 CSRF, 쿠키, 6-1). 서버 전용.
// API 는 웹 서버만 부를 수 있다(X-Internal-Key, D-115). 키와 토큰, 가입 티켓은 httpOnly 쿠키로만 브라우저에 간다.
import { type NextRequest, NextResponse } from "next/server";
import { parseAppUserAgent } from "./app-bridge";
import { GROUP_COOKIE, looksLikeJwt, safeNext, SESSION_COOKIE, sessionCookieOptions } from "./auth";
import {
  clientIpOf,
  emailLoginEnabled,
  readAuthResult,
  readEmailErrorDetails,
  SIGNUP_COOKIE,
  SIGNUP_MAX_AGE,
  toDetailArray,
  type AuthResult,
} from "./email-login";
import { errorBody, okBody } from "./envelope";
import { isMock, upstream, type UpstreamResult } from "./upstream";

export const EMAIL_ROUTE_HEADERS = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } as const;

/** 웹 스위치 (D-119). 서버 컴포넌트와 route handler 공통 */
export function webEmailEnabled(): boolean {
  return emailLoginEnabled(process.env.EMAIL_LOGIN_ENABLED, isMock());
}

/** POST 의 Origin 이 자기 오리진과 같은가. 없으면 거절 (3장 CSRF) */
export function sameOrigin(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  return !!origin && origin === req.nextUrl.origin;
}

export function json(status: number, body: unknown): NextResponse {
  return NextResponse.json(body, { status, headers: EMAIL_ROUTE_HEADERS });
}

export const forbidden = () => json(403, errorBody(403, "FORBIDDEN", "허용되지 않은 요청이에요"));
export const notConfigured = () =>
  json(503, errorBody(503, "EMAIL_NOT_CONFIGURED", "지금은 이메일로 로그인할 수 없어요"));
export const badRequest = (message = "요청을 다시 확인해 주세요") => json(400, errorBody(400, "VALIDATION_FAILED", message));

/** 앱 셸 UA 면 "app" (lastAppLoginAt, D-97) */
export function clientKindOf(req: NextRequest): "web" | "app" {
  return parseAppUserAgent(req.headers.get("user-agent")) ? "app" : "web";
}

/** API 이메일 엔드포인트 호출 (`/auth/email/<name>`) */
export function callEmailApi(req: NextRequest, name: string, payload: Record<string, unknown>): Promise<UpstreamResult> {
  return upstream({
    method: "POST",
    path: `/auth/email/${name}`,
    body: JSON.stringify(payload),
    token: null,
    internal: { clientIp: clientIpOf(req.headers.get("x-forwarded-for"), req.headers.get("x-real-ip")) },
  });
}

type RawError = { status: number; code: string; message: string; details: unknown };

/** API 실패 응답을 읽는다. 봉투가 아니면(게이트웨이 오류) code INTERNAL */
export function readUpstreamError(r: UpstreamResult): RawError | null {
  if (r.status < 400) return null;
  const b = (r.body && typeof r.body === "object" ? r.body : {}) as Record<string, unknown>;
  const e = (b.error && typeof b.error === "object" ? b.error : {}) as Record<string, unknown>;
  return {
    status: r.status,
    code: typeof e.code === "string" ? e.code : "INTERNAL",
    message: typeof b.message === "string" ? b.message : "",
    details: e.details,
  };
}

/** API 실패를 웹 봉투로 옮긴다. details 는 객체여도 `[{ field, message }]` 로 바꿔 브라우저가 한 모양만 읽게 한다 */
export function relayError(e: RawError): NextResponse {
  return json(e.status, errorBody(e.status, e.code, e.message, toDetailArray(readEmailErrorDetails(e.details))));
}

/** API 성공 data 꺼내기 */
export function dataOf(r: UpstreamResult): unknown {
  const b = (r.body && typeof r.body === "object" ? r.body : {}) as Record<string, unknown>;
  return b.data;
}

function signupCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    maxAge: SIGNUP_MAX_AGE,
    secure: process.env.NODE_ENV === "production",
  };
}

export function setSession(res: NextResponse, token: string): NextResponse {
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
  // 다른 계정일 수 있으니 이전 팀 기억은 지운다 (/auth/app 과 같음)
  res.cookies.set(GROUP_COOKIE, "", { path: "/", maxAge: 0, sameSite: "lax" });
  return res;
}

export function clearSignup(res: NextResponse): NextResponse {
  res.cookies.set(SIGNUP_COOKIE, "", { path: "/", maxAge: 0, sameSite: "lax", httpOnly: true });
  return res;
}

/** link, code 의 결과 → 이동할 웹 경로와 쿠키. 모양이 틀리면 null */
export function applyAuthResult(data: unknown): { result: AuthResult; redirect: string } | null {
  const result = readAuthResult(data);
  if (!result || (result.kind === "SESSION" && !looksLikeJwt(result.token))) return null;
  return { result, redirect: result.kind === "SESSION" ? safeNext(result.next) : "/login/email/nickname" };
}

export function withAuthCookies(res: NextResponse, result: AuthResult): NextResponse {
  if (result.kind === "SESSION") return clearSignup(setSession(res, result.token));
  res.cookies.set(SIGNUP_COOKIE, result.signupToken, signupCookieOptions());
  return res;
}

export const ok = (data: unknown) => json(200, okBody(data));
