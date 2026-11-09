// 인증 관련 상수와 검증 (docs/설계/인증흐름.md)

export const SESSION_COOKIE = "wwm_session";
export const GROUP_COOKIE = "wwm_group";
export const SESSION_MAX_AGE = 2_592_000; // 30일
export const GROUP_MAX_AGE = 31_536_000; // 1년

/** next 는 `/` 로 시작하는 웹 경로만 허용, 아니면 `/` */
export function safeNext(raw: string | null | undefined): string {
  if (!raw) return "/";
  return /^\/[A-Za-z0-9/_-]*$/.test(raw) ? raw : "/";
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
