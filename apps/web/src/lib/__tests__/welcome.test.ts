import { describe, expect, it } from "vitest";
import { signedOutHome, WELCOME_PATH } from "../welcome";

describe("로그인 안 한 맨 / 진입 (#407)", () => {
  it("웹 브라우저는 소개 페이지로", () => {
    expect(signedOutHome("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1")).toBe(WELCOME_PATH);
    expect(signedOutHome(null)).toBe(WELCOME_PATH);
  });
  it("앱 셸은 지금처럼 로그인 화면으로", () => {
    expect(signedOutHome("Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 Mobile/15E148 WhenwemeetApp/1.0.0 (ios)")).toBe("/login");
    expect(signedOutHome("Mozilla/5.0 (Linux; Android 15) Chrome/131 Mobile WhenwemeetApp/1.3.0 (android)")).toBe("/login");
  });
});
