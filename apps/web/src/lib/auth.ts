// 인증 관련 상수와 검증 (docs/설계/인증흐름.md)

export const SESSION_COOKIE = "wwm_session";
export const GROUP_COOKIE = "wwm_group";
export const SESSION_MAX_AGE = 2_592_000; // 30일
export const GROUP_MAX_AGE = 31_536_000; // 1년

/** 만료 세션 쿠키를 정리하는 route handler 경로 (app/auth/expired/route.ts, #37) */
export const EXPIRED_PATH = "/auth/expired";
/** /login 에 붙는 만료 표시. 이 값이 있으면 /login 은 쿠키와 무관하게 항상 화면을 그린다 (루프 차단, #37) */
export const EXPIRED_REASON = "expired";

/** next 최대 길이 (API next-path.ts 와 같은 값) */
export const NEXT_MAX_LENGTH = 512;
/** 경로와 쿼리에 허용하는 글자. API(`apps/api/src/auth/next-path.ts`)와 같은 규칙 (D-41, #71) */
const NEXT_PATH = /^\/[A-Za-z0-9/_-]*$/;
const NEXT_QUERY = /^[A-Za-z0-9\-._~%&=+,:;@/]*$/;
const BROKEN_PERCENT = /%(?![0-9A-Fa-f]{2})/;
const FORBIDDEN_PERCENT = /%(?:[01][0-9A-Fa-f]|7[Ff]|5[Cc])/;
const CONTROL = /[\u0000-\u001f\u007f]/;

/**
 * next 는 같은 사이트의 웹 경로(+쿼리)만 허용, 아니면 `/`. 해시는 버린다.
 * URL 로 한 번 정규화(비ASCII 쿼리는 퍼센트 인코딩)한 뒤 API 와 같은 글자 규칙으로 검사한다.
 * 그래서 여기를 통과한 값은 API `/v1/auth/kakao` 도 그대로 받는다 (#65, #71)
 */
export function safeNext(raw: string | null | undefined): string {
  if (!raw || raw.length > NEXT_MAX_LENGTH || CONTROL.test(raw)) return "/";
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) return "/";
  try {
    const base = "http://wwm.invalid";
    const u = new URL(raw, base);
    if (u.origin !== base || !NEXT_PATH.test(u.pathname) || u.pathname.startsWith("//")) return "/";
    const query = u.search.slice(1);
    if (!query) return u.pathname;
    if (!NEXT_QUERY.test(query) || BROKEN_PERCENT.test(query) || FORBIDDEN_PERCENT.test(query)) return "/";
    const next = `${u.pathname}?${query}`;
    return next.length > NEXT_MAX_LENGTH ? "/" : next;
  } catch {
    return "/";
  }
}

/**
 * PR #69 시절 API 가 쿼리를 받지 않아 `<경로>/_q_/<base64url>` 로 싸서 보내던 next (#65).
 * 배포 직전에 로그인을 시작한 사람의 state 에 남아 있을 수 있어, 꼬리를 떼고 경로만 살린다 (쿼리는 버림, D-41)
 */
export function dropLegacyQueryMark(raw: string | null | undefined): string | null | undefined {
  if (!raw) return raw;
  const m = /^(.*?)\/_q_\/[A-Za-z0-9_-]*$/.exec(raw);
  return m ? m[1] || "/" : raw;
}

/** 초대 화면 자동 합류 표시. 로그인 next 에 실어 보낸다 (`/join/<code>?auto=1`, D-41) */
export const JOIN_AUTO_PARAM = "auto";
/** 이 초 안에 발급된 세션일 때만 auto 를 따른다 = 방금 로그인하고 돌아온 경우 */
export const JOIN_AUTO_FRESH_SEC = 300;

/** 초대 화면에서 카카오 로그인 후 돌아올 next */
export function joinAutoNext(code: string): string {
  return `/join/${encodeURIComponent(code)}?${JOIN_AUTO_PARAM}=1`;
}

/** 로그인 버튼 구성. 앱 셸 안이면 네이티브 로그인(카카오, 애플 둘 다 네이티브가 고른다) 하나,
 *  웹이면 카카오 + (APPLE_LOGIN_ENABLED=1 일 때) 애플. /login 과 초대 화면(/join/<코드>, #129)이 같이 쓴다 */
export type LoginChoice = "native" | "kakao" | "apple";

/** 웹 애플 버튼을 보일지. APPLE_LOGIN_ENABLED=1 이어도 Android 앱 셸(UA `WhenwemeetApp/<버전> (android)`)
 *  안에서는 숨긴다 (#145, Android 앱은 애플 로그인을 쓰지 않는다). iOS 앱과 일반 웹은 그대로 */
export function webAppleEnabled(flag: string | undefined, appOs: "ios" | "android" | null | undefined): boolean {
  return flag === "1" && appOs !== "android";
}
export function loginChoices(inApp: boolean, appleEnabled: boolean): LoginChoice[] {
  if (inApp) return ["native"];
  return appleEnabled ? ["kakao", "apple"] : ["kakao"];
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

/** 앱 handoff: 32바이트 base64url 43자 (앱.md 2.1, API HandoffExchangeDto 와 같은 규칙) */
const HANDOFF = /^[A-Za-z0-9_-]{43}$/;
/** PKCE verifier: unreserved 43 ~ 128자 */
const VERIFIER = /^[A-Za-z0-9._~-]{43,128}$/;

/** /auth/app 쿼리 h, v 형식 확인. API 를 부르기 전에 모양이 틀린 요청을 거른다 */
export function isHandoffPair(h: string | null | undefined, v: string | null | undefined): boolean {
  return !!h && !!v && HANDOFF.test(h) && VERIFIER.test(v);
}
