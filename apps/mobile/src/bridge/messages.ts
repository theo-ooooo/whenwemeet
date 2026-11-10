// 웹 → 셸 브리지 메시지 (docs/설계/앱.md 4.2, D-53). 웹 apps/web/src/lib/app-bridge.ts 와 같은 계약.
// 목록에 없는 type, v 불일치, 출처가 웹 오리진이 아닌 메시지는 버린다. RN 을 import 하지 않는다.
import { isWebOrigin, safeNext } from "../links/urls";

export const BRIDGE_VERSION = 1;

export type HapticKind = "success" | "light" | "error";

export type BridgeMessage =
  | { v: 1; type: "login"; next: string; reason?: "expired" }
  | { v: 1; type: "logout" }
  | { v: 1; type: "accountDeleted" }
  | { v: 1; type: "share"; url: string; text?: string; title?: string }
  | { v: 1; type: "haptic"; kind: HapticKind };

const HAPTIC_KINDS: readonly HapticKind[] = ["success", "light", "error"];

function optString(v: unknown, max: number): string | undefined | false {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "string" || v.length > max) return false;
  return v;
}

/**
 * postMessage 본문과 보낸 페이지 주소로 메시지를 검증한다. 버릴 메시지면 null
 * @param data      event.nativeEvent.data (JSON 문자열)
 * @param sourceUrl event.nativeEvent.url (메시지를 보낸 페이지)
 */
export function parseBridgeMessage(data: unknown, sourceUrl: string, webOrigin: string): BridgeMessage | null {
  if (!isWebOrigin(sourceUrl, webOrigin)) return null;
  if (typeof data !== "string" || data.length > 4096) return null;
  let m: unknown;
  try {
    m = JSON.parse(data);
  } catch {
    return null;
  }
  if (!m || typeof m !== "object" || Array.isArray(m)) return null;
  const o = m as Record<string, unknown>;
  if (o.v !== BRIDGE_VERSION) return null;

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
    case "haptic":
      if (typeof o.kind !== "string" || !HAPTIC_KINDS.includes(o.kind as HapticKind)) return null;
      return { v: 1, type: "haptic", kind: o.kind as HapticKind };
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
