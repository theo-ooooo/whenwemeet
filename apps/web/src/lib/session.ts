// 세션 쿠키의 "쓸 만해 보이는지" 판정과 만료 처리 경로 (#37).
// 서명 검증은 API 만 한다. 여기서는 JWT payload 의 exp 만 서명 검증 없이 읽어
// 만료/깨진 쿠키 때문에 /login ↔ / 가 서로 리다이렉트하는 루프를 끊는다.
// proxy.ts, route handler, 서버 컴포넌트에서 함께 쓰므로 next/headers 를 import 하지 않는다. 브라우저 코드는 lib/auth.ts 의 상수만 쓴다.
import type { NextResponse } from "next/server";
import { EXPIRED_PATH, EXPIRED_REASON, GROUP_COOKIE, safeNext, SESSION_COOKIE } from "./auth";

export { EXPIRED_PATH, EXPIRED_REASON };

function decodeBase64Url(part: string): string | null {
  try {
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
    return atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  } catch {
    return null;
  }
}

/** JWT payload 의 exp(초). 모양이 틀리거나 디코드에 실패하거나 exp 가 없으면 null */
export function readJwtExp(token: string | null | undefined): number | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3 || parts.some((p) => !p)) return null;
  const json = decodeBase64Url(parts[1]);
  if (!json) return null;
  try {
    const payload: unknown = JSON.parse(json);
    if (!payload || typeof payload !== "object") return null;
    const exp = (payload as { exp?: unknown }).exp;
    return typeof exp === "number" && Number.isFinite(exp) ? exp : null;
  } catch {
    return null;
  }
}

/**
 * 세션 토큰이 아직 쓸 만해 보이는지. exp 가 미래면 true, 지났거나 읽을 수 없으면 false(만료 취급).
 * 목 모드(API_MOCK=1) 토큰은 'mock.<userId>.sig' 라 exp 가 없으므로 존재만 본다.
 */
export function isSessionUsable(token: string | null | undefined, nowSec = Date.now() / 1000): boolean {
  if (!token) return false;
  if (process.env.API_MOCK === "1") return true; // lib/upstream.ts isMock 과 같은 기준 (proxy 번들에 upstream 을 끌어오지 않으려고 직접 읽음)
  const exp = readJwtExp(token);
  return exp !== null && exp > nowSec;
}

/** 서버 쪽에서 401 을 받았을 때 보낼 곳: 쿠키를 지우고 /login 으로 넘기는 route handler */
export function expiredUrl(next: string | null | undefined): string {
  return `${EXPIRED_PATH}?next=${encodeURIComponent(safeNext(next))}`;
}

/** /login?next=...&reason=expired */
export function loginExpiredUrl(origin: string, next: string | null | undefined): URL {
  const url = new URL("/login", origin);
  url.searchParams.set("next", safeNext(next));
  url.searchParams.set("reason", EXPIRED_REASON);
  return url;
}

/** 응답에 세션 쿠키와 팀 기억 쿠키 삭제를 싣는다 (로그아웃과 같은 속성) */
export function clearSessionCookies(res: NextResponse): NextResponse {
  res.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0, httpOnly: true, sameSite: "lax" });
  res.cookies.set(GROUP_COOKIE, "", { path: "/", maxAge: 0, sameSite: "lax" });
  return res;
}
