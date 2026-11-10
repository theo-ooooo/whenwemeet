import { afterEach, describe, expect, it, vi } from "vitest";
import { encodeBridgeMessage, isInApp, parseAppUserAgent, postToApp } from "../app-bridge";

const IOS_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 WhenwemeetApp/1.0.0 (ios)";
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
