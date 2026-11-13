import { describe, expect, it } from "vitest";
import { kstToIso } from "../date";
import { dayRangeText, groupFreeDays, hourText, longestSlot, minLengthText, periodText, shortDay, whoText } from "../free-view";

const slot = (d: string, a: string, b: string) => ({ startsAt: kstToIso(d, a), endsAt: kstToIso(d, b) });

describe("조건 칩 글자", () => {
  it("시각: 오전/오후 h시, 분은 있을 때만, 자정 끝은 밤 12시", () => {
    expect(hourText("09:00")).toBe("오전 9시");
    expect(hourText("13:30")).toBe("오후 1시 30분");
    expect(hourText("12:00")).toBe("오후 12시");
    expect(hourText("00:00")).toBe("오전 12시");
    expect(hourText("24:00")).toBe("밤 12시");
    expect(dayRangeText("09:00", "23:00")).toBe("오전 9시 ~ 오후 11시");
  });
  it("최소 길이: 2시간 이상, 반나절 이상, 1시간 30분 이상", () => {
    expect(minLengthText(120)).toBe("2시간 이상");
    expect(minLengthText(360)).toBe("반나절 이상");
    expect(minLengthText(90)).toBe("1시간 30분 이상");
    expect(minLengthText(30)).toBe("30분 이상");
  });
  it("기간: 이번 주, 다음 주, 직접은 날짜 (끝 날 포함, 하루면 하나)", () => {
    expect(periodText("thisWeek", "2026-11-09", "2026-11-15")).toBe("이번 주");
    expect(periodText("nextWeek", "2026-11-16", "2026-11-22")).toBe("다음 주");
    expect(periodText("custom", "2026-11-13", "2026-11-19")).toBe("11/13 ~ 11/19");
    expect(periodText("custom", "2026-11-13", "2026-11-13")).toBe("11/13");
  });
  it("날짜 짧게, 요약 앞머리", () => {
    expect(shortDay("2026-11-14")).toBe("토 11/14");
    expect(whoText(1)).toBe("내 일정 기준");
    expect(whoText(2)).toBe("둘 모두");
    expect(whoText(4)).toBe("4명 모두");
  });
});

describe("groupFreeDays, longestSlot", () => {
  const slots = [slot("2026-11-14", "17:00", "19:30"), slot("2026-11-13", "16:30", "19:00"), slot("2026-11-14", "09:00", "16:00")];
  it("날짜별 묶음(날짜 순), 하루 막대 구간(ms), 합계(분)", () => {
    const days = groupFreeDays(slots);
    expect(days.map((d) => d.date)).toEqual(["2026-11-13", "2026-11-14"]);
    expect(days[1].minutes).toBe(150 + 420);
    expect(days[1].free[0]).toEqual({ start: Date.parse(kstToIso("2026-11-14", "17:00")), end: Date.parse(kstToIso("2026-11-14", "19:30")) });
  });
  it("가장 긴 곳 (같으면 먼저 온 것), 없으면 null", () => {
    expect(longestSlot(slots)).toEqual(slots[2]);
    expect(longestSlot([slot("2026-11-13", "10:00", "11:00"), slot("2026-11-14", "10:00", "11:00")])).toEqual(slot("2026-11-13", "10:00", "11:00"));
    expect(longestSlot([])).toBeNull();
  });
});
