// (#305) 멤버 생일 → 기념일 항목. 달력, 다가오는 일정, 위젯이 기념일 "매년" 규칙 그대로 쓰는지
import { describe, expect, it } from "vitest";
import { listValue, mainLabel, nearestOccurrence, occurrencesByDay, occurrencesInRange, sortByNext, upcomingOccurrences } from "../anniversary";
import { birthdayToAnniversary, clampDay, formatBirthday, parseBirthday, toBirthday, withBirthdays } from "../birthday";
import { kstToIso } from "../date";
import { buildWidgetSnapshot } from "../widget-snapshot";
import type { Anniversary, Birthday, GroupSummary, Member } from "../types";

const jiu: Member = { userId: 1, displayName: "지우", color: "#5B6CF4", profileImageUrl: null };
const haneul: Member = { userId: 2, displayName: "하늘", color: "#F2994A", profileImageUrl: null };
const bday = (member: Member, date: string): Birthday => ({ member, date });
const ANN: Anniversary = { id: 5, groupId: 10, name: "처음 만난 날", date: "2026-03-01", kind: "COUNT_UP", creator: jiu, createdAt: "2026-03-01T00:00:00.000Z" };

describe("생일 값", () => {
  it("parseBirthday: MM-DD 이고 있는 날만. 2월 29일은 받는다", () => {
    expect(parseBirthday("02-29")).toEqual({ m: 2, d: 29 });
    expect(parseBirthday("12-31")).toEqual({ m: 12, d: 31 });
    for (const bad of ["02-30", "04-31", "13-01", "00-01", "1-1", "", null, undefined]) expect(parseBirthday(bad)).toBeNull();
  });

  it("toBirthday, clampDay, formatBirthday", () => {
    expect(toBirthday(3, 5)).toBe("03-05");
    expect(clampDay(4, 31)).toBe(30);
    expect(clampDay(2, 31)).toBe(29);
    expect(clampDay(1, 31)).toBe(31);
    expect(formatBirthday("03-05")).toBe("3월 5일");
    expect(formatBirthday(null)).toBeNull();
  });
});

describe("생일 → 기념일 항목", () => {
  it("음수 id, 이름 '하늘 생일', 매년, 만든 사람 자리에 그 멤버", () => {
    expect(birthdayToAnniversary(bday(haneul, "03-05"), 10)).toMatchObject({
      id: -2,
      groupId: 10,
      name: "하늘 생일",
      date: "2000-03-05",
      kind: "YEARLY",
      creator: haneul,
      birthdayOf: 2,
    });
  });

  it("매년 그날 YEARLY 항목, 2월 29일은 평년 2월 28일 (기념일 매년 규칙, D-62)", () => {
    const leap = birthdayToAnniversary(bday(haneul, "02-29"), 10);
    expect(occurrencesInRange(leap, "2027-02-01", "2027-03-31").map((o) => [o.date, o.type])).toEqual([["2027-02-28", "YEARLY"]]);
    expect(occurrencesInRange(leap, "2028-02-01", "2028-03-31").map((o) => o.date)).toEqual(["2028-02-29"]);
    const may = birthdayToAnniversary(bday(jiu, "05-10"), 10);
    expect(occurrencesInRange(may, "2026-01-01", "2027-12-31").map((o) => o.date)).toEqual(["2026-05-10", "2027-05-10"]);
  });

  it("목록 값: 다음 생일까지 D-n, 당일 '오늘', 보조 줄 없음", () => {
    const a = birthdayToAnniversary(bday(haneul, "11-20"), 10);
    expect(listValue(a, "2026-11-13")).toEqual({ value: "D-7", tone: "ahead", sub: null });
    expect(listValue(a, "2026-11-20")).toEqual({ value: "오늘", tone: "today", sub: null });
    expect(listValue(a, "2026-11-21").value).toBe("D-364");
    expect(mainLabel(a, "2026-11-13")).toBe("D-7");
  });

  it("withBirthdays: 기념일 로딩 중이면 null, 생일을 못 받으면 기념일만, 아니면 뒤에 붙인다", () => {
    expect(withBirthdays(null, [bday(haneul, "03-05")], 10)).toBeNull();
    expect(withBirthdays([ANN], null, 10)).toEqual([ANN]);
    expect(withBirthdays([ANN], [], 10)).toEqual([ANN]);
    const merged = withBirthdays([ANN], [bday(jiu, "03-05"), bday(haneul, "11-20")], 10)!;
    expect(merged.map((a) => a.name)).toEqual(["처음 만난 날", "지우 생일", "하늘 생일"]);
  });

  it("달력 칸, 다가오는 일정, D-day, 기념일 화면 정렬에 같이 섞인다", () => {
    const list = withBirthdays([ANN], [bday(haneul, "11-20")], 10)!;
    expect(occurrencesByDay(list, "2026-11-01", "2026-11-30").get("2026-11-20")?.map((o) => o.anniversary.name)).toEqual(["하늘 생일"]);
    expect(upcomingOccurrences(list, "2026-11-13").map((o) => o.anniversary.name)).toEqual(["하늘 생일"]);
    expect(nearestOccurrence(list, "2026-11-13")?.date).toBe("2026-11-20");
    expect(sortByNext(list, "2026-11-13").map((a) => a.name)).toEqual(["하늘 생일", "처음 만난 날"]);
  });

  it("위젯 스냅샷 기념일 칸에 '하늘 생일' 이 들어간다", () => {
    const g = { id: 10, type: "TEAM", name: "우리", publicCode: "team10xx", memberCount: 2, me: { color: "#F26D6D", displayName: "나" }, unreadNewsCount: 0 } as GroupSummary;
    const snap = buildWidgetSnapshot(
      { groups: [g], events: new Map([[10, []]]), anniversaries: new Map([[10, withBirthdays([], [bday(haneul, "11-14")], 10)!]]) },
      Date.parse(kstToIso("2026-11-13", "09:00")),
    );
    expect(snap.anniversaries).toEqual([{ g: 10, title: "하늘 생일", date: "2026-11-14" }]);
  });
});
