import { describe, expect, it } from "vitest";
import { appSupportsEmailLogin, EMAIL_LOGIN_UA_TOKEN } from "../app-bridge";
import { appLoginMode, joinAutoNext, loginChoices, safeNext } from "../auth";
import {
  clientIpOf,
  codeErrorMessage,
  emailLoginEnabled,
  emailLoginHref,
  formatCountdown,
  isEmailShape,
  linkViewOf,
  maskEmail,
  nicknameOk,
  normalizeEmail,
  normalizeOtp,
  parseSentState,
  readAuthResult,
  readEmailErrorDetails,
  requestErrorMessage,
  secondsLeft,
  toDetailArray,
} from "../email-login";
import { internalHeaders } from "../upstream";

describe("normalizeOtp (코드 6칸, 이메일-로그인.md 10장)", () => {
  it("숫자만, 6자까지. 붙여넣기 '123 456' → 123456", () => {
    expect(normalizeOtp("123 456")).toBe("123456");
    expect(normalizeOtp("12-34-56")).toBe("123456");
    expect(normalizeOtp("코드: 987654 입니다")).toBe("987654");
    expect(normalizeOtp("1234567890")).toBe("123456");
    expect(normalizeOtp("abc")).toBe("");
    expect(normalizeOtp("０１２")).toBe("");
  });
});

describe("이메일 정규화와 모양", () => {
  it("trim + 소문자, 점과 + 는 그대로 (D-110)", () => {
    expect(normalizeEmail("  Kim.Jiwoo+Cal@Gmail.COM ")).toBe("kim.jiwoo+cal@gmail.com");
  });
  it("메일 받기 버튼을 켤 모양", () => {
    expect(isEmailShape("a@b.co")).toBe(true);
    expect(isEmailShape(" A@B.CO ")).toBe(true);
    expect(isEmailShape("")).toBe(false);
    expect(isEmailShape("a@b")).toBe(false);
    expect(isEmailShape("지우@naver.com")).toBe(false);
    expect(isEmailShape("a b@c.com")).toBe(false);
    expect(isEmailShape(`${"a".repeat(186)}@b.com`)).toBe(false);
  });
});

describe("maskEmail (6-4)", () => {
  it("로컬 앞 2자, 2자 이하면 1자", () => {
    expect(maskEmail("kim@gmail.com")).toBe("ki***@gmail.com");
    expect(maskEmail("ab@x.kr")).toBe("a***@x.kr");
    expect(maskEmail("a@x.kr")).toBe("a***@x.kr");
    expect(maskEmail("broken")).toBe("***");
  });
});

describe("카운트다운", () => {
  it("남은 초는 올림, 0 아래로 안 간다", () => {
    expect(secondsLeft(10_000, 0)).toBe(10);
    expect(secondsLeft(10_000, 9_001)).toBe(1);
    expect(secondsLeft(10_000, 10_000)).toBe(0);
    expect(secondsLeft(10_000, 20_000)).toBe(0);
  });
  it("0:42 모양", () => {
    expect(formatCountdown(42)).toBe("0:42");
    expect(formatCountdown(60)).toBe("1:00");
    expect(formatCountdown(5)).toBe("0:05");
    expect(formatCountdown(-3)).toBe("0:00");
  });
});

describe("parseSentState (sessionStorage, 15분)", () => {
  const raw = JSON.stringify({ email: "a@b.co", sentAt: 1_000_000, cooldownUntil: 1_060_000 });
  it("15분 안이면 그대로", () => {
    expect(parseSentState(raw, 1_000_000 + 14 * 60_000)).toEqual({ email: "a@b.co", sentAt: 1_000_000, cooldownUntil: 1_060_000 });
  });
  it("15분이 지났거나 모양이 틀리면 null", () => {
    expect(parseSentState(raw, 1_000_000 + 15 * 60_000 + 1)).toBeNull();
    expect(parseSentState("{", 0)).toBeNull();
    expect(parseSentState(JSON.stringify({ email: 1, sentAt: 1 }), 1)).toBeNull();
    expect(parseSentState(null, 1)).toBeNull();
  });
  it("cooldownUntil 이 없으면 sentAt", () => {
    expect(parseSentState(JSON.stringify({ email: "a@b.co", sentAt: 5 }), 10)?.cooldownUntil).toBe(5);
  });
});

describe("오류 details 읽기 (객체, 배열 둘 다)", () => {
  it("설계 4-3 객체", () => {
    expect(readEmailErrorDetails({ reason: "COOLDOWN", retryAfterSec: 41.2 })).toEqual({ reason: "COOLDOWN", retryAfterSec: 42 });
    expect(readEmailErrorDetails({ attemptsLeft: 3 })).toEqual({ attemptsLeft: 3 });
  });
  it("기존 봉투의 [{ field, message }]", () => {
    expect(
      readEmailErrorDetails([
        { field: "reason", message: "HOURLY" },
        { field: "retryAfterSec", message: "120" },
      ]),
    ).toEqual({ reason: "HOURLY", retryAfterSec: 120 });
  });
  it("배열로 옮겼다가 다시 읽어도 같다", () => {
    const info = { reason: "IP", retryAfterSec: 9, attemptsLeft: 2 };
    expect(readEmailErrorDetails(toDetailArray(info))).toEqual(info);
    expect(toDetailArray({})).toBeUndefined();
    expect(readEmailErrorDetails(null)).toEqual({});
  });
});

describe("오류 문구 (6-6)", () => {
  it("요청", () => {
    expect(requestErrorMessage("EMAIL_RATE_LIMITED", { reason: "COOLDOWN", retryAfterSec: 42 })).toBe(
      "방금 메일을 보냈어요. 42초 뒤에 다시 보낼 수 있어요",
    );
    expect(requestErrorMessage("EMAIL_RATE_LIMITED", { reason: "HOURLY", retryAfterSec: 61 })).toBe(
      "메일은 1시간에 5번까지 보낼 수 있어요. 2분 뒤에 다시 시도해 주세요",
    );
    expect(requestErrorMessage("EMAIL_RATE_LIMITED", { reason: "IP" })).toBe("요청이 너무 많아요. 잠시 후 다시 시도해 주세요");
    expect(requestErrorMessage("EMAIL_NOT_CONFIGURED", {})).toContain("지금은 이메일로 로그인할 수 없어요");
    expect(requestErrorMessage("VALIDATION_FAILED", {})).toBe("이메일 주소를 다시 확인해 주세요");
    expect(requestErrorMessage("UPSTREAM_UNAVAILABLE", {})).toBe("잠시 후 다시 시도해 주세요");
  });
  it("코드", () => {
    expect(codeErrorMessage("EMAIL_CODE_INVALID", { attemptsLeft: 3 })).toBe("코드가 맞지 않아요. 3번 더 입력할 수 있어요");
    expect(codeErrorMessage("EMAIL_CODE_LOCKED", {})).toContain("5번 틀렸어요");
    expect(codeErrorMessage("EMAIL_CODE_EXPIRED", {})).toBe("코드가 만료됐거나 이미 사용됐어요. 새 메일을 받아 주세요");
    expect(codeErrorMessage("NETWORK", {})).toBe("잠시 후 다시 시도해 주세요");
  });
});

describe("기능 스위치 (D-119)", () => {
  it("운영은 1 일 때만, 목은 0 이 아니면 켬", () => {
    expect(emailLoginEnabled("1")).toBe(true);
    expect(emailLoginEnabled(undefined)).toBe(false);
    expect(emailLoginEnabled("true")).toBe(false);
    expect(emailLoginEnabled(undefined, true)).toBe(true);
    expect(emailLoginEnabled("0", true)).toBe(false);
  });
});

describe("앱 셸 이메일 표시 (D-116)", () => {
  const OLD = "Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 WhenwemeetApp/1.1.0 (ios)";
  it("UA 토큰 EmailLogin/1 이 있는 셸만", () => {
    expect(appSupportsEmailLogin(`${OLD} ${EMAIL_LOGIN_UA_TOKEN}`)).toBe(true);
    expect(appSupportsEmailLogin("Mozilla/5.0 (Linux; Android 15) WhenwemeetApp/1.1.0 (android) EmailLogin/1")).toBe(true);
    expect(appSupportsEmailLogin(OLD)).toBe(false);
    expect(appSupportsEmailLogin("Mozilla/5.0 WhenwemeetApp/1.0.2 (ios)")).toBe(false);
    // 앱이 아니면 토큰이 있어도 false, 비슷한 토큰은 아님
    expect(appSupportsEmailLogin("Mozilla/5.0 Safari EmailLogin/1")).toBe(false);
    expect(appSupportsEmailLogin(`${OLD} EmailLogin/10`)).toBe(false);
    expect(appSupportsEmailLogin(`${OLD} XEmailLogin/1`)).toBe(false);
    expect(appSupportsEmailLogin(null)).toBe(false);
  });
  it("앱 안 /login: 스위치 켜짐 + 토큰 없는 셸만 선택 화면", () => {
    expect(appLoginMode(true, false)).toBe("chooser");
    expect(appLoginMode(true, true)).toBe("native");
    expect(appLoginMode(false, false)).toBe("native");
    expect(appLoginMode(false, true)).toBe("native");
  });
});

describe("loginChoices 이메일 (6-2)", () => {
  it("스위치가 켜지면 맨 끝에 email, 웹과 앱 모두", () => {
    expect(loginChoices(false, true, true)).toEqual(["kakao", "apple", "email"]);
    expect(loginChoices(false, false, true)).toEqual(["kakao", "email"]);
    expect(loginChoices(true, true, true)).toEqual(["native", "email"]);
    expect(loginChoices(false, true, false)).toEqual(["kakao", "apple"]);
  });
  it("이메일 화면 주소: next 는 safeNext 를 통과한 값을 인코딩", () => {
    expect(emailLoginHref("/")).toBe("/login/email");
    const next = joinAutoNext("ABC123");
    expect(emailLoginHref(next)).toBe("/login/email?next=%2Fjoin%2FABC123%3Fauto%3D1");
    expect(safeNext(decodeURIComponent(emailLoginHref(next).split("next=")[1]))).toBe(next);
  });
});

describe("기타", () => {
  it("닉네임 2~20자 (앞뒤 공백 제외)", () => {
    expect(nicknameOk(" 지 ")).toBe(false);
    expect(nicknameOk("지우")).toBe(true);
    expect(nicknameOk("가".repeat(20))).toBe(true);
    expect(nicknameOk("가".repeat(21))).toBe(false);
  });
  it("링크 화면 상태", () => {
    expect(linkViewOf("VALID")).toBe("valid");
    expect(linkViewOf("USED")).toBe("used");
    expect(linkViewOf("EXPIRED")).toBe("expired");
    expect(linkViewOf("INVALID")).toBe("expired");
    expect(linkViewOf("EMAIL_NOT_CONFIGURED")).toBe("off");
    expect(linkViewOf("UNAVAILABLE")).toBe("unavailable");
    expect(linkViewOf(undefined)).toBe("unavailable");
  });
  it("AuthResult 모양", () => {
    expect(readAuthResult({ kind: "SESSION", token: "a.b.c", next: "/x" })).toEqual({ kind: "SESSION", token: "a.b.c", next: "/x" });
    expect(readAuthResult({ kind: "SIGNUP", signupToken: "t" })).toEqual({ kind: "SIGNUP", signupToken: "t", next: "/" });
    expect(readAuthResult({ kind: "SESSION" })).toBeNull();
    expect(readAuthResult(null)).toBeNull();
  });
  it("클라이언트 IP: x-forwarded-for 첫 값, x-real-ip, unknown", () => {
    expect(clientIpOf("203.0.113.5, 10.0.0.1", "10.0.0.2")).toBe("203.0.113.5");
    expect(clientIpOf(null, " 198.51.100.7 ")).toBe("198.51.100.7");
    expect(clientIpOf("", null)).toBe("unknown");
  });
  it("내부 헤더: 키가 있을 때만 X-Internal-Key", () => {
    expect(internalHeaders("1.2.3.4", "k")).toEqual({ "X-Client-IP": "1.2.3.4", "X-Internal-Key": "k" });
    expect(internalHeaders("1.2.3.4", "")).toEqual({ "X-Client-IP": "1.2.3.4" });
  });
});
