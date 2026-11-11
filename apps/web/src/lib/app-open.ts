// 웹 → 앱 열기 (#154). 카카오톡 인앱 브라우저는 유니버설 링크/앱 링크를 타지 않으므로
// 초대 화면(/join/<코드>)이 커스텀 스킴(iOS)이나 intent(Android)로 앱을 직접 부른다. 나중에 /g/* 도 같은 함수를 쓴다.
// 앱 셸 안(UA `WhenwemeetApp/`)이면 아무것도 하지 않는다 (판정은 app-bridge.ts parseAppUserAgent 그대로).
// 스토어 이동은 APP_STORE_LIVE (출시 후 Vercel 환경 변수, `1` 또는 `ios`/`android`) 가 켜진 OS 만. 꺼져 있으면 앱이 없을 때 웹 합류 화면에 그대로 남는다.
// 서버 컴포넌트에서도 import 하므로 React, next/* 를 import 하지 않는다.
import { parseAppUserAgent } from "./app-bridge";

export const APP_SCHEME = "whenwemeet";
export const APP_PACKAGE = "day.whenwemeet.app";
export const APP_STORE_URL = "https://apps.apple.com/kr/app/id6832865813";
export const PLAY_STORE_URL = `https://play.google.com/store/apps/details?id=${APP_PACKAGE}`;

/** intent 폴백으로 돌아온 웹 주소에 붙이는 표시. 이 값이 있으면 자동 시도를 다시 하지 않는다 */
export const NO_APP_PARAM = "app";
export const NO_APP_VALUE = "0";

export type MobileOs = "ios" | "android";

export type BrowserInfo = {
  /** 모바일 OS. 데스크톱이나 모르는 기기면 null */
  os: MobileOs | null;
  /** 카카오톡 인앱 브라우저 (UA 에 KAKAOTALK) */
  kakao: boolean;
  /** 우리 앱 셸 웹뷰 */
  inApp: boolean;
};

export function detectBrowser(ua: string | null | undefined): BrowserInfo {
  const s = ua ?? "";
  const inApp = parseAppUserAgent(s) !== null;
  const kakao = /KAKAOTALK/i.test(s);
  // iPadOS 데스크톱 모드(Macintosh UA)는 구분할 수 없어 데스크톱으로 둔다 (앱도 iPad 를 지원하지 않는다)
  const os: MobileOs | null = /\b(iPhone|iPod|iPad)\b/.test(s) ? "ios" : /\bAndroid\b/i.test(s) ? "android" : null;
  return { os, kakao, inApp };
}

/** 앱 열기 화면 판정. 서버 컴포넌트가 UA 와 환경 변수로 정해 클라이언트 컴포넌트에 넘긴다 */
export type AppOpenPlan =
  | { show: false }
  | {
      show: true;
      os: MobileOs;
      kakao: boolean;
      /** 화면을 열자마자 한 번 앱을 부른다 (카카오톡 인앱 브라우저만. 일반 브라우저는 유니버설 링크/앱 링크가 있고,
       *  iOS Safari 는 앱이 없을 때 "주소가 유효하지 않음" 경고를 띄우므로 버튼으로만) */
      auto: boolean;
      /** 앱이 없을 때 갈 스토어 주소. APP_STORE_LIVE 가 꺼져 있으면 null (웹에 남는다) */
      storeUrl: string | null;
    };

/** 스토어에 공개된 OS. iOS 와 Play 출시 시점이 달라 OS 별로 켤 수 있다 */
export type StoreLive = Record<MobileOs, boolean>;

/** APP_STORE_LIVE: `1` = 둘 다, `ios`, `android`, `ios,android`. 그 밖의 값이나 비어 있으면 둘 다 꺼짐 */
export function storeLiveFromEnv(v: string | undefined): StoreLive {
  const parts = (v ?? "").split(",").map((x) => x.trim().toLowerCase());
  if (parts.includes("1")) return { ios: true, android: true };
  return { ios: parts.includes("ios"), android: parts.includes("android") };
}

export function planAppOpen(ua: string | null | undefined, storeLive: StoreLive): AppOpenPlan {
  const b = detectBrowser(ua);
  // 데스크톱과 앱 셸 안은 늘 웹. 그 OS 앱이 스토어에 공개(APP_STORE_LIVE)되기 전에는 묻지 않는다(없는 앱을 권하지 않게).
  // 모바일 브라우저(카카오톡 인앱 포함)에서는 "앱으로 이용하기 / 웹으로 이용하기" 시트를 한 번 띄운다 (2026-11-11 사용자 결정, D-72)
  if (b.inApp || !b.os || !storeLive[b.os]) return { show: false };
  return {
    show: true,
    os: b.os,
    kakao: b.kakao,
    auto: true,
    storeUrl: b.os === "ios" ? APP_STORE_URL : PLAY_STORE_URL,
  };
}

/** `/join/AB?x=1` 에서 우리 표시(app=0)를 뗀 경로+쿼리. 경로가 / 로 시작하지 않거나 // 면 null */
export function appPathOf(pathname: string, search: string): string | null {
  if (!pathname.startsWith("/") || pathname.startsWith("//")) return null;
  const q = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  q.delete(NO_APP_PARAM);
  const qs = q.toString();
  return `${pathname}${qs ? `?${qs}` : ""}`;
}

/** whenwemeet://join/AB?x=1 (셸 links/urls.ts deepLinkToWebUrl 가 https://whenwemeet.day/join/AB?x=1 로 연다) */
export function appSchemeUrl(path: string): string {
  return `${APP_SCHEME}://${path.replace(/^\/+/, "")}`;
}

/**
 * Android intent 주소. 앱이 있으면 whenwemeet://<path> 로 앱이 열리고, 없으면 fallback 으로 간다.
 * fallback 이 null 이면 넣지 않는다 (Chrome 은 package= 를 보고 Play 스토어로 보낸다. 출시 전에는 쓰지 않는다)
 */
export function androidIntentUrl(path: string, fallback: string | null): string {
  const rest = path.replace(/^\/+/, "");
  const fb = fallback ? `S.browser_fallback_url=${encodeURIComponent(fallback)};` : "";
  return `intent://${rest}#Intent;scheme=${APP_SCHEME};package=${APP_PACKAGE};${fb}end`;
}

/** 앱이 없을 때 남을 웹 주소: 지금 주소에 app=0 을 붙여 같은 화면 (자동 시도 반복 방지) */
export function webFallbackUrl(origin: string, path: string): string {
  const u = new URL(path, origin);
  u.searchParams.set(NO_APP_PARAM, NO_APP_VALUE);
  return u.toString();
}

/**
 * 지금 눌러 이동할 앱 열기 주소.
 * - iOS: 커스텀 스킴. 앱이 없으면 아무 일도 없으므로(카카오톡) 호출부가 시간 초과 뒤 설치 버튼을 보여 준다
 * - Android: intent. 사용자가 직접 누른 경우(manual)이고 스토어가 열려 있으면 폴백을 스토어로, 아니면 웹(app=0)으로
 */
export function appOpenUrl(
  os: MobileOs,
  origin: string,
  path: string,
  opts: { manual: boolean; storeUrl: string | null },
): string {
  if (os === "ios") return appSchemeUrl(path);
  const fallback = opts.manual && opts.storeUrl ? opts.storeUrl : webFallbackUrl(origin, path);
  return androidIntentUrl(path, fallback);
}

/** 자동 시도를 이 화면에서 이미 했는지 기억하는 sessionStorage 키 */
export function autoAttemptKey(path: string): string {
  return `wwm_app_open:${path.split("?")[0]}`;
}

/** 자동 시도 여부: 계획이 auto 이고, 폴백으로 돌아온 주소(app=0)가 아니고, 이 탭에서 아직 안 했을 때 */
export function shouldAutoAttempt(plan: AppOpenPlan, search: string, alreadyTried: boolean): boolean {
  if (!plan.show || !plan.auto || alreadyTried) return false;
  return new URLSearchParams(search).get(NO_APP_PARAM) !== NO_APP_VALUE;
}
