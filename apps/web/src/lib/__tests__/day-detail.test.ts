import { describe, expect, it } from "vitest";
import { anniversariesOn, dayBadge, groupByDay, sheetSnap, upcomingEvents } from "../day-detail";
import { kstToIso } from "../date";
import type { Anniversary, Event, Member } from "../types";

const who: Member = { userId: 1, displayName: "지우", color: "#5B6CF4", profileImageUrl: null };
const ev = (id: number, start: string, end: string, allDay = false): Event => ({
  id,
  groupId: 2,
  title: `일정${id}`,
  startsAt: start,
  endsAt: end,
  allDay,
  creator: who,
  createdAt: start,
  updatedAt: start,
});
const ann = (id: number, date: string): Anniversary => ({ id, groupId: 2, name: `기념${id}`, date, creator: who, createdAt: date });

describe("groupByDay", () => {
  it("여러 날 종일 → 종일 → 시각 순, 걸친 날 모두", () => {
    const a = ev(1, kstToIso("2026-11-10", "19:00"), kstToIso("2026-11-10", "21:00"));
    const b = ev(2, kstToIso("2026-11-10"), kstToIso("2026-11-11"), true);
    const c = ev(3, kstToIso("2026-11-09"), kstToIso("2026-11-12"), true);
    const map = groupByDay([a, b, c]);
    expect(map.get("2026-11-10")?.map((e) => e.id)).toEqual([3, 2, 1]);
    expect(map.get("2026-11-11")?.map((e) => e.id)).toEqual([3]);
    expect(map.get("2026-11-12")).toBeUndefined();
  });
});

describe("anniversariesOn (#107 자리)", () => {
  it("등록 날짜와 같은 날만", () => {
    const list = [ann(1, "2026-11-10"), ann(2, "2025-11-10")];
    expect(anniversariesOn(list, "2026-11-10").map((a) => a.id)).toEqual([1]);
    expect(anniversariesOn(null, "2026-11-10")).toEqual([]);
  });
});

describe("dayBadge", () => {
  it("오늘, 앞으로, 지난 날", () => {
    expect(dayBadge("2026-11-10", "2026-11-10")).toBe("오늘");
    expect(dayBadge("2026-11-13", "2026-11-10")).toBe("D-3");
    expect(dayBadge("2026-11-05", "2026-11-10")).toBe("D+5");
  });
});

describe("upcomingEvents", () => {
  it("끝난 일정은 빼고 시작 순, 중복 제거, 개수 제한", () => {
    const now = Date.parse(kstToIso("2026-11-10", "12:00"));
    const past = ev(1, kstToIso("2026-11-10", "09:00"), kstToIso("2026-11-10", "10:00"));
    const ongoing = ev(2, kstToIso("2026-11-10", "11:00"), kstToIso("2026-11-10", "13:00"));
    const later = ev(3, kstToIso("2026-11-12", "10:00"), kstToIso("2026-11-12", "11:00"));
    const soon = ev(4, kstToIso("2026-11-11"), kstToIso("2026-11-12"), true);
    expect(upcomingEvents([later, past, soon, ongoing, later], now, 5).map((e) => e.id)).toEqual([2, 4, 3]);
    expect(upcomingEvents([later, soon, ongoing], now, 2).map((e) => e.id)).toEqual([2, 4]);
    expect(upcomingEvents(null, now, 3)).toEqual([]);
  });
});

describe("sheetSnap", () => {
  it("반 높이에서", () => {
    expect(sheetSnap("half", 120)).toBe("close");
    expect(sheetSnap("half", 30)).toBe("half");
    expect(sheetSnap("half", 30, 1)).toBe("close");
    expect(sheetSnap("half", -60)).toBe("full");
    expect(sheetSnap("half", -20, -1)).toBe("full");
    expect(sheetSnap("half", -10)).toBe("half");
  });
  it("전체에서", () => {
    expect(sheetSnap("full", 100)).toBe("half");
    expect(sheetSnap("full", 40)).toBe("full");
    expect(sheetSnap("full", 20, 1)).toBe("half");
    expect(sheetSnap("full", -100)).toBe("full");
  });
});
