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
  | { type: "haptic"; kind: HapticKind }
  // (#188) 푸시 권한과 토큰. appSupportsPush() 일 때만 보낸다 (푸시-알림.md 2-2, D-80)
  | { type: "pushStatus"; id: string }
  | { type: "pushRequest"; id: string }
  | { type: "openSettings" };

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

/* ---------- (#245) 이메일 로그인 버튼을 아는 셸 (이메일-로그인.md 7장, D-116) ---------- */

/** 셸이 UA 끝에 붙이는 능력 표시. OTA(eas update)는 네이티브 버전을 바꾸지 않아 버전 대신 토큰으로 본다 */
export const EMAIL_LOGIN_UA_TOKEN = "EmailLogin/1";
const EMAIL_LOGIN_UA = /(?:^|\s)EmailLogin\/1(?:\s|$)/;

/** 앱 셸이고 네이티브 로그인 화면에 이메일 버튼이 있는지. 앱이 아니면 false */
export function appSupportsEmailLogin(ua: string | null | undefined): boolean {
  return isAppUserAgent(ua) && EMAIL_LOGIN_UA.test(ua ?? "");
}

/* ---------- (#188) 푸시 지원 판정 (푸시-알림.md 2-1, D-81) ---------- */

/** 푸시를 아는 첫 셸 버전 */
export const PUSH_MIN_APP_VERSION = "1.1.0";

/** 'a.b.c' 숫자 세 칸 비교. 형식이 틀리면 null (접미사 '-beta' 등도 틀린 형식으로 본다) */
export function compareAppVersion(a: string, b: string): number | null {
  const re = /^(\d{1,4})\.(\d{1,4})\.(\d{1,4})$/;
  const x = re.exec(a);
  const y = re.exec(b);
  if (!x || !y) return null;
  for (let i = 1; i <= 3; i += 1) {
    const d = Number(x[i]) - Number(y[i]);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

/** UA 의 앱 버전이 푸시를 아는 버전(1.1.0 이상)인지. 앱이 아니거나 형식이 틀리면 false */
export function uaSupportsPush(ua: string | null | undefined): boolean {
  const app = parseAppUserAgent(ua);
  if (!app) return false;
  const c = compareAppVersion(app.version, PUSH_MIN_APP_VERSION);
  return c !== null && c >= 0;
}

/** 푸시를 받을 수 있는 앱(1.1.0 이상) 안인지. 1.0.x 앱과 웹은 false 라 새 메시지를 보내지 않는다 */
export function appSupportsPush(): boolean {
  return isInApp() && uaSupportsPush(navigator.userAgent);
}

/** 이 화면의 알림 상황: 받을 수 있는 앱 / 업데이트가 필요한 옛 앱 / 웹. 안내 문구를 고른다 (8장) */
export type PushSupport = "supported" | "updateApp" | "web";

export function pushSupport(): PushSupport {
  if (appSupportsPush()) return "supported";
  return isInApp() ? "updateApp" : "web";
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

/* ---------- (#188) 셸 → 웹 응답 (푸시-알림.md 2-2) ---------- */

/** 셸이 injectJavaScript 로 쏘는 window 이벤트 이름 */
export const APP_EVENT = "wwm:app";

export type PushPermission = "granted" | "denied" | "undetermined";

export type PushStatus = {
  id: string;
  permission: PushPermission;
  canAskAgain: boolean;
  /** granted 이고 토큰을 얻었을 때만 'ExponentPushToken[...]' */
  token: string | null;
  platform: "IOS" | "ANDROID";
  appVersion: string;
};

const PERMISSIONS: readonly PushPermission[] = ["granted", "denied", "undetermined"];
/** API 와 같은 토큰 형식 (푸시-알림.md 7-1) */
export const PUSH_TOKEN_RE = /^Expo(nent)?PushToken\[[A-Za-z0-9_-]{1,180}\]$/;

/** wwm:app 이벤트 detail 을 검사해 pushStatus 응답으로 읽는다. 다른 type, 틀린 모양이면 null */
export function decodePushStatus(detail: unknown): PushStatus | null {
  if (!detail || typeof detail !== "object" || Array.isArray(detail)) return null;
  const o = detail as Record<string, unknown>;
  if (o.v !== BRIDGE_VERSION || o.type !== "pushStatus") return null;
  if (typeof o.id !== "string" || o.id.length < 1 || o.id.length > 40) return null;
  if (!PERMISSIONS.includes(o.permission as PushPermission)) return null;
  if (o.platform !== "IOS" && o.platform !== "ANDROID") return null;
  if (typeof o.appVersion !== "string" || o.appVersion.length < 1 || o.appVersion.length > 20) return null;
  // 형식이 틀린 토큰은 없는 것으로 (서버가 400 으로 거절할 값을 보내지 않는다)
  const token = typeof o.token === "string" && PUSH_TOKEN_RE.test(o.token) ? o.token : null;
  return {
    id: o.id,
    permission: o.permission as PushPermission,
    canAskAgain: o.canAskAgain === true,
    token: o.permission === "granted" ? token : null,
    platform: o.platform,
    appVersion: o.appVersion,
  };
}

/** 응답 기다리는 시간: 상태 5초, 권한 창 60초 (사람이 고르는 동안) */
export const PUSH_STATUS_TIMEOUT_MS = { status: 5_000, request: 60_000 } as const;

let pushSeq = 0;
function nextPushId(): string {
  pushSeq = (pushSeq + 1) % 1_000_000;
  return `p${Date.now().toString(36)}${pushSeq.toString(36)}`;
}

/**
 * 셸에 권한 상태(status) 또는 권한 요청(request) 을 보내고 같은 id 의 응답을 기다린다.
 * 푸시를 모르는 앱, 웹, 보내기 실패, 시간 초과면 null (호출부는 아무것도 하지 않는다)
 */
export function requestPushStatus(kind: "status" | "request"): Promise<PushStatus | null> {
  if (!appSupportsPush()) return Promise.resolve(null);
  const id = nextPushId();
  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const done = (v: PushStatus | null) => {
      if (timer !== null) clearTimeout(timer);
      window.removeEventListener(APP_EVENT, onEvent);
      resolve(v);
    };
    const onEvent = (e: Event) => {
      const s = decodePushStatus((e as CustomEvent).detail);
      if (s && s.id === id) done(s);
    };
    window.addEventListener(APP_EVENT, onEvent);
    timer = setTimeout(() => done(null), PUSH_STATUS_TIMEOUT_MS[kind]);
    if (!postToApp({ type: kind === "status" ? "pushStatus" : "pushRequest", id })) done(null);
  });
}

/** OS 앱 설정 열기 (알림을 거부한 기기). 푸시를 모르는 앱, 웹이면 false */
export function openAppSettings(): boolean {
  if (!appSupportsPush()) return false;
  return postToApp({ type: "openSettings" });
}

/** 햅틱. 앱 밖에서는 아무것도 하지 않는다 */
export function haptic(kind: HapticKind): void {
  postToApp({ type: "haptic", kind });
}
