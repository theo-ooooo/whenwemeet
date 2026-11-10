import { describe, expect, it } from "vitest";
import { dateParam, monthParam, parseDayStep, stepDepth, withDayStep, withSelection } from "../calendar-url";

const TODAY = "2026-11-10";
const p = (s: string) => new URLSearchParams(s);

describe("dateParam / monthParam (#81)", () => {
  it("형식과 실제 날짜를 검사한다", () => {
    expect(dateParam("2026-11-12")).toBe("2026-11-12");
    expect(dateParam("2026-02-31")).toBeNull();
    expect(dateParam("2026-1-1")).toBeNull();
    expect(dateParam(null)).toBeNull();
    expect(monthParam("2026-12")).toEqual({ y: 2026, m: 12 });
    expect(monthParam("2026-13")).toBeNull();
  });
});

describe("parseDayStep", () => {
  it("day=1 이 없으면 닫힘", () => {
    expect(parseDayStep(p("date=2026-11-12"), TODAY)).toEqual({ open: false });
    expect(parseDayStep(p("date=2026-11-12&day=0&event=3"), TODAY)).toEqual({ open: false });
  });
  it("date 가 없으면 오늘", () => {
    expect(parseDayStep(p("day=1"), TODAY)).toEqual({ open: true, date: TODAY, step: "day" });
  });
  it("잘못된 date 는 오늘로", () => {
    expect(parseDayStep(p("date=2026-02-31&day=1"), TODAY)).toEqual({ open: true, date: TODAY, step: "day" });
  });
  it("event, add 단계", () => {
    expect(parseDayStep(p("date=2026-11-12&day=1&event=7"), TODAY)).toEqual({ open: true, date: "2026-11-12", step: "event", eventId: 7 });
    expect(parseDayStep(p("date=2026-11-12&day=1&add=1"), TODAY)).toEqual({ open: true, date: "2026-11-12", step: "add" });
  });
  it("event 가 add 보다 앞서고, 숫자가 아닌 event 는 무시", () => {
    expect(parseDayStep(p("day=1&event=7&add=1"), TODAY)).toMatchObject({ step: "event", eventId: 7 });
    expect(parseDayStep(p("day=1&event=abc"), TODAY)).toMatchObject({ step: "day" });
    expect(parseDayStep(p("day=1&event=0"), TODAY)).toMatchObject({ step: "day" });
  });
});

describe("stepDepth", () => {
  it("닫힘 0, 날짜 1, 일정/추가 2", () => {
    expect(stepDepth({ open: false })).toBe(0);
    expect(stepDepth({ open: true, date: TODAY, step: "day" })).toBe(1);
    expect(stepDepth({ open: true, date: TODAY, step: "event", eventId: 1 })).toBe(2);
    expect(stepDepth({ open: true, date: TODAY, step: "add" })).toBe(2);
  });
});

describe("withDayStep", () => {
  it("열기: date 와 day=1, 오늘이면 date 를 뗀다", () => {
    expect(withDayStep("", { step: "day", date: "2026-11-12" }, TODAY)).toBe("?date=2026-11-12&day=1");
    expect(withDayStep("?date=2026-11-12", { step: "day", date: TODAY }, TODAY)).toBe("?day=1");
  });
  it("한 단계 더: event, add 는 둘 중 하나만", () => {
    expect(withDayStep("?date=2026-11-12&day=1&add=1", { step: "event", date: "2026-11-12", eventId: 3 }, TODAY)).toBe(
      "?date=2026-11-12&day=1&event=3",
    );
    expect(withDayStep("?date=2026-11-12&day=1&event=3", { step: "add", date: "2026-11-12" }, TODAY)).toBe("?date=2026-11-12&day=1&add=1");
  });
  it("닫기: day, event, add 만 떼고 date, month 는 둔다", () => {
    expect(withDayStep("?date=2026-11-12&month=2026-12&day=1&event=3", { step: "closed" }, TODAY)).toBe("?date=2026-11-12&month=2026-12");
    expect(withDayStep("?day=1", { step: "closed" }, TODAY)).toBe("");
  });
});

describe("withSelection (#81)", () => {
  const view = { y: 2026, m: 11 };
  it("오늘 + 같은 달이면 쿼리를 비운다", () => {
    expect(withSelection("?date=2026-11-12", TODAY, TODAY, view)).toBe("");
  });
  it("다른 날, 다른 달", () => {
    expect(withSelection("", "2026-11-12", TODAY, view)).toBe("?date=2026-11-12");
    expect(withSelection("", "2026-11-12", TODAY, { y: 2026, m: 12 })).toBe("?date=2026-11-12&month=2026-12");
  });
  it("이미 맞으면 null, 날짜 상세 쿼리는 그대로 둔다", () => {
    expect(withSelection("?date=2026-11-12&day=1", "2026-11-12", TODAY, view)).toBeNull();
    expect(withSelection("?day=1&event=3", "2026-11-12", TODAY, view)).toBe("?day=1&event=3&date=2026-11-12");
  });
});
