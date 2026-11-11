import { describe, expect, it } from "vitest";
import { isHandoffPair, joinAutoNext, loginChoices, safeNext, webAppleEnabled } from "../auth";

const H = "A".repeat(43);
const V = "b".repeat(43);

describe("isHandoffPair", () => {
  it("handoff 43자 base64url, verifier 43 ~ 128자만 통과", () => {
    expect(isHandoffPair(H, V)).toBe(true);
    expect(isHandoffPair("a_-".repeat(14) + "z", "x.~_-".repeat(25) + "abc")).toBe(true);
  });

  it("없음, 길이, 허용 밖 글자는 거른다", () => {
    expect(isHandoffPair(null, V)).toBe(false);
    expect(isHandoffPair(H, null)).toBe(false);
    expect(isHandoffPair(H.slice(1), V)).toBe(false);
    expect(isHandoffPair(H, V.slice(1))).toBe(false);
    expect(isHandoffPair(H, "b".repeat(129))).toBe(false);
    expect(isHandoffPair(`${H.slice(1)}=`, V)).toBe(false);
    expect(isHandoffPair(H, `${V.slice(1)}/`)).toBe(false);
  });
});

describe("loginChoices (/login 과 초대 화면 공통, #129)", () => {
  it("웹: 카카오, 애플 켜져 있으면 애플도", () => {
    expect(loginChoices(false, false)).toEqual(["kakao"]);
    expect(loginChoices(false, true)).toEqual(["kakao", "apple"]);
  });
  it("앱 셸 안: 애플 설정과 관계없이 네이티브 하나", () => {
    expect(loginChoices(true, false)).toEqual(["native"]);
    expect(loginChoices(true, true)).toEqual(["native"]);
  });
});

describe("joinAutoNext", () => {
  it("초대 코드 + ?auto=1, safeNext 를 그대로 통과한다 (카카오, 애플 둘 다 같은 next)", () => {
    expect(joinAutoNext("ABC123")).toBe("/join/ABC123?auto=1");
    expect(safeNext(joinAutoNext("ABC123"))).toBe("/join/ABC123?auto=1");
    // (#196) 보낸 사람 표식은 로그인하고 돌아와도 남는다
    expect(joinAutoNext("ABC123", "AbC-_12345")).toBe("/join/ABC123?auto=1&by=AbC-_12345");
    expect(safeNext(joinAutoNext("ABC123", "AbC-_12345"))).toBe("/join/ABC123?auto=1&by=AbC-_12345");
  });
});

describe("webAppleEnabled (Android 앱 셸은 애플 버튼 숨김, #145)", () => {
  it("플래그가 켜져 있으면 일반 웹과 iOS 앱은 보인다", () => {
    expect(webAppleEnabled("1", null)).toBe(true);
    expect(webAppleEnabled("1", "ios")).toBe(true);
  });
  it("Android 앱 셸 안이면 플래그와 무관하게 숨긴다", () => {
    expect(webAppleEnabled("1", "android")).toBe(false);
  });
  it("플래그가 꺼져 있으면 숨긴다", () => {
    expect(webAppleEnabled(undefined, null)).toBe(false);
    expect(webAppleEnabled("0", "ios")).toBe(false);
  });
});
