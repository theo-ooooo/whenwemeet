import { afterEach, describe, expect, it, vi } from "vitest";
import {
  appSupportsPush,
  compareAppVersion,
  decodePushStatus,
  encodeBridgeMessage,
  isInApp,
  openAppSettings,
  parseAppUserAgent,
  postToApp,
  pushSupport,
  requestPushStatus,
  uaSupportsPush,
} from "../app-bridge";

const IOS_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 WhenwemeetApp/1.0.0 (ios)";
const ANDROID_UA =
  "Mozilla/5.0 (Linux; Android 15; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0 Mobile Safari/537.36 WhenwemeetApp/1.2.3 (android)";

describe("parseAppUserAgent", () => {
  it("셸 접미사에서 버전과 OS 를 읽는다", () => {
    expect(parseAppUserAgent(IOS_UA)).toEqual({ version: "1.0.0", os: "ios" });
    expect(parseAppUserAgent(ANDROID_UA)).toEqual({ version: "1.2.3", os: "android" });
  });

  it("일반 브라우저, 빈 값, 모르는 OS 는 앱이 아니다", () => {
    expect(parseAppUserAgent("Mozilla/5.0 (Macintosh) Safari/605.1.15")).toBeNull();
    expect(parseAppUserAgent(null)).toBeNull();
    expect(parseAppUserAgent("")).toBeNull();
    expect(parseAppUserAgent("WhenwemeetApp/1.0.0 (windows)")).toBeNull();
    expect(parseAppUserAgent("NotWhenwemeetApp/1.0.0 (ios)")).toBeNull();
  });
});

describe("encodeBridgeMessage", () => {
  it("v: 1 을 붙인 JSON (셸 parseBridgeMessage 계약)", () => {
    expect(JSON.parse(encodeBridgeMessage({ type: "login", next: "/join/ABC123?auto=1" }))).toEqual({
      v: 1,
      type: "login",
      next: "/join/ABC123?auto=1",
    });
    expect(JSON.parse(encodeBridgeMessage({ type: "haptic", kind: "success" }))).toEqual({ v: 1, type: "haptic", kind: "success" });
  });
});

describe("postToApp", () => {
  afterEach(() => vi.unstubAllGlobals());

  function stub(ua: string, withBridge: boolean) {
    const postMessage = vi.fn();
    vi.stubGlobal("navigator", { userAgent: ua });
    vi.stubGlobal("window", withBridge ? { ReactNativeWebView: { postMessage } } : {});
    return postMessage;
  }

  it("서버(window 없음)에서는 보내지 않는다", () => {
    expect(isInApp()).toBe(false);
    expect(postToApp({ type: "logout" })).toBe(false);
  });

  it("UA 와 ReactNativeWebView 가 다 있을 때만 보낸다", () => {
    const post = stub(IOS_UA, true);
    expect(isInApp()).toBe(true);
    expect(postToApp({ type: "share", url: "https://whenwemeet.day/join/ABC123", title: "초대" })).toBe(true);
    expect(JSON.parse(post.mock.calls[0][0] as string)).toEqual({
      v: 1,
      type: "share",
      url: "https://whenwemeet.day/join/ABC123",
      title: "초대",
    });
  });

  it("UA 만 있고 브리지가 없으면 웹 동작으로 (false)", () => {
    stub(IOS_UA, false);
    expect(isInApp()).toBe(false);
    expect(postToApp({ type: "logout" })).toBe(false);
  });

  it("브리지가 있어도 UA 가 앱이 아니면 보내지 않는다", () => {
    const post = stub("Mozilla/5.0 Chrome/130.0", true);
    expect(postToApp({ type: "logout" })).toBe(false);
    expect(post).not.toHaveBeenCalled();
  });

  it("postMessage 가 던지면 false", () => {
    const post = stub(ANDROID_UA, true);
    post.mockImplementation(() => {
      throw new Error("x");
    });
    expect(postToApp({ type: "accountDeleted" })).toBe(false);
  });
});

/* ---------- (#188) 푸시 (푸시-알림.md 2-1, 2-2) ---------- */

const ua = (v: string, os = "ios") => `Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 Mobile/15E148 WhenwemeetApp/${v} (${os})`;

describe("compareAppVersion, uaSupportsPush (D-81)", () => {
  it("숫자 세 칸을 숫자로 비교한다 (1.10.0 > 1.9.9)", () => {
    expect(compareAppVersion("1.1.0", "1.1.0")).toBe(0);
    expect(compareAppVersion("1.10.0", "1.9.9")).toBe(1);
    expect(compareAppVersion("1.0.12", "1.1.0")).toBe(-1);
    expect(compareAppVersion("2.0.0", "1.1.0")).toBe(1);
  });

  it("형식이 틀리면 null", () => {
    expect(compareAppVersion("1.1", "1.1.0")).toBeNull();
    expect(compareAppVersion("1.1.0-beta", "1.1.0")).toBeNull();
    expect(compareAppVersion("a.b.c", "1.1.0")).toBeNull();
  });

  it("1.1.0 이상 앱만 푸시 지원. 1.0.x, 틀린 형식, 웹은 아니다", () => {
    expect(uaSupportsPush(ua("1.1.0"))).toBe(true);
    expect(uaSupportsPush(ua("1.2.3", "android"))).toBe(true);
    expect(uaSupportsPush(ua("1.0.0"))).toBe(false);
    expect(uaSupportsPush(ua("1.0.9"))).toBe(false);
    expect(uaSupportsPush(ua("1.1"))).toBe(false);
    expect(uaSupportsPush(ua("1.1.0-rc1"))).toBe(false);
    expect(uaSupportsPush("Mozilla/5.0 Chrome/130.0")).toBe(false);
    expect(uaSupportsPush(null)).toBe(false);
  });
});

describe("푸시 메시지 인코딩 (웹 → 셸)", () => {
  it("pushStatus, pushRequest 는 id, openSettings 는 필드 없이 v: 1", () => {
    expect(JSON.parse(encodeBridgeMessage({ type: "pushStatus", id: "p1" }))).toEqual({ v: 1, type: "pushStatus", id: "p1" });
    expect(JSON.parse(encodeBridgeMessage({ type: "pushRequest", id: "p2" }))).toEqual({ v: 1, type: "pushRequest", id: "p2" });
    expect(JSON.parse(encodeBridgeMessage({ type: "openSettings" }))).toEqual({ v: 1, type: "openSettings" });
  });
});

describe("decodePushStatus (셸 → 웹 wwm:app detail)", () => {
  const base = {
    v: 1,
    type: "pushStatus",
    id: "p1",
    permission: "granted",
    canAskAgain: true,
    token: "ExponentPushToken[xYz_-1]",
    platform: "IOS",
    appVersion: "1.1.0",
  };

  it("맞는 응답을 읽는다", () => {
    expect(decodePushStatus(base)).toEqual({
      id: "p1",
      permission: "granted",
      canAskAgain: true,
      token: "ExponentPushToken[xYz_-1]",
      platform: "IOS",
      appVersion: "1.1.0",
    });
    expect(decodePushStatus({ ...base, token: "ExpoPushToken[abc]" })?.token).toBe("ExpoPushToken[abc]");
  });

  it("허용이 아니면 토큰은 null, 틀린 형식 토큰도 null", () => {
    expect(decodePushStatus({ ...base, permission: "denied" })?.token).toBeNull();
    expect(decodePushStatus({ ...base, token: "fcm:abc" })?.token).toBeNull();
    expect(decodePushStatus({ ...base, token: null })?.token).toBeNull();
  });

  it("v, type, id, permission, platform, appVersion 이 틀리면 버린다", () => {
    expect(decodePushStatus({ ...base, v: 2 })).toBeNull();
    expect(decodePushStatus({ ...base, type: "login" })).toBeNull();
    expect(decodePushStatus({ ...base, id: "" })).toBeNull();
    expect(decodePushStatus({ ...base, id: "x".repeat(41) })).toBeNull();
    expect(decodePushStatus({ ...base, permission: "provisional" })).toBeNull();
    expect(decodePushStatus({ ...base, platform: "WEB" })).toBeNull();
    expect(decodePushStatus({ ...base, appVersion: "" })).toBeNull();
    expect(decodePushStatus(null)).toBeNull();
    expect(decodePushStatus("x")).toBeNull();
    expect(decodePushStatus([base])).toBeNull();
  });

  it("canAskAgain 은 true 일 때만 true", () => {
    expect(decodePushStatus({ ...base, canAskAgain: "yes" })?.canAskAgain).toBe(false);
  });
});

describe("requestPushStatus, appSupportsPush", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  function stubApp(version: string, reply: ((id: string) => Record<string, unknown> | null) | null) {
    const listeners = new Set<(e: Event) => void>();
    const postMessage = vi.fn((raw: string) => {
      const m = JSON.parse(raw) as { type: string; id?: string };
      if (!reply || !m.id) return;
      const detail = reply(m.id);
      if (detail) queueMicrotask(() => listeners.forEach((l) => l({ detail } as unknown as Event)));
    });
    vi.stubGlobal("navigator", { userAgent: ua(version) });
    vi.stubGlobal("window", {
      ReactNativeWebView: { postMessage },
      addEventListener: (_: string, f: (e: Event) => void) => listeners.add(f),
      removeEventListener: (_: string, f: (e: Event) => void) => listeners.delete(f),
    });
    return { postMessage, listeners };
  }
  const granted = (id: string) => ({
    v: 1,
    type: "pushStatus",
    id,
    permission: "granted",
    canAskAgain: false,
    token: "ExponentPushToken[t]",
    platform: "ANDROID",
    appVersion: "1.1.0",
  });

  it("웹, 1.0.x 앱은 보내지 않고 null", async () => {
    expect(appSupportsPush()).toBe(false);
    expect(pushSupport()).toBe("web");
    expect(await requestPushStatus("status")).toBeNull();
    const { postMessage } = stubApp("1.0.3", granted);
    expect(pushSupport()).toBe("updateApp");
    expect(await requestPushStatus("request")).toBeNull();
    expect(openAppSettings()).toBe(false);
    expect(postMessage).not.toHaveBeenCalled();
  });

  it("같은 id 의 응답과 짝짓고 리스너를 정리한다", async () => {
    const { postMessage, listeners } = stubApp("1.1.0", granted);
    expect(pushSupport()).toBe("supported");
    const s = await requestPushStatus("request");
    expect(JSON.parse(postMessage.mock.calls[0][0] as string)).toMatchObject({ v: 1, type: "pushRequest" });
    expect(s).toMatchObject({ permission: "granted", token: "ExponentPushToken[t]", platform: "ANDROID" });
    expect(listeners.size).toBe(0);
  });

  it("다른 id 응답은 무시하고 5초 뒤 null (권한 창은 60초)", async () => {
    vi.useFakeTimers();
    stubApp("1.1.0", () => granted("other"));
    const p = requestPushStatus("status");
    await vi.advanceTimersByTimeAsync(4_999);
    let settled = false;
    void p.then(() => (settled = true));
    await Promise.resolve();
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await p).toBeNull();

    const q = requestPushStatus("request");
    await vi.advanceTimersByTimeAsync(59_999);
    let qSettled = false;
    void q.then(() => (qSettled = true));
    await Promise.resolve();
    expect(qSettled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await q).toBeNull();
  });

  it("openSettings 는 지원 앱에서만 보낸다", () => {
    const { postMessage } = stubApp("1.1.0", null);
    expect(openAppSettings()).toBe(true);
    expect(JSON.parse(postMessage.mock.calls[0][0] as string)).toEqual({ v: 1, type: "openSettings" });
  });
});
