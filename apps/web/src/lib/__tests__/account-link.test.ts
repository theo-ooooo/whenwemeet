import { describe, expect, it } from "vitest";
import {
  ACCOUNT_LINK_UA_TOKEN,
  appSupportsAccountLink,
  linkableProviders,
  linkedMessage,
  linkErrorMessage,
  linkReturnPath,
  readLinkResult,
  unlinkConfirmBody,
} from "../account-link";

const APP_UA = "Mozilla/5.0 (iPhone) WhenwemeetApp/1.2.0 (ios) EmailLogin/1";

describe("(#198) 로그인 방법 연결 버튼", () => {
  const base = { inApp: false, appLink: false, appleEnabled: true, emailEnabled: true, linked: [] as string[] };

  it("웹: 카카오, Apple, 이메일 순. 이미 연결된 제공자는 뺀다", () => {
    expect(linkableProviders(base)).toEqual(["KAKAO", "APPLE", "EMAIL"]);
    expect(linkableProviders({ ...base, linked: ["KAKAO", "EMAIL"] })).toEqual(["APPLE"]);
  });

  it("앱 셸: AccountLink/1 이 없으면 카카오, Apple 은 숨기고 이메일만 (웹 링크 경로를 셸이 가로챈다)", () => {
    expect(linkableProviders({ ...base, inApp: true })).toEqual(["EMAIL"]);
    expect(linkableProviders({ ...base, inApp: true, appLink: true })).toEqual(["KAKAO", "APPLE", "EMAIL"]);
  });

  it("Apple 은 웹 Apple 스위치(Android 앱은 꺼짐), 이메일은 이메일 스위치", () => {
    expect(linkableProviders({ ...base, appleEnabled: false, emailEnabled: false })).toEqual(["KAKAO"]);
  });

  it("UA 능력 토큰은 앱 셸 UA 에서만", () => {
    expect(appSupportsAccountLink(APP_UA)).toBe(false);
    expect(appSupportsAccountLink(`${APP_UA} ${ACCOUNT_LINK_UA_TOKEN}`)).toBe(true);
    expect(appSupportsAccountLink(`Mozilla/5.0 Chrome ${ACCOUNT_LINK_UA_TOKEN}`)).toBe(false);
    expect(appSupportsAccountLink(`${APP_UA} AccountLink/10`)).toBe(false);
    expect(appSupportsAccountLink(null)).toBe(false);
  });
});

describe("(#198) 결과 주소와 문구", () => {
  it("next 가 규칙 밖이거나 / 면 로그인 방법 화면. 앞 결과는 지우고 새 결과를 싣는다", () => {
    expect(linkReturnPath("https://evil.example", { linked: "KAKAO" })).toBe("/me/accounts?linked=KAKAO");
    expect(linkReturnPath("//evil", { error: "X" })).toBe("/me/accounts?link_error=X");
    expect(linkReturnPath(null, { linked: "APPLE", absorbed: true })).toBe("/me/accounts?linked=APPLE&absorbed=1");
    expect(linkReturnPath("/me/accounts?provider=KAKAO&link_error=OLD", { error: "AUTH_ACCOUNT_IN_USE" })).toBe(
      "/me/accounts?provider=KAKAO&link_error=AUTH_ACCOUNT_IN_USE",
    );
    expect(linkReturnPath("/me/accounts", { provider: "APPLE" })).toBe("/me/accounts?provider=APPLE");
  });

  it("주소의 결과 → 토스트. 사용자 취소는 문구 없음", () => {
    expect(readLinkResult(new URLSearchParams("linked=KAKAO"))).toEqual({ message: "카카오를 연결했어요", tone: "ok" });
    expect(readLinkResult(new URLSearchParams("linked=APPLE&absorbed=1"))?.message).toBe("Apple을 연결하고 빈 계정을 합쳤어요");
    expect(readLinkResult(new URLSearchParams("provider=KAKAO&link_error=AUTH_ACCOUNT_IN_USE"))?.message).toBe("이 카카오 계정은 다른 달력에서 쓰고 있어요");
    expect(readLinkResult(new URLSearchParams("link_error=AUTH_ACCOUNT_IN_USE"))?.message).toBe("이 계정은 다른 달력에서 쓰고 있어요");
    expect(readLinkResult(new URLSearchParams("link_error=APPLE_CANCELLED"))).toBeNull();
    expect(readLinkResult(new URLSearchParams(""))).toBeNull();
  });

  it("문구는 짧게, 조사 맞춤", () => {
    expect(linkedMessage("EMAIL", false)).toBe("이메일을 연결했어요");
    expect(linkErrorMessage("PROVIDER_ALREADY_LINKED", "KAKAO")).toBe("카카오는 이미 연결돼 있어요");
    expect(linkErrorMessage("REAUTH_REQUIRED")).toBe("보안을 위해 다시 로그인해 주세요");
    expect(linkErrorMessage("LINK_TICKET_INVALID")).toBe("연결 시간이 지났어요. 다시 시도해 주세요");
    expect(linkErrorMessage("WHATEVER")).toBe("연결하지 못했어요. 잠시 후 다시 시도해 주세요");
    expect(unlinkConfirmBody("KAKAO")).toBe("카카오로는 더 이상 로그인할 수 없어요");
  });
});
