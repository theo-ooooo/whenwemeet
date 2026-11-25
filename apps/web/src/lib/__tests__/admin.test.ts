import { describe, expect, it } from "vitest";
import { adminActionLabel, adminDateTime, adminEventTime, adminGroupFilterOf, adminGroupName, adminGroupTypeParam, adminPlatformFilterOf, adminPlatformLabels, adminPlatformSeenText, adminTabOf, adminTargetLabel, providerText } from "../admin";

describe("관리자 표기 (#515)", () => {
  it("탭: 하위 주소도 같은 탭", () => {
    expect(adminTabOf("/admin/notices")).toBe("/admin/notices");
    expect(adminTabOf("/admin/notices/3")).toBe("/admin/notices");
    expect(adminTabOf("/admin/users")).toBe("/admin/users");
    expect(adminTabOf("/admin/teams/3")).toBe("/admin/teams");
    expect(adminTabOf("/admin/events")).toBe("/admin/events");
    expect(adminTabOf("/admin")).toBeNull();
    expect(adminTabOf("/admin/noticesx")).toBeNull();
  });

  it("조치, 대상, 로그인 방법, 날짜", () => {
    expect(adminActionLabel("user_role")).toBe("역할 변경");
    expect(adminActionLabel("unknown")).toBe("unknown");
    expect(adminTargetLabel("group", 4)).toBe("팀 #4");
    expect(providerText(["KAKAO", "APPLE"])).toBe("카카오, Apple");
    expect(providerText([])).toBe("-");
    expect(adminDateTime("2026-11-25T05:05:00.000Z")).toBe("2026.11.25 14:05");
    expect(adminEventTime("2026-11-25T05:05:00.000Z", false)).toBe("2026.11.25 14:05");
    expect(adminEventTime("2026-11-24T15:00:00.000Z", true)).toBe("2026.11.25 종일");
  });
});

describe("(#528) 관리자 팀 이름과 종류 필터", () => {
  it("개인 달력은 주인으로 부르고(주인이 없으면 '개인 달력'), 팀은 이름 그대로", () => {
    expect(adminGroupName({ name: "내 달력", type: "PERSONAL", owner: { nickname: "지우" } })).toBe("지우의 개인 달력");
    expect(adminGroupName({ name: "내 달력", type: "PERSONAL", owner: null })).toBe("개인 달력");
    expect(adminGroupName({ name: "우리 둘", type: "TEAM", owner: null })).toBe("우리 둘");
  });

  it("주소 ?type= 은 기본 team, 모르는 값도 team. API 값으로 바꾼다", () => {
    expect(adminGroupFilterOf(null)).toBe("team");
    expect(adminGroupFilterOf("x")).toBe("team");
    expect(adminGroupFilterOf("personal")).toBe("personal");
    expect(adminGroupFilterOf("all")).toBe("all");
    expect([adminGroupTypeParam("team"), adminGroupTypeParam("personal"), adminGroupTypeParam("all")]).toEqual(["TEAM", "PERSONAL", null]);
  });
});

describe("(#528) 쓰는 곳 표기와 필터", () => {
  it("iOS, Android, 웹만, 빈 배열은 앱 (기종 모름)", () => {
    expect(adminPlatformLabels(["ios", "android"])).toEqual(["iOS", "Android"]);
    expect(adminPlatformLabels(["web"])).toEqual(["웹만"]);
    expect(adminPlatformLabels(["ios", "web"])).toEqual(["iOS", "웹"]);
    expect(adminPlatformLabels([])).toEqual(["앱 (기종 모름)"]);
  });

  it("(#532) 기종 한 줄은 이름, 앱 버전, 마지막 접속 월.일 (KST)", () => {
    expect(adminPlatformSeenText({ platform: "ios", appVersion: "1.3.0", lastSeenAt: "2026-11-25T03:00:00.000Z" })).toBe("iOS 1.3.0 · 마지막 11.25");
    expect(adminPlatformSeenText({ platform: "android", appVersion: "1.2.1", lastSeenAt: "2026-11-24T16:30:00.000Z" })).toBe("Android 1.2.1 · 마지막 11.25");
    expect(adminPlatformSeenText({ platform: "web", appVersion: null, lastSeenAt: "2026-11-24T00:00:00.000Z" })).toBe("웹 · 마지막 11.24");
  });

  it("?platform= 은 ios, android, web 만, 그 밖은 전체", () => {
    expect([adminPlatformFilterOf(null), adminPlatformFilterOf("IOS"), adminPlatformFilterOf("web")]).toEqual(["all", "all", "web"]);
  });
});

describe("(#539) 앱 버전 탭과 기록 표기", () => {
  it("탭, 조치, 대상", () => {
    expect(adminTabOf("/admin/app-versions")).toBe("/admin/app-versions");
    expect(adminActionLabel("app_release_update")).toBe("앱 버전 변경");
    expect(adminTargetLabel("app_release", 1)).toBe("앱 버전 #1");
  });
});
