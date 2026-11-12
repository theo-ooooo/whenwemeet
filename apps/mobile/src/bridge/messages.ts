// 웹 → 셸 브리지 메시지 (docs/설계/앱.md 4.2, D-53, 푸시-알림.md 2-2, 위젯 4.7). 웹 apps/web/src/lib/app-bridge.ts 와 같은 계약.
// 목록에 없는 type, v 불일치, 출처가 웹 오리진이 아닌 메시지는 버린다. RN 을 import 하지 않는다.
import { isWebOrigin, safeNext } from "../links/urls";
import { parseWidgetSnapshot, WIDGET_MESSAGE_MAX, type WidgetSnapshot } from "../widget/snapshot";

export const BRIDGE_VERSION = 1;

export type HapticKind = "success" | "light" | "error";

/** (#195) 카카오 링크. 웹 오리진 주소만 (실행 파라미터는 받지 않는다, D-168) */
export type KakaoLink = { webUrl: string; mobileWebUrl: string };

/** (#195) 카카오 피드 기본 템플릿. 웹 lib/kakao-share.ts kakaoFeedTemplate 이 만든 모양에서 셸이 쓰는 칸만 다시 만든다 */
export type KakaoFeed = {
  content: { title: string; description?: string; imageUrl: string; imageWidth?: number; imageHeight?: number; link: KakaoLink };
  buttons: { title: string; link: KakaoLink }[];
};

export type BridgeMessage =
  | { v: 1; type: "login"; next: string; reason?: "expired" }
  | { v: 1; type: "logout" }
  | { v: 1; type: "accountDeleted" }
  | { v: 1; type: "share"; url: string; text?: string; title?: string }
  // (#195) 카카오톡 공유 (앱.md 4.6, D-169). text 는 카카오톡 공유가 안 될 때 OS 공유 시트 본문
  | { v: 1; type: "kakaoShare"; template: KakaoFeed; text?: string }
  | { v: 1; type: "haptic"; kind: HapticKind }
  // (#188) 푸시. 응답은 셸 → 웹 wwm:app 이벤트 (reply.ts)
  | { v: 1; type: "pushStatus"; id: string }
  | { v: 1; type: "pushRequest"; id: string }
  | { v: 1; type: "openSettings" }
  // (#197) 홈 화면 위젯 스냅샷과 비우기 (앱.md 4.7). 셸은 기기 안(App Group / 앱 파일)에만 둔다
  | { v: 1; type: "widgetSnapshot"; snapshot: WidgetSnapshot }
  | { v: 1; type: "widgetClear" };

/** 위젯 스냅샷 밖 메시지의 최대 길이 */
const MESSAGE_MAX = 4096;

/** 응답 짝짓기용 id (1~40자, 제어문자 없음). 아니면 null */
function requestId(v: unknown): string | null {
  if (typeof v !== "string" || v.length < 1 || v.length > 40) return null;
  if (/[\u0000-\u001f\u007f\u2028\u2029]/.test(v)) return null;
  return v;
}

const HAPTIC_KINDS: readonly HapticKind[] = ["success", "light", "error"];

function optString(v: unknown, max: number): string | undefined | false {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "string" || v.length > max) return false;
  return v;
}

function record(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/** 1~max 자 문자열 (제어문자 없음). 아니면 null */
function text(v: unknown, max: number): string | null {
  if (typeof v !== "string" || v.length < 1 || v.length > max) return null;
  return /[\u0000-\u001f\u007f]/.test(v) ? null : v;
}

/** 카카오 링크: webUrl, mobileWebUrl 둘 다 웹 오리진 (모자란 쪽은 다른 쪽으로 채운다). 실행 파라미터 등 다른 칸은 버린다 */
function kakaoLink(v: unknown, webOrigin: string): KakaoLink | null {
  const o = record(v);
  if (!o) return null;
  const web = typeof o.webUrl === "string" ? o.webUrl : undefined;
  const mobile = typeof o.mobileWebUrl === "string" ? o.mobileWebUrl : undefined;
  const webUrl = web ?? mobile;
  const mobileWebUrl = mobile ?? web;
  if (!webUrl || !mobileWebUrl) return null;
  if (webUrl.length > 512 || mobileWebUrl.length > 512) return null;
  if (!isWebOrigin(webUrl, webOrigin) || !isWebOrigin(mobileWebUrl, webOrigin)) return null;
  return { webUrl, mobileWebUrl };
}

function imageSize(v: unknown): number | undefined | false {
  if (v === undefined || v === null) return undefined;
  return typeof v === "number" && Number.isInteger(v) && v > 0 && v <= 4000 ? v : false;
}

/**
 * (#195) 피드 템플릿 검사. 출처 밖 주소(카드, 버튼, 이미지)가 하나라도 있으면 통째로 버린다 (share 와 같은 규칙).
 * objectType 은 feed 만, 버튼 1~2개. 쓰는 칸만 새 객체로 옮긴다
 */
export function parseKakaoFeed(v: unknown, webOrigin: string): KakaoFeed | null {
  const o = record(v);
  if (!o || o.objectType !== "feed") return null;
  const c = record(o.content);
  if (!c) return null;
  const title = text(c.title, 200);
  const imageUrl = typeof c.imageUrl === "string" && c.imageUrl.length <= 512 && isWebOrigin(c.imageUrl, webOrigin) ? c.imageUrl : null;
  const link = kakaoLink(c.link, webOrigin);
  const description = c.description === undefined ? undefined : text(c.description, 300);
  const imageWidth = imageSize(c.imageWidth);
  const imageHeight = imageSize(c.imageHeight);
  if (!title || !imageUrl || !link || description === null || imageWidth === false || imageHeight === false) return null;
  if (!Array.isArray(o.buttons) || o.buttons.length < 1 || o.buttons.length > 2) return null;
  const buttons: KakaoFeed["buttons"] = [];
  for (const b of o.buttons) {
    const r = record(b);
    const bt = r && text(r.title, 20);
    const bl = r && kakaoLink(r.link, webOrigin);
    if (!bt || !bl) return null;
    buttons.push({ title: bt, link: bl });
  }
  return {
    content: {
      title,
      ...(description ? { description } : {}),
      imageUrl,
      ...(imageWidth ? { imageWidth } : {}),
      ...(imageHeight ? { imageHeight } : {}),
      link,
    },
    buttons,
  };
}

/**
 * postMessage 본문과 보낸 페이지 주소로 메시지를 검증한다. 버릴 메시지면 null
 * @param data      event.nativeEvent.data (JSON 문자열)
 * @param sourceUrl event.nativeEvent.url (메시지를 보낸 페이지)
 */
export function parseBridgeMessage(data: unknown, sourceUrl: string, webOrigin: string): BridgeMessage | null {
  if (!isWebOrigin(sourceUrl, webOrigin)) return null;
  // 위젯 스냅샷만 16KB 까지 받는다. 그 밖은 type 을 읽은 뒤 4KB 로 다시 자른다
  if (typeof data !== "string" || data.length > WIDGET_MESSAGE_MAX) return null;
  let m: unknown;
  try {
    m = JSON.parse(data);
  } catch {
    return null;
  }
  if (!m || typeof m !== "object" || Array.isArray(m)) return null;
  const o = m as Record<string, unknown>;
  if (o.v !== BRIDGE_VERSION) return null;
  if (o.type !== "widgetSnapshot" && data.length > MESSAGE_MAX) return null;

  switch (o.type) {
    case "login": {
      const next = optString(o.next, 512);
      if (next === false) return null;
      const msg: BridgeMessage = { v: 1, type: "login", next: safeNext(next) };
      if (o.reason === "expired") msg.reason = "expired";
      return msg;
    }
    case "logout":
      return { v: 1, type: "logout" };
    case "accountDeleted":
      return { v: 1, type: "accountDeleted" };
    case "share": {
      if (typeof o.url !== "string" || !isWebOrigin(o.url, webOrigin)) return null;
      const text = optString(o.text, 500);
      const title = optString(o.title, 100);
      if (text === false || title === false) return null;
      const msg: BridgeMessage = { v: 1, type: "share", url: o.url };
      if (text) msg.text = text;
      if (title) msg.title = title;
      return msg;
    }
    case "kakaoShare": {
      const template = parseKakaoFeed(o.template, webOrigin);
      const t = optString(o.text, 500);
      if (!template || t === false) return null;
      const msg: BridgeMessage = { v: 1, type: "kakaoShare", template };
      if (t) msg.text = t;
      return msg;
    }
    case "haptic":
      if (typeof o.kind !== "string" || !HAPTIC_KINDS.includes(o.kind as HapticKind)) return null;
      return { v: 1, type: "haptic", kind: o.kind as HapticKind };
    case "pushStatus":
    case "pushRequest": {
      const id = requestId(o.id);
      if (id === null) return null;
      return { v: 1, type: o.type, id };
    }
    case "openSettings":
      return { v: 1, type: "openSettings" };
    case "widgetSnapshot": {
      const snapshot = parseWidgetSnapshot(o.snapshot);
      return snapshot ? { v: 1, type: "widgetSnapshot", snapshot } : null;
    }
    case "widgetClear":
      return { v: 1, type: "widgetClear" };
    default:
      return null;
  }
}

/** 공유 시트 인자. Android 는 url 필드를 무시하므로 본문에 붙인다 */
export function shareContent(
  msg: { url: string; text?: string; title?: string },
  os: "ios" | "android",
): { message: string; url?: string; title?: string } {
  if (os === "ios") {
    return { message: msg.text ?? "", url: msg.url, ...(msg.title ? { title: msg.title } : {}) };
  }
  return { message: msg.text ? `${msg.text}\n${msg.url}` : msg.url, ...(msg.title ? { title: msg.title } : {}) };
}
