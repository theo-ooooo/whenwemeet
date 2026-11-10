import { describe, expect, it } from "vitest";
import { kstToIso } from "../date";
import { meridiem, nextOccurrences, shiftWeek, timeColumn, weekStrip } from "../day-view";
import type { Anniversary, Member } from "../types";

const who: Member = { userId: 1, displayName: "지우", color: "#5B6CF4", profileImageUrl: null };
const ann = (id: number, date: string, kind: Anniversary["kind"] = "ONCE"): Anniversary => ({
  id,
  groupId: 2,
  name: `기념${id}`,
  date,
  kind,
  creator: who,
  createdAt: date,
});

describe("weekStrip", () => {
  it("그 날이 든 주의 일요일부터 7칸", () => {
    // 2026-11-10 은 화요일
    expect(weekStrip("2026-11-10")).toEqual([
      "2026-11-08",
      "2026-11-09",
      "2026-11-10",
      "2026-11-11",
      "2026-11-12",
      "2026-11-13",
      "2026-11-14",
    ]);
  });
  it("일요일이면 그날부터, 토요일이면 그날까지", () => {
    expect(weekStrip("2026-11-08")[0]).toBe("2026-11-08");
    expect(weekStrip("2026-11-14")[6]).toBe("2026-11-14");
  });
  it("달과 해를 넘는 주", () => {
    expect(weekStrip("2026-12-31")).toEqual([
      "2026-12-27",
      "2026-12-28",
      "2026-12-29",
      "2026-12-30",
      "2026-12-31",
      "2027-01-01",
      "2027-01-02",
    ]);
  });
});

describe("shiftWeek", () => {
  it("같은 요일의 지난주, 다음 주", () => {
    expect(shiftWeek("2026-11-10", 1)).toBe("2026-11-17");
    expect(shiftWeek("2026-11-03", -1)).toBe("2026-10-27");
  });
});

describe("meridiem", () => {
  it("오전, 오후, 12시", () => {
    expect(meridiem("00:30")).toEqual({ label: "오전", value: "12:30" });
    expect(meridiem("09:05")).toEqual({ label: "오전", value: "9:05" });
    expect(meridiem("12:00")).toEqual({ label: "오후", value: "12:00" });
    expect(meridiem("23:59")).toEqual({ label: "오후", value: "11:59" });
  });
});

describe("timeColumn", () => {
  const d = "2026-11-10";
  it("종일", () => {
    expect(timeColumn({ startsAt: kstToIso(d), endsAt: kstToIso("2026-11-11"), allDay: true }, d)).toEqual({ label: "하루 종일", value: null });
  });
  it("그날 시작하면 시작 시각 (KST)", () => {
    expect(timeColumn({ startsAt: kstToIso(d, "19:00"), endsAt: kstToIso(d, "21:00"), allDay: false }, d)).toEqual({ label: "오후", value: "7:00" });
    expect(timeColumn({ startsAt: kstToIso(d, "08:30"), endsAt: kstToIso(d, "09:00"), allDay: false }, d)).toEqual({ label: "오전", value: "8:30" });
  });
  it("전날부터 이어지면 끝 시각, 그날을 다 덮으면 하루 종일", () => {
    const start = kstToIso("2026-11-09", "22:00");
    expect(timeColumn({ startsAt: start, endsAt: kstToIso(d, "02:00"), allDay: false }, d)).toEqual({ label: "오전", value: "~2:00" });
    expect(timeColumn({ startsAt: start, endsAt: kstToIso("2026-11-11", "01:00"), allDay: false }, d)).toEqual({ label: "하루 종일", value: null });
  });
});

describe("nextOccurrences", () => {
  it("기념일마다 다음 항목 하나, 가까운 순, 지난 그날만은 뺀다", () => {
    const list = [ann(1, "2026-12-25"), ann(2, "2026-11-20"), ann(3, "2025-01-01")];
    const out = nextOccurrences(list, "2026-11-10");
    expect(out.map((o) => [o.anniversary.id, o.date])).toEqual([
      [2, "2026-11-20"],
      [1, "2026-12-25"],
    ]);
  });
  it("오늘 항목 포함, limit", () => {
    const list = [ann(1, "2026-11-10"), ann(2, "2026-11-11"), ann(3, "2026-11-12")];
    expect(nextOccurrences(list, "2026-11-10", 2).map((o) => o.date)).toEqual(["2026-11-10", "2026-11-11"]);
    expect(nextOccurrences(null, "2026-11-10")).toEqual([]);
  });
});
