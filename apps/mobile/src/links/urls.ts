// 웹뷰 이동 판정, 딥링크 → 웹뷰 주소 변환 (docs/설계/앱.md 4.4, 5장). RN 을 import 하지 않는 순수 함수만 둔다.

/** 문자열을 URL 로. 실패하면 null */
export function parseUrl(raw: string): URL | null {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

/** 웹 오리진과 같은 https 주소인가 (최상위 이동 허용 판정, 메시지 출처 판정 공통) */
export function isWebOrigin(raw: string, webOrigin: string): boolean {
  const u = parseUrl(raw);
  const w = parseUrl(webOrigin);
  if (!u || !w) return false;
  // 운영은 https 만. 로컬 개발(EXPO_PUBLIC_WEB_ORIGIN=http://...)은 그 오리진 그대로 허용
  return u.origin === w.origin && (u.protocol === "https:" || w.protocol === "http:");
}

/** 경로가 seg 이거나 seg/ 로 시작 (`/auth/app` 이 `/auth/apple` 에 걸리지 않게) */
function pathIs(pathname: string, seg: string): boolean {
  return pathname === seg || pathname.startsWith(`${seg}/`);
}

/** 웹 로그인 경로 — 웹뷰에서 열지 않고 네이티브 로그인 화면으로 */
const WEB_LOGIN_PATHS = ["/auth/kakao", "/auth/apple"];

/** (1.1.1) 웹 로그인 화면. 셸이 이 주소로 가는 문서 이동을 가로채 웹 화면을 그리지 않고 네이티브 로그인 화면을 바로 연다 (D-178).
 *  `/login/email`(이메일 로그인 웹 화면)은 그대로 웹뷰에서 연다 */
const WEB_LOGIN_PAGE = "/login";

export type NavigationDecision =
  | { kind: "allow" }
  | { kind: "nativeLogin"; next: string; reason?: "expired" }
  | { kind: "external"; url: string }
  | { kind: "block" };

/** 웹뷰 최상위 이동 판정 (onShouldStartLoadWithRequest) */
export function decideNavigation(raw: string, webOrigin: string): NavigationDecision {
  if (raw.startsWith("about:") || raw.startsWith("data:") || raw.startsWith("blob:")) return { kind: "allow" };
  const u = parseUrl(raw);
  if (!u) return { kind: "block" };
  if (isWebOrigin(raw, webOrigin)) {
    if (WEB_LOGIN_PATHS.some((p) => pathIs(u.pathname, p))) {
      return { kind: "nativeLogin", next: safeNext(u.searchParams.get("next")) };
    }
    // (D-178) /login 문서 이동(서버 리다이렉트 포함)은 웹 화면이 잠깐 보였다가 네이티브 화면이 덮는 깜빡임이 없게 바로 네이티브로.
    // error 가 붙은 경우(handoff 실패 등)는 웹이 문구를 그리게 둔다 (웹은 그 뒤 login 메시지로 네이티브 화면을 연다)
    if (
      (u.pathname === WEB_LOGIN_PAGE || u.pathname === `${WEB_LOGIN_PAGE}/`) &&
      !u.searchParams.has("error")
    ) {
      const next = safeNext(u.searchParams.get("next"));
      return u.searchParams.get("reason") === "expired"
        ? { kind: "nativeLogin", next, reason: "expired" }
        : { kind: "nativeLogin", next };
    }
    return { kind: "allow" };
  }
  // 그 밖의 http(s), tel:, mailto:, intent: 등은 시스템에 맡긴다
  if (u.protocol === "javascript:") return { kind: "block" };
  return { kind: "external", url: raw };
}

/**
 * 웹 safeNext(D-41)와 같은 규칙: 같은 사이트 상대 경로만. 아니면 "/"
 * `//evil.com`, `/\evil.com`, 제어문자, 절대 URL 은 버린다
 */
export function safeNext(next: string | null | undefined): string {
  if (!next || typeof next !== "string") return "/";
  if (!next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return "/";
  if (/[\u0000-\u001f\u007f]/.test(next)) return "/";
  if (next.length > 512) return "/";
  return next;
}

/**
 * 앱 링크/유니버설 링크(https)로 열 수 있는 경로 (5.1). 1.2.0 부터 AASA, intentFilters 는 `/join` 뿐이다 (#311, D-199).
 * 옛 `/g` 는 1.1.x 가 아직 가로채므로 받으면 그대로 연다 (웹이 308 로 새 주소에 맞춘다)
 */
const UNIVERSAL_LINK_PATHS = ["/join", "/g"];

/**
 * (#311) 커스텀 스킴 `whenwemeet://<경로>` 로 열 수 있는 웹 화면. 위젯 누름(`whenwemeet://calendar?date=&day=1&team=<팀 코드>`),
 * 웹 초대 화면의 앱 열기(`whenwemeet://join/<코드>`). 새 화면 주소는 팀을 `?team=` 으로 지정한다
 */
const SCHEME_LINK_PATHS = ["/join", "/g", "/calendar", "/upcoming", "/free", "/anniversaries", "/news", "/team", "/events"];

/** (#271, 1.1.1) 메일 로그인 링크 `/auth/email?token=` (D-113 확인 화면). 정확히 이 경로만 (intentFilters `path`, AASA 와 같은 값, D-177) */
export const EMAIL_LINK_PATH = "/auth/email";

/**
 * whenwemeet://join/AB?x=1 → { path: "/join/AB", search: "?x=1" }. 커스텀 스킴이 아니면 null.
 * RN 의 URL 은 http(s) 가 아니면 host, pathname 을 못 읽어서(react-native/Libraries/Blob/URL.js) 문자열로 자른다.
 * whenwemeet:///join/AB (슬래시 셋) 도 같은 경로로 본다
 */
export function parseSchemeLink(raw: string): { path: string; search: string } | null {
  const m = /^whenwemeet:\/\/([^?#]*)(\?[^#]*)?/i.exec(raw);
  if (!m) return null;
  return { path: `/${m[1].replace(/^\/+/, "")}`, search: m[2] ?? "" };
}

/**
 * 들어온 링크 → 웹뷰가 열 주소. 대상이 아니면 null
 * - https://whenwemeet.day/join/<code>?.. , 옛 /g/.. → 같은 경로를 webOrigin 에서 (스테이징 빌드면 스테이징 웹)
 * - whenwemeet://join/<code>?.. , whenwemeet://calendar?team=.. 등 화면 주소 → 같은 규칙 (#154. 카카오톡 인앱 브라우저가 유니버설 링크를 타지 않아
 *   웹 초대 화면이 커스텀 스킴/intent 로 앱을 연다. #311 위젯 누름도 이 모양)
 * - whenwemeet://auth?... 는 null (옛 Android 애플 웹 로그인 복귀 주소. #145 로 접고 #204 로 API 경로도 지웠다)
 * - (#271) https://whenwemeet.day/auth/email?token=.. → 같은 경로. 웹뷰가 확인 화면(D-113)을 그리고 [로그인 계속하기] 가
 *   웹뷰 쿠키로 세션을 만든다. 커스텀 스킴(whenwemeet://auth/email)은 받지 않는다 (메일 링크는 https 만)
 */
export function deepLinkToWebUrl(raw: string, webOrigin: string, linkHost = "whenwemeet.day"): string | null {
  let pathname: string;
  let search: string;
  let https = false;
  const scheme = parseSchemeLink(raw);
  if (scheme) {
    ({ path: pathname, search } = scheme);
  } else {
    const u = parseUrl(raw);
    if (!u || u.protocol !== "https:" || u.hostname !== linkHost) return null;
    pathname = u.pathname;
    search = u.search;
    https = true;
  }
  // 경로 조작(//evil, 백슬래시, 제어문자)은 버린다. safeNext 와 같은 규칙
  if (safeNext(pathname) !== pathname) return null;
  const emailLink = https && pathname === EMAIL_LINK_PATH;
  // https 는 앱 링크 목록(코드가 뒤따라야 한다), 커스텀 스킴은 화면 주소 자체(`/calendar`)도 받는다
  const allowed = https
    ? UNIVERSAL_LINK_PATHS.some((p) => pathIs(pathname, p) && pathname.length > p.length + 1)
    : SCHEME_LINK_PATHS.some((p) => pathIs(pathname, p) && (pathname.length > p.length + 1 || !(p === "/join" || p === "/g")));
  if (!emailLink && !allowed) return null;
  return `${webOrigin.replace(/\/+$/, "")}${pathname}${search}`;
}

/** (#245) 네이티브 로그인 화면의 [이메일로 계속하기] → 웹뷰가 여는 웹 이메일 로그인 화면 (이메일-로그인.md 7장, D-116).
 *  쿠키는 웹뷰가 직접 받으므로 handoff 가 필요 없다 */
export function buildEmailLoginUrl(webOrigin: string, next: string): string {
  const n = safeNext(next);
  const base = `${webOrigin.replace(/\/+$/, "")}/login/email`;
  return n === "/" ? base : `${base}?${new URLSearchParams({ next: n }).toString()}`;
}

/** (#245) 웹이 이메일 버튼 유무를 아는 UA 토큰. 버전 대신 능력 표시를 붙인다(OTA 는 네이티브 버전을 바꾸지 않음, D-116) */
export const EMAIL_LOGIN_UA_TOKEN = "EmailLogin/1";

/** (#195) 네이티브 카카오톡 공유(kakaoShare 브리지)를 처리한다는 표시 (D-169). 웹 lib/app-bridge.ts KAKAO_SHARE_UA_TOKEN 과 같은 값 */
export const KAKAO_SHARE_UA_TOKEN = "KakaoShare/1";

/** (#197) 홈 화면 위젯 브리지(widgetSnapshot, widgetClear)를 처리한다는 표시 (앱.md 4.7). 웹 lib/app-bridge.ts WIDGET_UA_TOKEN 과 같은 값.
 *  위젯은 네이티브 타깃이라 1.2.0 바이너리부터 늘 붙는다 (runtimeVersion=appVersion 이라 옛 바이너리에는 이 JS 가 가지 않는다) */
export const WIDGET_UA_TOKEN = "Widget/1";

/**
 * (#198) 로그인 방법 연결 브리지(linkAccount)를 처리한다는 표시 (앱.md 4.8, D-282). 웹 lib/account-link.ts ACCOUNT_LINK_UA_TOKEN 과 같은 값.
 * 토큰 하나가 카카오와 Apple 을 같이 뜻하므로 둘 중 늘 되는 쪽인 카카오(키 있는 빌드)를 조건으로 붙인다.
 * Apple 은 웹이 Android 앱에서 이미 숨기고(#145), iPhone 에서 Sign in with Apple 을 못 쓰는 드문 기기는 셸이 unavailable 로 답한다
 */
export const ACCOUNT_LINK_UA_TOKEN = "AccountLink/1";

/**
 * 웹뷰 UA 접미사 `WhenwemeetApp/<버전> (<os>) EmailLogin/1 KakaoShare/1 Widget/1 AccountLink/1` (앱.md 4.1). 웹 정규식 APP_UA 는 앞부분만 본다.
 * KakaoShare/1 은 카카오 네이티브 앱 키가 있는 빌드만 (키 없는 빌드는 SDK 를 못 써서 웹이 지금 share 브리지를 쓰게 둔다).
 * AccountLink/1 도 카카오 키가 있는 빌드만 (위 ACCOUNT_LINK_UA_TOKEN 설명)
 */
export function buildUserAgentSuffix(version: string, os: string, kakaoShare = false, accountLink = false): string {
  return `WhenwemeetApp/${version} (${os}) ${EMAIL_LOGIN_UA_TOKEN}${kakaoShare ? ` ${KAKAO_SHARE_UA_TOKEN}` : ""} ${WIDGET_UA_TOKEN}${
    accountLink ? ` ${ACCOUNT_LINK_UA_TOKEN}` : ""
  }`;
}

/** 로그인 성공 후 웹뷰에 여는 주소 (2.3) */
export function buildAuthAppUrl(webOrigin: string, handoff: string, verifier: string, next: string): string {
  const q = new URLSearchParams({ h: handoff, v: verifier, next: safeNext(next) });
  return `${webOrigin.replace(/\/+$/, "")}/auth/app?${q.toString()}`;
}

/**
 * (#188) 알림 data.url → 웹뷰가 열 주소 (푸시-알림.md 6장 경로, 9장 누름 처리, D-95).
 * API 는 웹 경로만 싣고 셸이 webOrigin 을 붙인다. safeNext 와 같은 규칙으로 상대 경로만 받고
 * 절대 주소, `//`, 백슬래시, 제어문자는 null (그때는 아무 데도 가지 않는다)
 */
export function notificationTarget(
  data: unknown,
  webOrigin: string,
): { path: string; url: string } | null {
  if (!data || typeof data !== "object") return null;
  const raw = (data as Record<string, unknown>).url;
  if (typeof raw !== "string" || raw.length === 0) return null;
  if (safeNext(raw) !== raw) return null;
  return { path: raw, url: `${webOrigin.replace(/\/+$/, "")}${raw}` };
}
