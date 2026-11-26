import { describe, expect, it } from "vitest";
import { formatLunar, hasLeapMonth, isLunarDate, lunarCellText, lunarOccurrence, lunarToSolar, solarToLunar } from "../lunar";

// (#562, D-297) 서버 common/lunar.spec.ts 와 같은 값 (두 앱이 같은 날을 가리켜야 한다)
describe("음력 변환", () => {
  it("2026 설날 = 양력 2월 17일, 추석 = 9월 25일", () => {
    expect(lunarToSolar({ year: 2026, month: 1, day: 1, leap: false })).toBe("2026-02-17");
    expect(lunarToSolar({ year: 2026, month: 8, day: 15, leap: false })).toBe("2026-09-25");
    expect(solarToLunar("2026-09-25")).toEqual({ year: 2026, month: 8, day: 15, leap: false });
  });

  it("윤달: 2023 윤2월 1일 = 3월 22일, 2025 윤6월 있음, 2026 윤6월 없음", () => {
    expect(lunarToSolar({ year: 2023, month: 2, day: 1, leap: true })).toBe("2023-03-22");
    expect(solarToLunar("2023-03-22")).toEqual({ year: 2023, month: 2, day: 1, leap: true });
    expect(hasLeapMonth(2025, 6)).toBe(true);
    expect(hasLeapMonth(2026, 6)).toBe(false);
  });

  it("없는 날짜, 범위 밖은 null", () => {
    expect(isLunarDate({ year: 2026, month: 2, day: 30, leap: false })).toBe(false);
    expect(solarToLunar("2051-01-01")).toBeNull();
    expect(lunarOccurrence(2051, 1, 1, false)).toBeNull();
  });

  it("해마다: 30일은 29일인 해에 29일, 윤달은 없는 해에 평달, 음력 12월은 다음 양력 해", () => {
    expect(lunarOccurrence(2027, 1, 30, false)).toBe("2027-03-07");
    expect(lunarOccurrence(2026, 6, 15, true)).toBe("2026-07-28");
    expect(lunarOccurrence(2025, 6, 15, true)).toBe("2025-08-08");
    expect(lunarOccurrence(2026, 12, 15, false)).toBe("2027-01-22");
  });

  it("글자: 음력 3월 15일, 윤달, 연도", () => {
    expect(formatLunar(3, 15, false)).toBe("음력 3월 15일");
    expect(formatLunar(4, 15, true, 2028)).toBe("음력 2028년 윤4월 15일");
  });

  it("달력 칸: 넓은 칸 10.6 / 초하루 '음 11.1', 폰은 날만 '6' / 초하루 '11.1'", () => {
    // 2026-11-14 = 음력 10월 6일, 2026-12-09 = 음력 11월 1일
    expect(lunarCellText("2026-11-14")).toEqual({ text: "10.6", short: "10.6", compact: "", first: false, label: "음력 10월 6일" });
    // 폰은 초하루와 보름만 (#562)
    expect(lunarCellText("2026-11-23")?.compact).toBe("10.15");
    expect(lunarCellText("2026-12-09")).toEqual({ text: "음 11.1", short: "11.1", compact: "11.1", first: true, label: "음력 11월 1일" });
    expect(lunarCellText("2023-03-22")).toMatchObject({ text: "윤2.1", short: "윤2.1", compact: "윤2.1", first: true });
    expect(lunarCellText("2051-01-01")).toBeNull();
  });
});
