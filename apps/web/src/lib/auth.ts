// 인증 관련 상수와 검증 (docs/설계/인증흐름.md)

export const SESSION_COOKIE = "wwm_session";
export const GROUP_COOKIE = "wwm_group";
export const SESSION_MAX_AGE = 2_592_000; // 30일
export const GROUP_MAX_AGE = 31_536_000; // 1년

/** 만료 세션 쿠키를 정리하는 route handler 경로 (app/auth/expired/route.ts, #37) */
export const EXPIRED_PATH = "/auth/expired";
/** /login 에 붙는 만료 표시. 이 값이 있으면 /login 은 쿠키와 무관하게 항상 화면을 그린다 (루프 차단, #37) */
export const EXPIRED_REASON = "expired";

/** 경로 부분에 허용하는 글자 (API 의 next 검사와 같은 규칙) */
const NEXT_PATH = /^\/[A-Za-z0-9/_-]*$/;

/**
 * next 는 같은 사이트의 웹 경로(+쿼리)만 허용, 아니면 `/`.
 * 세션 만료 후 돌아올 달력은 항상 `?date=` 가 붙어 있어 쿼리를 살린다 (#65). 해시는 버린다.
 */
export function safeNext(raw: string | null | undefined): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) return "/";
  try {
    const base = "http://wwm.invalid";
    const u = new URL(raw, base);
    if (u.origin !== base || !NEXT_PATH.test(u.pathname)) return "/";
    return u.pathname + u.search;
  } catch {
    return "/";
  }
}

// API(`/v1/auth/kakao`) 는 OAuth state 에 next 를 싣고 `^/[A-Za-z0-9/_-]*$` 로 검사해 쿼리가 있으면 `/` 로 바꾼다.
// 쿼리를 base64url 로 바꿔 경로 끝에 붙여 보내고(`<경로>/_q_/<b64>`), 콜백에서 되돌린다 (#65)
const QUERY_MARK = "/_q_/";

function toBase64Url(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(s: string): string | null {
  try {
    const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
    return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  } catch {
    return null;
  }
}

/** next 를 API 검사(`^/[A-Za-z0-9/_-]*$`)를 통과하는 모양으로. 쿼리가 없으면 그대로 */
export function encodeNextForApi(next: string): string {
  const safe = safeNext(next);
  const i = safe.indexOf("?");
  if (i < 0) return safe;
  const path = safe.slice(0, i);
  return `${path === "/" ? "" : path}${QUERY_MARK}${toBase64Url(safe.slice(i + 1))}`;
}

/** encodeNextForApi 의 반대. 콜백이 받은 next 를 원래 경로(+쿼리)로 되돌리고 다시 safeNext 로 검사한다 */
export function decodeNextFromApi(raw: string | null | undefined): string {
  if (!raw) return "/";
  const m = /^(.*)\/_q_\/([A-Za-z0-9_-]+)$/.exec(raw);
  if (!m) return safeNext(raw);
  const query = fromBase64Url(m[2]);
  if (query === null) return safeNext(m[1] || "/");
  return safeNext(`${m[1] || "/"}?${query}`);
}

/** JWT 모양(점으로 나뉜 3조각) 만 확인. 서명 검증은 API 가 한다 */
export function looksLikeJwt(token: string | null | undefined): token is string {
  if (!token) return false;
  const parts = token.split(".");
  return parts.length === 3 && parts.every((p) => p.length > 0);
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    maxAge: SESSION_MAX_AGE,
    secure: process.env.NODE_ENV === "production",
  };
}
