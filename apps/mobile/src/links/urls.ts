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

export type NavigationDecision =
  | { kind: "allow" }
  | { kind: "nativeLogin"; next: string }
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

/** 앱 링크/유니버설 링크로 열 수 있는 경로 (5.1). AASA, intentFilters 와 같은 목록 */
const DEEP_LINK_PATHS = ["/join", "/g"];

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
 * - https://whenwemeet.day/join/<code>?.. , /g/.. → 같은 경로를 webOrigin 에서 (스테이징 빌드면 스테이징 웹)
 * - whenwemeet://join/<code>?.. , whenwemeet://g/.. → 같은 규칙 (#154. 카카오톡 인앱 브라우저가 유니버설 링크를 타지 않아
 *   웹 초대 화면이 커스텀 스킴/intent 로 앱을 연다)
 * - whenwemeet://auth?... 는 openAuthSessionAsync 가 받으므로 null
 */
export function deepLinkToWebUrl(raw: string, webOrigin: string, linkHost = "whenwemeet.day"): string | null {
  let pathname: string;
  let search: string;
  const scheme = parseSchemeLink(raw);
  if (scheme) {
    ({ path: pathname, search } = scheme);
  } else {
    const u = parseUrl(raw);
    if (!u || u.protocol !== "https:" || u.hostname !== linkHost) return null;
    pathname = u.pathname;
    search = u.search;
  }
  // 경로 조작(//evil, 백슬래시, 제어문자)은 버린다. safeNext 와 같은 규칙
  if (safeNext(pathname) !== pathname) return null;
  if (!DEEP_LINK_PATHS.some((p) => pathIs(pathname, p) && pathname.length > p.length + 1)) return null;
  return `${webOrigin.replace(/\/+$/, "")}${pathname}${search}`;
}

/** 로그인 성공 후 웹뷰에 여는 주소 (2.3) */
export function buildAuthAppUrl(webOrigin: string, handoff: string, verifier: string, next: string): string {
  const q = new URLSearchParams({ h: handoff, v: verifier, next: safeNext(next) });
  return `${webOrigin.replace(/\/+$/, "")}/auth/app?${q.toString()}`;
}

/** 애플 웹 로그인 복귀 주소 whenwemeet://auth?h=..|error=.. 해석 (3.4).
 *  #145 로 Android 앱의 애플 로그인을 접어 지금은 셸에서 부르지 않는다 (API 의 client=app 경로는 남아 있음) */
export type AuthReturn = { ok: true; handoff: string } | { ok: false; error: string };
export function parseAuthReturn(raw: string): AuthReturn | null {
  const u = parseUrl(raw);
  if (!u || u.protocol !== "whenwemeet:") return null;
  // whenwemeet://auth 는 host=auth 로, whenwemeet:///auth 는 pathname 으로 들어온다
  if (u.hostname !== "auth" && u.pathname.replace(/^\/+/, "") !== "auth") return null;
  const error = u.searchParams.get("error");
  if (error) return { ok: false, error };
  const h = u.searchParams.get("h");
  if (h && /^[A-Za-z0-9_-]{43}$/.test(h)) return { ok: true, handoff: h };
  return { ok: false, error: "HANDOFF_INVALID" };
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
