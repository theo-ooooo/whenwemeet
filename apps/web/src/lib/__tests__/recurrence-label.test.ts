import { describe, expect, it } from "vitest";
import { formRuleDate, recurrenceLines, repeatLabel, repeatUntilLabel, ruleDateKey } from "../recurrence-label";
import { kstToIso } from "../date";

describe("repeatLabel (기획 3-5)", () => {
  it("매주, 격주는 첫 회차 요일", () => {
    expect(repeatLabel("WEEKLY", "2026-11-12")).toBe("매주 목요일");
    expect(repeatLabel("BIWEEKLY", "2026-11-12")).toBe("격주 목요일");
    expect(repeatLabel("WEEKLY", "2026-11-15")).toBe("매주 일요일");
  });
  it("매월은 첫 회차 날짜 그대로. 31일은 짧은 달에 말일로 가도 설명은 31일", () => {
    expect(repeatLabel("MONTHLY", "2026-01-31")).toBe("매월 31일");
    expect(repeatLabel("MONTHLY", "2026-11-01")).toBe("매월 1일");
  });
  it("매년은 월일. 2월 29일도 그대로", () => {
    expect(repeatLabel("YEARLY", "2026-05-05")).toBe("매년 5월 5일");
    expect(repeatLabel("YEARLY", "2024-02-29")).toBe("매년 2월 29일");
  });
});

describe("repeatUntilLabel", () => {
  it("올해면 월일만, 다른 해면 연도까지", () => {
    expect(repeatUntilLabel("2026-12-31", "2026-11-10")).toBe("12월 31일까지");
    expect(repeatUntilLabel("2027-01-31", "2026-11-10")).toBe("2027년 1월 31일까지");
  });
});

describe("recurrenceLines", () => {
  const base = { startsAt: kstToIso("2026-11-26", "19:00"), seriesStartsAt: kstToIso("2026-11-12", "19:00") };
  it("한 번짜리는 null", () => {
    expect(recurrenceLines({ ...base, repeat: null, repeatUntil: null }, "2026-11-10")).toBeNull();
  });
  it("회차가 아니라 원본 첫 회차(KST) 기준. 종료가 있으면 둘째 줄", () => {
    expect(recurrenceLines({ ...base, repeat: "BIWEEKLY", repeatUntil: "2026-12-31" }, "2026-11-10")).toEqual({
      rule: "격주 목요일",
      until: "12월 31일까지",
    });
  });
  it("KST 날짜로 요일을 본다 (UTC 로는 전날인 새벽 일정)", () => {
    const iso = kstToIso("2026-11-13", "07:00"); // UTC 로는 11-12 22:00
    expect(recurrenceLines({ startsAt: iso, seriesStartsAt: iso, repeat: "WEEKLY", repeatUntil: null }, "2026-11-10")).toEqual({
      rule: "매주 금요일",
      until: null,
    });
  });
  it("seriesStartsAt 이 없으면 회차 시작으로", () => {
    expect(recurrenceLines({ startsAt: base.startsAt, seriesStartsAt: null, repeat: "MONTHLY", repeatUntil: null }, "2026-11-10")?.rule).toBe("매월 26일");
  });
});

describe("반복 기준 날짜 repeatAnchor (QA3-M3, D-71)", () => {
  // 2026-10-31 매월 원본을 2027-02-28 에서 나눈 새 원본 (기준 10-31) 의 4-30 회차
  const split = {
    repeat: "MONTHLY" as const,
    repeatUntil: null,
    startsAt: kstToIso("2027-04-30", "09:00"),
    seriesStartsAt: kstToIso("2027-02-28", "09:00"),
    repeatAnchor: "2026-10-31",
    occurrence: "2027-04-30",
  };
  it("상세: 기준이 있으면 그 날짜로 \"매월 31일\", 매년은 월일", () => {
    expect(recurrenceLines(split, "2026-11-10")?.rule).toBe("매월 31일");
    expect(ruleDateKey({ ...split, repeat: "YEARLY", repeatAnchor: "2024-02-29" })).toBe("2024-02-29");
    expect(recurrenceLines({ ...split, repeat: "YEARLY", repeatAnchor: "2024-02-29" }, "2026-11-10")?.rule).toBe("매년 2월 29일");
  });
  it("기준이 없거나 주간이면 첫 회차 날짜", () => {
    expect(ruleDateKey({ ...split, repeatAnchor: null })).toBe("2027-02-28");
    expect(ruleDateKey({ ...split, repeat: "WEEKLY" })).toBe("2027-02-28");
  });
  it("폼: 주기와 날짜를 그대로 두면 기준 날짜, 시각만 바꿔도 원래 회차 날짜면 기준 날짜", () => {
    // 매월 31일 원본(기준 없음)을 11-30 회차로 열었다 (QA 스크린샷 상황)
    const original = { ...split, repeatAnchor: null, seriesStartsAt: kstToIso("2026-10-31", "09:00"), startsAt: kstToIso("2026-11-30", "09:00"), occurrence: "2026-11-30" };
    expect(repeatLabel("MONTHLY", formRuleDate(original, "MONTHLY", "2026-11-30", true))).toBe("매월 31일");
    expect(repeatLabel("MONTHLY", formRuleDate(original, "MONTHLY", "2026-11-30", false))).toBe("매월 31일");
  });
  it("폼: 날짜를 바꾸거나 주기를 바꾸거나 새 일정이면 폼의 시작 날짜", () => {
    expect(formRuleDate(split, "MONTHLY", "2027-04-29", false)).toBe("2027-04-29");
    expect(formRuleDate(split, "YEARLY", "2027-04-30", true)).toBe("2027-04-30");
    expect(formRuleDate(null, "MONTHLY", "2027-04-30", true)).toBe("2027-04-30");
  });
  it("폼: 옮긴 회차(원래 수요일, 지금 금요일) 를 그대로 두면 원래 요일, 시각을 바꾸면 그 날짜 요일", () => {
    const moved = {
      repeat: "WEEKLY" as const,
      startsAt: kstToIso("2026-11-20", "19:00"),
      seriesStartsAt: kstToIso("2026-11-11", "19:00"),
      repeatAnchor: null,
      occurrence: "2026-11-18",
    };
    expect(repeatLabel("WEEKLY", formRuleDate(moved, "WEEKLY", "2026-11-20", true))).toBe("매주 수요일");
    expect(repeatLabel("WEEKLY", formRuleDate(moved, "WEEKLY", "2026-11-20", false))).toBe("매주 금요일");
  });
});
