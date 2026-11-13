import { describe, expect, it } from "vitest";
import { kstToIso } from "../date";
import { meridiem, nextOccurrences, nowLineIndex, shiftWeek, weekStrip } from "../day-view";
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

describe("nowLineIndex", () => {
  const d = "2026-11-10";
  const at = (hm: string) => Date.parse(kstToIso(d, hm));
  const timed = (a: string) => ({ startsAt: kstToIso(d, a), allDay: false });
  const allDay = { startsAt: kstToIso(d), allDay: true };
  it("지난 일정과 아직 시작 안 한 일정 사이", () => {
    expect(nowLineIndex([allDay, timed("08:00"), timed("11:00"), timed("18:00")], at("14:10"))).toBe(3);
  });
  it("진행 중인 일정은 지금 줄 앞 (시작이 지금 전)", () => {
    expect(nowLineIndex([timed("13:00"), timed("18:00")], at("14:10"))).toBe(1);
  });
  it("모두 지났으면 맨 끝", () => {
    expect(nowLineIndex([timed("08:00"), timed("09:00")], at("14:10"))).toBe(2);
  });
  it("앞에 시간 일정이 없으면 넣지 않는다 (다 앞으로, 종일뿐, 빈 목록)", () => {
    expect(nowLineIndex([timed("18:00")], at("14:10"))).toBeNull();
    expect(nowLineIndex([allDay, timed("18:00")], at("14:10"))).toBeNull();
    expect(nowLineIndex([allDay], at("14:10"))).toBeNull();
    expect(nowLineIndex([], at("14:10"))).toBeNull();
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
