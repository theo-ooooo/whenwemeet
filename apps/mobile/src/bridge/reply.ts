// 셸 → 웹 응답 (푸시-알림.md 2-2, D-80). RN 을 import 하지 않는다.
// webview.injectJavaScript 로 window.dispatchEvent(new CustomEvent('wwm:app', { detail })) 를 실행한다.
// 웹뷰 현재 주소가 웹 오리진일 때만 보낸다 (WebScreen 이 판정).

export type PushPermission = "granted" | "denied" | "undetermined";
export type PushPlatform = "IOS" | "ANDROID";

/** pushStatus 응답 detail. 웹 lib/app-bridge.ts 의 PushStatus 와 같은 모양 */
export type PushStatusReply = {
  v: 1;
  type: "pushStatus";
  /** 요청의 id 그대로 */
  id: string;
  permission: PushPermission;
  canAskAgain: boolean;
  /** granted 이고 토큰을 얻었을 때만 'ExponentPushToken[...]' */
  token: string | null;
  platform: PushPlatform;
  appVersion: string;
};

export type AppEventDetail = PushStatusReply;

/**
 * OS 권한 응답(expo-notifications)을 브리지 값으로. iOS 임시(provisional) 허용도 알림이 오므로 granted.
 * (#288) Android 13+ 는 한 번도 묻지 않은 상태를 denied + canAskAgain true 로 준다(한 번 거부한 것과 구분되지 않음).
 * OS 창을 다시 띄울 수 있으면 undetermined 로 보낸다. 웹 lib/push.ts canAskPermission 과 같은 규칙이라
 * 웹은 어느 셸 버전이든 같은 화면을 그린다. denied 는 다시 물을 수 없을 때만 (iOS 거부, Android 두 번 거부)
 */
export function toPushPermission(p: {
  status: string;
  granted?: boolean;
  canAskAgain?: boolean;
  ios?: { status?: number } | null;
}): PushPermission {
  // IosAuthorizationStatus: 2 AUTHORIZED, 3 PROVISIONAL, 4 EPHEMERAL
  if (p.granted || p.status === "granted") return "granted";
  if (p.ios?.status === 3 || p.ios?.status === 4) return "granted";
  if (p.status === "denied") return p.canAskAgain === true ? "undetermined" : "denied";
  return "undetermined";
}

/** Expo 푸시 토큰 모양만 통과 (API 검증과 같은 규칙, 푸시-알림.md 7-1) */
export function validExpoToken(token: unknown): string | null {
  if (typeof token !== "string") return null;
  return /^Expo(nent)?PushToken\[[A-Za-z0-9_-]{1,180}\]$/.test(token) ? token : null;
}

export function buildPushStatusReply(input: {
  id: string;
  permission: PushPermission;
  canAskAgain: boolean;
  token: string | null;
  os: "ios" | "android";
  appVersion: string;
}): PushStatusReply {
  return {
    v: 1,
    type: "pushStatus",
    id: input.id,
    permission: input.permission,
    canAskAgain: input.canAskAgain,
    token: input.permission === "granted" ? validExpoToken(input.token) : null,
    platform: input.os === "ios" ? "IOS" : "ANDROID",
    appVersion: input.appVersion,
  };
}

/**
 * injectJavaScript 에 넘길 스크립트. detail 은 JSON 으로만 싣고(문자열 이어 붙이기 없음)
 * U+2028/2029, `<` 는 이스케이프한다. 끝의 true 는 iOS 가 반환값 경고를 내지 않게
 */
export function buildAppEventScript(detail: AppEventDetail): string {
  const json = JSON.stringify(detail)
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029")
    .replace(/</g, "\\u003c");
  return `(function(){try{window.dispatchEvent(new CustomEvent('wwm:app',{detail:${json}}));}catch(e){}})();true;`;
}
