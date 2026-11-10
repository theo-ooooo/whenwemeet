import { describe, expect, it } from "vitest";
import { recurrenceLines, repeatLabel, repeatUntilLabel } from "../recurrence-label";
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
