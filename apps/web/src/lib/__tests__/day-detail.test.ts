import { describe, expect, it } from "vitest";
import { anniversariesOn, dayBadge, groupByDay, isMultiDay, nearestAnniversary, sheetSnap, upcomingEvents } from "../day-detail";
import { kstToIso } from "../date";
import type { Anniversary, Event, Member } from "../types";

const who: Member = { userId: 1, displayName: "지우", color: "#5B6CF4", profileImageUrl: null };
const ev = (id: number, start: string, end: string, allDay = false): Event => ({
  id,
  groupId: 2,
  publicCode: `ev${id}`.padEnd(8, "x"),
  title: `일정${id}`,
  startsAt: start,
  endsAt: end,
  allDay,
  creator: who,
  createdAt: start,
  updatedAt: start,
  repeat: null,
  repeatUntil: null,
  occurrence: null,
  seriesStartsAt: null,
  repeatAnchor: null,
});
const ann = (id: number, date: string, kind: Anniversary["kind"] = "ONCE"): Anniversary => ({
  id,
  groupId: 2,
  name: `기념${id}`,
  date,
  kind,
  creator: who,
  createdAt: date,
});

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

describe("anniversariesOn (#107)", () => {
  it("그날의 항목 전부, 우선순위 순", () => {
    const list = [ann(1, "2026-11-10"), ann(2, "2025-11-10"), ann(3, "2025-11-10", "COUNT_UP"), ann(4, "2026-08-03", "COUNT_UP")];
    expect(anniversariesOn(list, "2026-11-10").map((o) => `${o.anniversary.id} ${o.label ?? o.type}`)).toEqual([
      "3 1주년",
      "4 100일",
      "1 ORIGINAL",
    ]);
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
  it("반복 일정은 같은 id 라도 회차마다 따로 (#187)", () => {
    const now = Date.parse(kstToIso("2026-11-10", "12:00"));
    const w1 = { ...ev(9, kstToIso("2026-11-11", "19:00"), kstToIso("2026-11-11", "21:00")), repeat: "WEEKLY" as const, occurrence: "2026-11-11" };
    const w2 = { ...w1, startsAt: kstToIso("2026-11-18", "19:00"), endsAt: kstToIso("2026-11-18", "21:00"), occurrence: "2026-11-18" };
    expect(upcomingEvents([w2, w1, w1], now, 5).map((e) => e.occurrence)).toEqual(["2026-11-11", "2026-11-18"]);
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

// 넓은 화면 칩: 여러 날 일정은 종일, 시간 모두 같은 옅은 색 칩 (#174 L13)
describe("isMultiDay", () => {
  it("시간 일정이 날을 넘으면 여러 날", () => {
    expect(isMultiDay(ev(1, kstToIso("2026-11-27", "09:00"), kstToIso("2026-11-30", "18:00")))).toBe(true);
    expect(isMultiDay(ev(2, kstToIso("2026-11-27", "09:00"), kstToIso("2026-11-27", "18:00")))).toBe(false);
  });
  it("자정에 끝나면 그 앞날까지", () => {
    expect(isMultiDay(ev(3, kstToIso("2026-11-27", "22:00"), kstToIso("2026-11-28", "00:00")))).toBe(false);
  });
  it("종일은 이틀 이상일 때만", () => {
    expect(isMultiDay(ev(4, kstToIso("2026-11-21"), kstToIso("2026-11-25"), true))).toBe(true);
    expect(isMultiDay(ev(5, kstToIso("2026-11-21"), kstToIso("2026-11-22"), true))).toBe(false);
  });
});

describe("nearestAnniversary — 요약 카드 (QA3-L4)", () => {
  it("없으면 null", () => {
    expect(nearestAnniversary(null, "2026-11-10")).toBeNull();
    expect(nearestAnniversary([], "2026-11-10")).toBeNull();
  });

  it("오늘 N일이면 이름과 N일을 나눠 준다 (좁은 카드에서 이름만 줄인다)", () => {
    // 2024-02-15 부터 1000일째 = 2026-11-10
    const met = { ...ann(1, "2024-02-15", "COUNT_UP"), name: "처음 만난 날" };
    expect(nearestAnniversary([met], "2026-11-10")).toEqual({ name: "처음 만난 날", label: "1000일", value: "오늘" });
  });

  it("앞으로 오는 원래 날짜는 label 없이 D-n", () => {
    expect(nearestAnniversary([ann(1, "2026-11-13")], "2026-11-10")).toEqual({ name: "기념1", label: null, value: "D-3" });
  });

  it("다음 항목이 없으면(지난 그날만) 가장 가까운 것의 D+n", () => {
    expect(nearestAnniversary([ann(1, "2026-11-01"), ann(2, "2026-10-01")], "2026-11-10")).toEqual({ name: "기념1", label: null, value: "D+9" });
  });
});
