import { describe, expect, it } from "vitest";
import {
  dayNumber,
  listValue,
  mainLabel,
  nearestOccurrence,
  nextOccurrence,
  occurrenceCellText,
  occurrencesByDay,
  occurrencesInRange,
  occurrenceTitle,
  sameDayInYear,
  sortByNext,
  upcomingOccurrences,
  type Occurrence,
} from "../anniversary";
import { addDays } from "../date";
import type { Anniversary, AnniversaryKind, Member } from "../types";

const who: Member = { userId: 1, displayName: "지우", color: "#5B6CF4", profileImageUrl: null };
const ann = (id: number, date: string, kind: AnniversaryKind, name = `기념${id}`): Anniversary => ({
  id,
  groupId: 2,
  name,
  date,
  kind,
  creator: who,
  createdAt: date,
});
const brief = (os: Occurrence[]) => os.map((o) => `${o.date} ${o.label ?? o.type}`);
/** 특정 날의 항목 (그 날 하루 범위) */
const on = (a: Anniversary, key: string) => brief(occurrencesInRange(a, key, key));

const TODAY = "2026-11-10";

// 기획 3-5 예시 표 (오늘 = 2026-11-10)
describe("기획 3-5 예시", () => {
  it("2025-01-01 처음 만난 날 (COUNT_UP)", () => {
    const a = ann(1, "2025-01-01", "COUNT_UP", "처음 만난 날");
    expect(on(a, "2025-04-10")).toEqual(["2025-04-10 100일"]);
    expect(on(a, "2025-07-19")).toEqual(["2025-07-19 200일"]);
    expect(on(a, "2025-10-27")).toEqual(["2025-10-27 300일"]);
    expect(on(a, "2026-01-01")).toEqual(["2026-01-01 1주년"]);
    expect(on(a, "2027-09-27")).toEqual(["2027-09-27 1000일"]);
    expect(on(a, "2030-06-23")).toEqual(["2030-06-23 2000일"]);
    expect(mainLabel(a, TODAY)).toBe("679일");
    // 2주년 2027-01-01 D-52 는 표에 적힌 값. 다만 규칙(3-3, 오늘 이후 가장 가까운 1개)대로면 그보다 앞선 700일(2026-12-01) 이 다음이다
    expect(on(a, "2027-01-01")).toEqual(["2027-01-01 2주년"]);
    const next = nextOccurrence(a, TODAY)!;
    expect([next.date, next.label]).toEqual(["2026-12-01", "700일"]);
    const nextYears = occurrencesInRange(a, TODAY, addDays(TODAY, 366)).find((o) => o.type === "YEARS")!;
    expect([nextYears.date, nextYears.label]).toEqual(["2027-01-01", "2주년"]);
  });

  it("2026-08-03 (COUNT_UP): 오늘이 100일", () => {
    const a = ann(2, "2026-08-03", "COUNT_UP", "사귄 날");
    expect(on(a, TODAY)).toEqual([`${TODAY} 100일`]);
    expect(mainLabel(a, TODAY)).toBe("100일");
    expect(nextOccurrence(a, TODAY)?.label).toBe("100일");
    expect(brief(upcomingOccurrences([a], TODAY))[0]).toBe(`${TODAY} 100일`);
    expect(nearestOccurrence([a], TODAY)?.date).toBe(TODAY);
  });

  it("2026-12-24 (COUNT_UP, 미래)", () => {
    const a = ann(3, "2026-12-24", "COUNT_UP");
    expect(mainLabel(a, TODAY)).toBe("D-44");
    expect(on(a, "2027-04-02")).toEqual(["2027-04-02 100일"]);
    expect(nextOccurrence(a, TODAY)?.type).toBe("ORIGINAL");
  });

  it("2024-02-29 (COUNT_UP)", () => {
    const a = ann(4, "2024-02-29", "COUNT_UP");
    expect(on(a, "2024-06-07")).toEqual(["2024-06-07 100일"]);
    expect(on(a, "2025-02-28")).toEqual(["2025-02-28 1주년"]);
    expect(on(a, "2028-02-29")).toEqual(["2028-02-29 4주년"]);
    expect(on(a, "2028-02-28")).toEqual([]);
  });

  it("1996-02-29 생일 (YEARLY)", () => {
    const a = ann(5, "1996-02-29", "YEARLY", "생일");
    expect(brief(occurrencesInRange(a, "2026-01-01", "2028-12-31"))).toEqual(["2026-02-28 YEARLY", "2027-02-28 YEARLY", "2028-02-29 YEARLY"]);
  });

  it("2000-05-05 생일 (YEARLY): 매년, 100일 단위 없음", () => {
    const a = ann(6, "2000-05-05", "YEARLY", "생일");
    expect(brief(occurrencesInRange(a, "2000-01-01", "2002-12-31"))).toEqual(["2000-05-05 ORIGINAL", "2001-05-05 YEARLY", "2002-05-05 YEARLY"]);
    // 100일(2000-08-12) 에는 아무것도 없다
    expect(on(a, "2000-08-12")).toEqual([]);
    expect(mainLabel(a, TODAY)).toBe("D-176");
    expect(nextOccurrence(a, TODAY)?.date).toBe("2027-05-05");
  });

  it("2026-11-20 시험 (ONCE)", () => {
    const a = ann(7, "2026-11-20", "ONCE", "시험");
    expect(brief(occurrencesInRange(a, "2026-01-01", "2030-12-31"))).toEqual(["2026-11-20 ORIGINAL"]);
    expect(mainLabel(a, TODAY)).toBe("D-10");
    expect(mainLabel(a, "2026-11-20")).toBe("D-day");
    expect(mainLabel(a, "2026-11-25")).toBe("D+5");
    expect(nextOccurrence(a, "2026-11-25")).toBeNull();
  });
});

describe("날짜 세기", () => {
  it("시작일이 1일", () => {
    expect(dayNumber("2026-11-10", "2026-11-10")).toBe(1);
    expect(dayNumber("2026-11-10", "2027-02-17")).toBe(100);
  });

  it("상한: 30000일, 100주년", () => {
    const a = ann(1, "1950-01-01", "COUNT_UP");
    const all = occurrencesInRange(a, "1950-01-01", "2060-12-31");
    expect(all.filter((o) => o.type === "DAYS").at(-1)?.n).toBe(30000);
    expect(all.filter((o) => o.type === "DAYS")).toHaveLength(39);
    expect(all.filter((o) => o.type === "YEARS").at(-1)?.label).toBe("100주년");
    // 2050 년 = 100주년, 2051 년 = 없음
    expect(on(a, "2051-01-01")).toEqual([]);
    // 30000일 이후, 100주년 이후는 다음이 없다
    expect(nextOccurrence(a, "2060-01-01")).toBeNull();
    expect(mainLabel(a, "1950-01-10")).toBe("10일");
  });

  it("1000일 이후는 1000 간격 (1100일은 없다)", () => {
    const a = ann(1, "2020-01-01", "COUNT_UP");
    const days = occurrencesInRange(a, "2020-01-01", "2026-12-31")
      .filter((o) => o.type === "DAYS")
      .map((o) => o.n);
    expect(days).toEqual([100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 2000]);
  });

  it("2/29 는 평년에 2/28, 그 밖의 날은 그대로", () => {
    expect(sameDayInYear("2024-02-29", 2025)).toBe("2025-02-28");
    expect(sameDayInYear("2024-02-29", 2100)).toBe("2100-02-28");
    expect(sameDayInYear("2024-02-29", 2000)).toBe("2000-02-29");
    expect(sameDayInYear("2024-12-31", 2025)).toBe("2025-12-31");
  });

  it("연도 경계: 12/31 시작, 범위가 해를 넘는다", () => {
    const a = ann(1, "2025-12-31", "COUNT_UP");
    expect(brief(occurrencesInRange(a, "2026-12-20", "2027-01-10"))).toEqual(["2026-12-31 1주년"]);
    const y = ann(2, "2010-01-01", "YEARLY");
    expect(brief(occurrencesInRange(y, "2026-12-20", "2027-01-10"))).toEqual(["2027-01-01 YEARLY"]);
    expect(mainLabel(y, "2026-12-31")).toBe("D-1");
    expect(mainLabel(y, "2027-01-01")).toBe("D-day");
  });

  it("미래 시작일은 이전에 아무것도 없고 대표 라벨은 D-n", () => {
    const a = ann(1, "2027-01-01", "YEARLY");
    expect(occurrencesInRange(a, "2026-01-01", "2026-12-31")).toEqual([]);
    expect(mainLabel(a, TODAY)).toBe("D-52");
    expect(mainLabel(ann(2, TODAY, "COUNT_UP"), TODAY)).toBe("1일");
    expect(mainLabel(ann(3, TODAY, "YEARLY"), TODAY)).toBe("D-day");
  });

  it("빈 범위", () => {
    expect(occurrencesInRange(ann(1, "2025-01-01", "COUNT_UP"), "2026-02-01", "2026-01-01")).toEqual([]);
  });

  it("kind 가 없으면 COUNT_UP", () => {
    const a = { ...ann(1, "2026-08-03", "COUNT_UP"), kind: undefined as unknown as AnniversaryKind };
    expect(mainLabel(a, TODAY)).toBe("100일");
  });
});

describe("표시 우선순위와 개수", () => {
  // 오늘(2026-11-10) 세 기념일이 겹친다
  const years = ann(3, "2025-11-10", "COUNT_UP", "결혼"); // 오늘 1주년
  const days = ann(1, "2026-08-03", "COUNT_UP", "사귄 날"); // 오늘 100일
  const yearly = ann(2, "1990-11-10", "YEARLY", "엄마 생일"); // 오늘 매년

  it("칸: N주년 > N일 > 매년, 같으면 id 순", () => {
    const map = occurrencesByDay([yearly, days, years], "2026-11-01", "2026-11-30");
    const today = map.get(TODAY)!;
    expect(today.map((o) => occurrenceCellText(o))).toEqual(["1주년", "100일", "엄마 생일"]);
    expect(today.map((o) => occurrenceTitle(o))).toEqual(["결혼 1주년", "사귄 날 100일", "엄마 생일"]);
    const two = occurrencesByDay([ann(9, "2026-11-10", "ONCE", "b"), ann(4, "2000-11-10", "YEARLY", "a")], TODAY, TODAY);
    expect(two.get(TODAY)!.map((o) => o.anniversary.id)).toEqual([4, 9]);
  });

  it("다가오는 일정: 30일 안 최대 2개, 날짜순", () => {
    const later = ann(5, "2026-11-25", "ONCE", "여행"); // D-15
    const far = ann(6, "2026-12-11", "ONCE", "멀리"); // D-31: 범위 밖
    expect(brief(upcomingOccurrences([far, later, days, years], TODAY))).toEqual([`${TODAY} 1주년`, `${TODAY} 100일`]);
    expect(brief(upcomingOccurrences([far, later], TODAY))).toEqual(["2026-11-25 ORIGINAL"]);
    expect(upcomingOccurrences(null, TODAY)).toEqual([]);
  });

  it("D-day 타일: 가장 가까운 다음 항목, 없으면 null", () => {
    expect(nearestOccurrence([ann(7, "2026-11-20", "ONCE"), ann(8, "2025-01-01", "COUNT_UP")], TODAY)?.date).toBe("2026-11-20");
    expect(nearestOccurrence([ann(7, "2026-11-01", "ONCE")], TODAY)).toBeNull();
    expect(nearestOccurrence([], TODAY)).toBeNull();
  });

  it("기념일 화면 정렬: 다음 항목 날짜순, 지난 ONCE 는 맨 아래", () => {
    const list = [
      ann(1, "2025-01-01", "COUNT_UP"), // 다음 2026-12-01
      ann(2, "2026-11-01", "ONCE"), // 다음 없음
      ann(3, "2000-05-05", "YEARLY"), // 다음 2027-05-05
      ann(4, "2026-11-20", "ONCE"), // 다음 2026-11-20
    ];
    expect(sortByNext(list, TODAY).map((a) => a.id)).toEqual([4, 1, 3, 2]);
  });
});

// 기념일 목록 오른쪽 값 통일 (#173): 큰 값은 모두 '다음 날까지', 누적은 보조 줄
describe("listValue", () => {
  it("함께한 날 세기: 오늘이 100일이면 값 '오늘', 보조 '오늘 100일'", () => {
    const a = ann(1, addDays(TODAY, -99), "COUNT_UP");
    expect(listValue(a, TODAY)).toEqual({ value: "오늘", tone: "today", sub: "오늘 100일" });
  });
  it("함께한 날 세기: 다가오는 3주년이 큰 값, 누적 일수는 보조 줄", () => {
    const a = ann(3, "2023-11-15", "COUNT_UP");
    expect(listValue(a, TODAY)).toEqual({ value: "D-5", tone: "ahead", sub: "1092일째, 다음 3주년 11월 15일" });
  });
  it("함께한 날 세기: 시작일 전이면 D-n, 보조 줄 없음", () => {
    expect(listValue(ann(4, "2026-11-20", "COUNT_UP"), TODAY)).toEqual({ value: "D-10", tone: "ahead", sub: null });
  });
  it("매년 반복과 그날만은 다음 날까지만", () => {
    expect(listValue(ann(5, "1997-11-13", "YEARLY"), TODAY)).toEqual({ value: "D-3", tone: "ahead", sub: null });
    expect(listValue(ann(6, "2026-11-22", "ONCE"), TODAY)).toEqual({ value: "D-12", tone: "ahead", sub: null });
    expect(listValue(ann(7, TODAY, "ONCE"), TODAY)).toEqual({ value: "오늘", tone: "today", sub: null });
  });
  it("지난 그날만은 D+n 흐린 값", () => {
    expect(listValue(ann(8, "2026-10-01", "ONCE"), TODAY)).toEqual({ value: "D+40", tone: "past", sub: null });
  });
});
