// 앱(Expo 셸) 감지와 웹 → 셸 브리지 (docs/설계/앱.md 4장, D-53).
// 셸 apps/mobile/src/bridge/messages.ts 와 같은 계약. 앱 판정과 postMessage 는 이 파일 한 곳에서만 한다.
// 판정이 틀리거나 보낼 대상이 없으면 false 를 돌려 호출부가 기존 웹 동작으로 떨어지게 한다.
// 서버 컴포넌트와 route handler 에서도 import 하므로 React, next/* 를 import 하지 않는다.

export const BRIDGE_VERSION = 1;

export type HapticKind = "success" | "light" | "error";

export type BridgeMessage =
  | { type: "login"; next?: string; reason?: "expired" }
  | { type: "logout" }
  | { type: "accountDeleted" }
  | { type: "share"; url: string; text?: string; title?: string }
  | { type: "haptic"; kind: HapticKind };

/** 셸이 WebView applicationNameForUserAgent 로 붙이는 접미사: `WhenwemeetApp/<버전> (<ios|android>)` */
const APP_UA = /\bWhenwemeetApp\/([0-9A-Za-z.+-]+) \((ios|android)\)/;

export type AppUserAgent = { version: string; os: "ios" | "android" };

/** UA 에서 앱 표시를 읽는다. 없으면 null. 서버 컴포넌트는 이것만 본다 (로그인 화면 첫 렌더 분기용) */
export function parseAppUserAgent(ua: string | null | undefined): AppUserAgent | null {
  if (!ua) return null;
  const m = APP_UA.exec(ua);
  return m ? { version: m[1], os: m[2] as "ios" | "android" } : null;
}

export function isAppUserAgent(ua: string | null | undefined): boolean {
  return parseAppUserAgent(ua) !== null;
}

type RNWebView = { postMessage: (data: string) => void };

/** 브라우저 전역에서 셸 브리지를 꺼낸다. UA 와 window.ReactNativeWebView 둘 다 있을 때만 (4.1) */
function bridgeTarget(): RNWebView | null {
  if (typeof window === "undefined" || typeof navigator === "undefined") return null;
  if (!isAppUserAgent(navigator.userAgent)) return null;
  const rn = (window as unknown as { ReactNativeWebView?: RNWebView }).ReactNativeWebView;
  return rn && typeof rn.postMessage === "function" ? rn : null;
}

/** 지금 앱 셸 안에서 열린 웹인지 (브라우저 전용. 서버에서는 항상 false) */
export function isInApp(): boolean {
  return bridgeTarget() !== null;
}

/** 셸로 보낼 JSON 문자열 (`{ v: 1, type, ... }`) */
export function encodeBridgeMessage(msg: BridgeMessage): string {
  return JSON.stringify({ v: BRIDGE_VERSION, ...msg });
}

/**
 * 셸에 메시지를 보낸다. 보냈으면 true, 앱이 아니거나 실패하면 false (호출부는 웹 동작으로).
 * 셸이 버리는 메시지(다른 출처, 모르는 type)는 여기서 알 수 없으므로 true 여도 웹 쪽 후속 동작을 막지 않는 곳에만 쓴다
 */
export function postToApp(msg: BridgeMessage): boolean {
  const rn = bridgeTarget();
  if (!rn) return false;
  try {
    rn.postMessage(encodeBridgeMessage(msg));
    return true;
  } catch {
    return false;
  }
}

/** 햅틱. 앱 밖에서는 아무것도 하지 않는다 */
export function haptic(kind: HapticKind): void {
  postToApp({ type: "haptic", kind });
}
