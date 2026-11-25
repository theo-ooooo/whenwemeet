import { describe, expect, it } from "vitest";
import { adminActionLabel, adminDateTime, adminEventTime, adminGroupFilterOf, adminGroupName, adminGroupTypeParam, adminTabOf, adminTargetLabel, providerText } from "../admin";

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
