import { describe, expect, it } from "vitest";
import {
  androidIntentUrl,
  APP_STORE_URL,
  appOpenUrl,
  appPathOf,
  appSchemeUrl,
  autoAttemptKey,
  detectBrowser,
  planAppOpen,
  PLAY_STORE_URL,
  shouldAutoAttempt,
  storeLiveFromEnv,
  webFallbackUrl,
} from "../app-open";

const ORIGIN = "https://whenwemeet.day";
const ON = { ios: true, android: true };
const OFF = { ios: false, android: false };
const KAKAO_IOS = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 KAKAOTALK 25.9.0";
const KAKAO_ANDROID =
  "Mozilla/5.0 (Linux; Android 15; SM-S928N Build/AP3A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/131.0 Mobile Safari/537.36;KAKAOTALK 2610910";
const SAFARI_IOS = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1";
const CHROME_ANDROID = "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36";
const DESKTOP = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15";
const APP_IOS = `${SAFARI_IOS} WhenwemeetApp/1.0.0 (ios)`;
const APP_ANDROID = `${CHROME_ANDROID} WhenwemeetApp/1.0.0 (android)`;

describe("detectBrowser", () => {
  it.each([
    [KAKAO_IOS, { os: "ios", kakao: true, inApp: false }],
    [KAKAO_ANDROID, { os: "android", kakao: true, inApp: false }],
    [SAFARI_IOS, { os: "ios", kakao: false, inApp: false }],
    [CHROME_ANDROID, { os: "android", kakao: false, inApp: false }],
    [DESKTOP, { os: null, kakao: false, inApp: false }],
    [APP_IOS, { os: "ios", kakao: false, inApp: true }],
    [APP_ANDROID, { os: "android", kakao: false, inApp: true }],
    [null, { os: null, kakao: false, inApp: false }],
  ])("%#", (ua, out) => expect(detectBrowser(ua)).toEqual(out));
});

describe("planAppOpen", () => {
  it("앱 셸 안과 데스크톱은 보이지 않는다 (스토어 공개여도)", () => {
    for (const ua of [APP_IOS, APP_ANDROID, DESKTOP, null]) {
      expect(planAppOpen(ua, ON)).toEqual({ show: false });
      expect(planAppOpen(ua, OFF)).toEqual({ show: false });
    }
  });
  it("모바일 브라우저(카카오톡 포함)에서 그 OS 앱이 스토어에 공개됐을 때만 묻는다", () => {
    expect(planAppOpen(KAKAO_IOS, ON)).toEqual({ show: true, os: "ios", kakao: true, auto: true, storeUrl: APP_STORE_URL });
    expect(planAppOpen(CHROME_ANDROID, ON)).toEqual({ show: true, os: "android", kakao: false, auto: true, storeUrl: PLAY_STORE_URL });
    expect(planAppOpen(SAFARI_IOS, ON)).toMatchObject({ show: true, os: "ios" });
    for (const ua of [KAKAO_IOS, SAFARI_IOS, CHROME_ANDROID]) expect(planAppOpen(ua, OFF)).toEqual({ show: false });
  });
  it("Android 카카오톡은 Play 공개 전에도 묻는다 (앱이 없으면 웹으로 돌아오므로 스토어 주소 없음)", () => {
    expect(planAppOpen(KAKAO_ANDROID, OFF)).toEqual({ show: true, os: "android", kakao: true, auto: true, storeUrl: null });
    expect(planAppOpen(KAKAO_ANDROID, { ios: true, android: false })).toMatchObject({ show: true, storeUrl: null });
    // 수동으로 눌러도 폴백은 웹(app=0)
    expect(appOpenUrl("android", ORIGIN, "/join/e/T", { manual: true, storeUrl: null })).toBe(
      androidIntentUrl("/join/e/T", webFallbackUrl(ORIGIN, "/join/e/T")),
    );
  });
});

describe("storeLiveFromEnv", () => {
  it.each([
    ["1", ON],
    [" 1 ", ON],
    ["ios,android", ON],
    ["android", { ios: false, android: true }],
    ["IOS", { ios: true, android: false }],
    ["0", OFF],
    ["true", OFF],
    ["", OFF],
    [undefined, OFF],
  ])("%p", (v, out) => expect(storeLiveFromEnv(v)).toEqual(out));
});

describe("OS 별 스토어 공개", () => {
  it("Play 만 열려 있으면 iOS 는 웹에 남는다", () => {
    const androidOnly = { ios: false, android: true };
    expect(planAppOpen(KAKAO_IOS, androidOnly)).toEqual({ show: false });
    expect(planAppOpen(KAKAO_ANDROID, androidOnly)).toMatchObject({ storeUrl: PLAY_STORE_URL });
  });
});

describe("appPathOf", () => {
  it("경로와 쿼리를 두고 app=0 만 뗀다", () => {
    expect(appPathOf("/join/ABC123", "")).toBe("/join/ABC123");
    expect(appPathOf("/join/ABC123", "?auto=1")).toBe("/join/ABC123?auto=1");
    // (#274) 일정 공유 링크도 경로 그대로 (대소문자, _ - 유지)
    expect(appPathOf("/join/e/Ab3_-Ab3_-Ab3_-Ab3_-AB", "")).toBe("/join/e/Ab3_-Ab3_-Ab3_-Ab3_-AB");
    expect(appSchemeUrl("/join/e/Ab3_-Ab3_-Ab3_-Ab3_-AB")).toBe("whenwemeet://join/e/Ab3_-Ab3_-Ab3_-Ab3_-AB");
    expect(appPathOf("/join/ABC123", "?app=0")).toBe("/join/ABC123");
    expect(appPathOf("/join/ABC123", "?auto=1&app=0")).toBe("/join/ABC123?auto=1");
    expect(appPathOf("/g/12/events", "?date=2026-11-10")).toBe("/g/12/events?date=2026-11-10");
  });
  it("상대 경로가 아니면 null", () => {
    expect(appPathOf("//evil.com/x", "")).toBeNull();
    expect(appPathOf("join/AB", "")).toBeNull();
  });
});

describe("앱 열기 주소", () => {
  it("커스텀 스킴은 whenwemeet://<경로>", () => {
    expect(appSchemeUrl("/join/ABC123")).toBe("whenwemeet://join/ABC123");
    expect(appSchemeUrl("/join/ABC123?auto=1")).toBe("whenwemeet://join/ABC123?auto=1");
  });
  it("intent 는 scheme, package, 인코딩된 폴백", () => {
    expect(androidIntentUrl("/join/ABC123", "https://whenwemeet.day/join/ABC123?app=0")).toBe(
      "intent://join/ABC123#Intent;scheme=whenwemeet;package=day.whenwemeet.app;" +
        "S.browser_fallback_url=https%3A%2F%2Fwhenwemeet.day%2Fjoin%2FABC123%3Fapp%3D0;end",
    );
    expect(androidIntentUrl("/join/ABC123?auto=1", null)).toBe("intent://join/ABC123?auto=1#Intent;scheme=whenwemeet;package=day.whenwemeet.app;end");
  });
  it("웹 폴백은 같은 주소 + app=0", () => {
    expect(webFallbackUrl(ORIGIN, "/join/ABC123?auto=1")).toBe("https://whenwemeet.day/join/ABC123?auto=1&app=0");
  });
  it("iOS 는 늘 커스텀 스킴", () => {
    for (const manual of [true, false]) {
      expect(appOpenUrl("ios", ORIGIN, "/join/AB", { manual, storeUrl: APP_STORE_URL })).toBe("whenwemeet://join/AB");
    }
  });
  it("Android 폴백: 직접 누름 + 스토어 공개면 Play 스토어, 아니면 웹(app=0)", () => {
    const fb = (u: string) => decodeURIComponent(/S\.browser_fallback_url=([^;]+)/.exec(u)![1]);
    expect(fb(appOpenUrl("android", ORIGIN, "/join/AB", { manual: true, storeUrl: PLAY_STORE_URL }))).toBe(PLAY_STORE_URL);
    expect(fb(appOpenUrl("android", ORIGIN, "/join/AB", { manual: false, storeUrl: PLAY_STORE_URL }))).toBe("https://whenwemeet.day/join/AB?app=0");
    expect(fb(appOpenUrl("android", ORIGIN, "/join/AB", { manual: true, storeUrl: null }))).toBe("https://whenwemeet.day/join/AB?app=0");
  });
});

describe("shouldAutoAttempt", () => {
  const kakao = planAppOpen(KAKAO_ANDROID, ON);
  it("카카오톡에서 처음 열 때만", () => {
    expect(shouldAutoAttempt(kakao, "", false)).toBe(true);
    expect(shouldAutoAttempt(kakao, "?auto=1", false)).toBe(true);
  });
  it("이미 시도했거나 폴백으로 돌아왔으면 다시 하지 않는다", () => {
    expect(shouldAutoAttempt(kakao, "", true)).toBe(false);
    expect(shouldAutoAttempt(kakao, "?app=0", false)).toBe(false);
  });
  it("표시 안 함(데스크톱, 스토어 미공개)은 묻지 않는다", () => {
    expect(shouldAutoAttempt(planAppOpen(DESKTOP, ON), "", false)).toBe(false);
    expect(shouldAutoAttempt(planAppOpen(SAFARI_IOS, OFF), "", false)).toBe(false);
  });
  it("키는 쿼리를 뺀 경로 기준", () => {
    expect(autoAttemptKey("/join/AB?auto=1")).toBe(autoAttemptKey("/join/AB"));
  });
});
