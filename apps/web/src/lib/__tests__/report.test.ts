import { describe, expect, it } from "vitest";
import { REPORT_REASONS, reportDoneText, reportReasonLabel, reportSheetTitle } from "../report";
import { adminBadgeText, adminReportFilterOf, adminReportHref, adminTabOf, reportStatusLabel, reportTargetTypeLabel } from "../admin";
import { axisLabelEvery, barRatios, platformRows, showAxisLabel, statsDayLabel, statsRangeOf } from "../admin-stats";

describe("(#536) 신고 표기", () => {
  it("사유 다섯 개, 이름, 시트 제목, 완료 문구", () => {
    expect(REPORT_REASONS.map((r) => r.value)).toEqual(["spam", "abuse", "illegal", "privacy", "other"]);
    expect(reportReasonLabel("privacy")).toBe("개인정보 노출");
    expect(reportReasonLabel("x")).toBe("x");
    expect(reportSheetTitle("event")).toBe("일정 신고");
    expect(reportSheetTitle("group")).toBe("팀 신고");
    expect(reportSheetTitle("user", "하늘")).toBe("하늘 신고");
    expect(reportSheetTitle("user")).toBe("사용자 신고");
    expect(reportDoneText(false)).toBe("신고했어요. 확인 후 조치할게요");
    expect(reportDoneText(true)).toBe("이미 신고했어요. 확인 후 조치할게요");
  });

  it("관리자: 상태, 종류, 필터 기본 접수, 주소, 배지", () => {
    expect(reportStatusLabel("dismissed")).toBe("기각");
    expect(reportTargetTypeLabel("user")).toBe("사용자");
    expect(adminReportFilterOf(null)).toBe("open");
    expect(adminReportFilterOf("all")).toBe("all");
    expect(adminReportFilterOf("x")).toBe("open");
    expect(adminReportHref("event", 3)).toBe("/admin/reports/event/3");
    expect([adminBadgeText(0), adminBadgeText(undefined), adminBadgeText(3), adminBadgeText(120)]).toEqual([null, null, "3", "99+"]);
    expect(adminTabOf("/admin/reports/group/4")).toBe("/admin/reports");
  });
});

describe("(#537) 대시보드 표기", () => {
  it("탭: /admin 은 대시보드, 하위 주소는 각 탭", () => {
    expect(adminTabOf("/admin")).toBe("/admin");
    expect(adminTabOf("/admin/users/3")).toBe("/admin/users");
    expect(adminTabOf("/adminx")).toBeNull();
  });

  it("기간, 날짜 글자, 막대 비율, 축 글자", () => {
    expect([statsRangeOf(null), statsRangeOf("30"), statsRangeOf("14")]).toEqual([7, 30, 7]);
    expect(statsDayLabel("2026-11-05")).toBe("11.5");
    expect(barRatios([0, 5, 10])).toEqual([0, 0.5, 1]);
    expect(barRatios([0, 0])).toEqual([0, 0]);
    expect(axisLabelEvery(7)).toBe(1);
    expect([0, 1, 5, 28, 29].map((i) => showAxisLabel(i, 30))).toEqual([true, false, true, false, true]);
  });

  it("쓰는 곳: 전체 사용자 대비 %, 사용자가 없으면 0", () => {
    const rows = platformRows({ totals: { users: 8 } as never, platforms: { ios: 4, android: 2, web: 5, unknown: 0 } });
    expect(rows.map((r) => [r.key, r.count, r.percent])).toEqual([
      ["ios", 4, 50],
      ["android", 2, 25],
      ["web", 5, 63],
      ["unknown", 0, 0],
    ]);
    expect(platformRows({ totals: { users: 0 } as never, platforms: { ios: 0, android: 0, web: 0, unknown: 0 } })[0].percent).toBe(0);
  });
});
