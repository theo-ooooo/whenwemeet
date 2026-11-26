import { describe, expect, it } from "vitest";
import { anniversaryOrigin, listValue, lunarYearHint, mainLabel, nextOccurrence, occurrencesInRange, sortByNext } from "../anniversary";
import { birthdayToAnniversary, formatBirthday, parseBirthday } from "../birthday";
import type { Anniversary, AnniversaryKind, Member } from "../types";

// (#562, D-297) 음력 기념일, 생일이 해마다 양력 날짜로 (서버 push/anniversary-lunar.spec.ts 와 같은 값)
const who: Member = { userId: 1, displayName: "지우", color: "#5B6CF4", profileImageUrl: null };
const lunar = (id: number, date: string, kind: AnniversaryKind, isLeapMonth = false): Anniversary => ({
  id,
  groupId: 2,
  name: `음력${id}`,
  date,
  kind,
  calendar: "LUNAR",
  isLeapMonth,
  creator: who,
  createdAt: "2026-01-01T00:00:00.000Z",
});
const dates = (a: Anniversary, from: string, to: string) => occurrencesInRange(a, from, to).map((o) => [o.date, o.type, o.label]);

describe("음력 기념일 항목", () => {
  it("YEARLY 음력 3월 15일: 2026-05-01, 2027-04-21 (양력 3월 15일 아님)", () => {
    const a = lunar(1, "2000-03-15", "YEARLY");
    expect(anniversaryOrigin(a)).toBe("2000-04-19");
    expect(dates(a, "2026-01-01", "2027-12-31")).toEqual([
      ["2026-05-01", "YEARLY", null],
      ["2027-04-21", "YEARLY", null],
    ]);
  });

  it("음력 12월은 다음 양력 해 1월 (범위가 양력 해 하나여도 앞 음력 해를 본다)", () => {
    const a = lunar(2, "2000-12-15", "YEARLY");
    expect(dates(a, "2027-01-01", "2027-01-31")).toEqual([["2027-01-22", "YEARLY", null]]);
    expect(dates(a, "2026-01-01", "2026-12-31")).toEqual([["2026-02-02", "YEARLY", null]]);
  });

  it("COUNT_UP: 100일은 양력 원래 날짜부터, 1주년은 음력 해로", () => {
    const a = lunar(3, "2025-03-15", "COUNT_UP");
    expect(dates(a, "2025-07-20", "2025-07-20")).toEqual([["2025-07-20", "DAYS", "100일"]]);
    expect(dates(a, "2026-05-01", "2026-05-01")).toEqual([["2026-05-01", "YEARS", "1주년"]]);
  });

  it("윤달, 없는 30일", () => {
    expect(dates(lunar(4, "2025-06-15", "YEARLY", true), "2026-01-01", "2026-12-31")).toEqual([["2026-07-28", "YEARLY", null]]);
    expect(dates(lunar(5, "2026-01-30", "YEARLY"), "2027-01-01", "2027-12-31")).toEqual([["2027-03-07", "YEARLY", null]]);
  });

  it("다음 항목, D-day, 목록 값, 정렬도 양력 날짜로", () => {
    const a = lunar(6, "2000-03-15", "YEARLY");
    expect(nextOccurrence(a, "2026-04-01")).toMatchObject({ date: "2026-05-01", type: "YEARLY" });
    expect(mainLabel(a, "2026-04-30")).toBe("D-1");
    expect(listValue(a, "2026-05-01")).toMatchObject({ value: "오늘", tone: "today" });
    const once = lunar(7, "2026-10-06", "ONCE"); // 양력 2026-11-14
    expect(nextOccurrence(once, "2026-11-01")).toMatchObject({ date: "2026-11-14", type: "ORIGINAL" });
    expect(sortByNext([a, once], "2026-11-01").map((x) => x.id)).toEqual([7, 6]);
  });

  it("폼 아래 한 줄: 올해 양력, 그날만은 양력 원래 날짜, 윤달과 30일 규칙", () => {
    expect(lunarYearHint({ date: "2000-03-15", calendar: "LUNAR", kind: "YEARLY" }, "2026-11-26")).toBe("올해는 5월 1일");
    expect(lunarYearHint({ date: "2000-12-15", calendar: "LUNAR", kind: "YEARLY" }, "2026-11-26")).toBe("올해는 2027년 1월 22일");
    expect(lunarYearHint({ date: "2026-10-06", calendar: "LUNAR", kind: "ONCE" }, "2026-11-26")).toBe("양력 2026년 11월 14일");
    expect(lunarYearHint({ date: "2025-06-15", calendar: "LUNAR", isLeapMonth: true, kind: "YEARLY" }, "2026-11-26")).toBe("올해는 7월 28일. 윤달이 없는 해에는 평달에 보여요");
    expect(lunarYearHint({ date: "2026-01-30", calendar: "LUNAR", kind: "YEARLY" }, "2027-01-01")).toBe("올해는 3월 7일. 30일이 없는 해에는 그 달 마지막 날에 보여요");
    expect(lunarYearHint({ date: "2000-03-15", kind: "YEARLY" }, "2026-11-26")).toBeNull();
  });
});

describe("음력 생일", () => {
  it("음력은 30일까지 받고 '음력 3월 15일'로 쓴다", () => {
    expect(parseBirthday("02-30", "LUNAR")).toEqual({ m: 2, d: 30 });
    expect(parseBirthday("02-30")).toBeNull();
    expect(formatBirthday("04-15", "LUNAR", true)).toBe("음력 윤4월 15일");
    expect(formatBirthday("04-15")).toBe("4월 15일");
  });

  it("기념일 모양으로 바꾸면 음력 2000년의 그 월일, 해마다 양력", () => {
    const a = birthdayToAnniversary({ member: who, date: "12-15", calendar: "LUNAR", isLeapMonth: false }, 2);
    expect(a).toMatchObject({ date: "2000-12-15", kind: "YEARLY", calendar: "LUNAR", isLeapMonth: false });
    expect(occurrencesInRange(a, "2026-01-01", "2027-12-31").map((o) => o.date)).toEqual(["2026-02-02", "2027-01-22"]);
  });
});
