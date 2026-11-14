import { describe, expect, it } from "vitest";
import { countEventsInRange, weekQueryOf, weekRangeOf } from "../week-summary";

describe("weekRangeOf (일요일 시작, KST 날짜, #437)", () => {
  it.each([
    ["2026-11-10", "2026-11-08", "2026-11-15"], // 화
    ["2026-11-08", "2026-11-08", "2026-11-15"], // 일은 그 주 시작
    ["2026-11-14", "2026-11-08", "2026-11-15"], // 토는 그 주 끝
    ["2026-12-31", "2026-12-27", "2027-01-03"], // 해 넘김
  ])("%s → %s ~ %s", (today, from, to) => {
    expect(weekRangeOf(today)).toEqual({ from, to });
  });

  it("조회 범위는 KST 자정 ISO", () => {
    expect(weekQueryOf("2026-11-10")).toEqual({ from: "2026-11-07T15:00:00.000Z", to: "2026-11-14T15:00:00.000Z" });
  });
});

describe("countEventsInRange", () => {
  const { from, to } = weekQueryOf("2026-11-10");
  const ev = (id: number, startsAt: string, endsAt: string, occurrence: string | null = null) => ({ id, startsAt, endsAt, occurrence });

  it("범위와 겹치는 일정만 센다 (경계는 포함 안 함)", () => {
    const list = [
      ev(1, "2026-11-09T10:00:00+09:00", "2026-11-09T11:00:00+09:00"), // 월요일
      ev(2, "2026-11-14T23:00:00+09:00", "2026-11-15T01:00:00+09:00"), // 토요일 밤부터 걸침
      ev(3, "2026-11-07T00:00:00+09:00", "2026-11-08T00:00:00+09:00"), // 전날 종일 (끝 = 시작 경계)
      ev(4, "2026-11-15T00:00:00+09:00", "2026-11-16T00:00:00+09:00"), // 다음 주 일요일
      ev(5, "2026-11-01T00:00:00+09:00", "2026-11-30T00:00:00+09:00"), // 주를 통째로 덮음
    ];
    expect(countEventsInRange(list, from, to)).toBe(3);
  });

  it("KST 와 UTC 표기가 섞여도 시각으로 비교한다", () => {
    // 2026-11-07T15:30Z = 11-08 00:30 KST (이번 주)
    expect(countEventsInRange([ev(1, "2026-11-07T15:30:00.000Z", "2026-11-07T16:00:00.000Z")], from, to)).toBe(1);
    // 2026-11-07T14:30Z = 11-07 23:30 KST (지난주)
    expect(countEventsInRange([ev(1, "2026-11-07T14:30:00.000Z", "2026-11-07T14:45:00.000Z")], from, to)).toBe(0);
  });

  it("같은 일정은 한 번, 반복 회차는 회차마다", () => {
    const a = ev(7, "2026-11-10T09:00:00+09:00", "2026-11-10T10:00:00+09:00", "2026-11-10");
    const b = ev(7, "2026-11-12T09:00:00+09:00", "2026-11-12T10:00:00+09:00", "2026-11-12");
    expect(countEventsInRange([a, a, b], from, to)).toBe(2);
  });

  it("목록이 없으면 0", () => {
    expect(countEventsInRange(null, from, to)).toBe(0);
    expect(countEventsInRange([], from, to)).toBe(0);
  });
});
