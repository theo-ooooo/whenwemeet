import { describe, expect, it } from "vitest";
import { adminActionLabel, adminDateTime, adminTabOf, adminTargetLabel, providerText } from "../admin";

describe("관리자 표기 (#515)", () => {
  it("탭: 하위 주소도 같은 탭", () => {
    expect(adminTabOf("/admin/notices")).toBe("/admin/notices");
    expect(adminTabOf("/admin/notices/3")).toBe("/admin/notices");
    expect(adminTabOf("/admin/users")).toBe("/admin/users");
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
  });
});
