import { describe, expect, it } from "vitest";
import {  dateParam, missingEventTarget, monthParam, parseDayStep, stepDepth, withDayStep, withSelection , parseRouteStep, dayStepUrl } from "../calendar-url";
import { eventHref } from "../routes";

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
  it("add 단계", () => {
    expect(parseDayStep(p("date=2026-11-12&day=1&add=1"), TODAY)).toEqual({ open: true, date: "2026-11-12", step: "add" });
  });
});

describe("stepDepth", () => {
  it("닫힘 0, 날짜 1, 일정/추가 2", () => {
    expect(stepDepth({ open: false })).toBe(0);
    expect(stepDepth({ open: true, date: TODAY, step: "day" })).toBe(1);
    expect(stepDepth({ open: true, date: TODAY, step: "event", code: "evntcode", occurrence: null })).toBe(2);
    expect(stepDepth({ open: true, date: TODAY, step: "add" })).toBe(2);
  });
});

describe("withDayStep", () => {
  it("열기: date 와 day=1, 오늘이면 date 를 뗀다", () => {
    expect(withDayStep("", { step: "day", date: "2026-11-12" }, TODAY)).toBe("?date=2026-11-12&day=1");
    expect(withDayStep("?date=2026-11-12", { step: "day", date: TODAY }, TODAY)).toBe("?day=1");
  });
  it("한 단계 더: add. 옛 주소의 event, occurrence 는 뗀다 (#311)", () => {
    expect(withDayStep("?date=2026-11-12&day=1&event=3&occurrence=2026-11-18", { step: "add", date: "2026-11-12" }, TODAY)).toBe("?date=2026-11-12&day=1&add=1");
    expect(withDayStep("?day=1&add=1", { step: "day", date: TODAY }, TODAY)).toBe("?day=1");
  });
  it("닫기: day, add 만 떼고 date, month 는 둔다", () => {
    expect(withDayStep("?date=2026-11-12&month=2026-12&day=1&add=1", { step: "closed" }, TODAY)).toBe("?date=2026-11-12&month=2026-12");
    expect(withDayStep("?day=1", { step: "closed" }, TODAY)).toBe("");
  });
  it("옛 주소의 ?event=<번호> 는 일정 단계로 보지 않는다 (옛 주소는 legacy-routes 가 바꾼다)", () => {
    expect(parseDayStep(p("day=1&event=7"), TODAY)).toEqual({ open: true, date: TODAY, step: "day" });
  });
});

describe("parseRouteStep, dayStepUrl — 일정 상세는 경로 /events/<코드> (#311)", () => {
  const dateOf = (code: string, occurrence: string | null) => (code === "evntcode" ? (occurrence ?? "2026-11-20") : null);
  it("/events/<코드> 는 일정 단계. 날짜는 호출자가 알려 주고 모르면 오늘", () => {
    expect(parseRouteStep("/events/evntcode", p(""), TODAY, dateOf)).toEqual({ open: true, date: "2026-11-20", step: "event", code: "evntcode", occurrence: null });
    expect(parseRouteStep("/events/evntcode", p("occurrence=2026-11-18"), TODAY, dateOf)).toEqual({
      open: true,
      date: "2026-11-18",
      step: "event",
      code: "evntcode",
      occurrence: "2026-11-18",
    });
    expect(parseRouteStep("/events/zzzzzzzz", p(""), TODAY, dateOf)).toMatchObject({ step: "event", code: "zzzzzzzz", date: TODAY });
    // 대문자는 소문자로
    expect(parseRouteStep("/events/EVNTCODE", p(""), TODAY, dateOf)).toMatchObject({ step: "event", code: "evntcode" });
  });
  it("/calendar, /events/new, /events/<코드>/edit 는 쿼리로만 본다", () => {
    expect(parseRouteStep("/calendar", p("day=1"), TODAY, dateOf)).toEqual({ open: true, date: TODAY, step: "day" });
    expect(parseRouteStep("/events/new", p("day=1"), TODAY, dateOf)).toEqual({ open: true, date: TODAY, step: "day" });
    expect(parseRouteStep("/events/evntcode/edit", p(""), TODAY, dateOf)).toEqual({ open: false });
  });
  it("dayStepUrl: 일정 단계는 /events/<코드>[?occurrence=], 그 밖은 /calendar + 달력 쿼리", () => {
    expect(dayStepUrl("?date=2026-11-12&day=1", { step: "event", date: "2026-11-12", code: "evntcode", occurrence: null }, TODAY)).toBe("/events/evntcode");
    expect(dayStepUrl("", { step: "event", date: "2026-11-18", code: "evntcode", occurrence: "2026-11-18" }, TODAY)).toBe("/events/evntcode?occurrence=2026-11-18");
    expect(dayStepUrl("?month=2026-12", { step: "day", date: "2026-11-12" }, TODAY)).toBe("/calendar?month=2026-12&date=2026-11-12&day=1");
    expect(dayStepUrl("?date=2026-11-12&day=1", { step: "closed" }, TODAY)).toBe("/calendar?date=2026-11-12");
    expect(dayStepUrl("", { step: "closed" }, TODAY)).toBe("/calendar");
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

describe("eventHref (#222, #311)", () => {
  it("일정 상세 주소 /events/<코드>. 반복 회차는 occurrence 를 붙이고, 주소를 다시 읽으면 같은 단계", () => {
    expect(eventHref({ publicCode: "evntcode", occurrence: null })).toBe("/events/evntcode");
    const href = eventHref({ publicCode: "evntcode", occurrence: "2026-11-19" });
    expect(href).toBe("/events/evntcode?occurrence=2026-11-19");
    const [path, search] = href.split("?");
    expect(parseRouteStep(path, new URLSearchParams(search), "2026-11-11", () => "2026-11-19")).toEqual({
      open: true,
      date: "2026-11-19",
      step: "event",
      code: "evntcode",
      occurrence: "2026-11-19",
    });
  });
});

describe("missingEventTarget — 일정 404 일 때 (QA3-L7)", () => {
  const today = "2026-11-11";
  it("회차 주소이고 원본이 살아 있으면 그 날짜 일 상세 (삭제 안내 없음)", () => {
    expect(missingEventTarget("2026-11-27", true, today)).toEqual({ href: "/calendar?date=2026-11-27&day=1", deleted: false });
    // 오늘이면 date 를 뗀다
    expect(missingEventTarget(today, true, today)).toEqual({ href: "/calendar?day=1", deleted: false });
  });

  it("원본도 없거나 회차 주소가 아니면 삭제 안내 + 달력", () => {
    expect(missingEventTarget("2026-11-27", false, today)).toEqual({ href: "/calendar", deleted: true });
    expect(missingEventTarget(null, true, today)).toEqual({ href: "/calendar", deleted: true });
    expect(missingEventTarget(undefined, false, today)).toEqual({ href: "/calendar", deleted: true });
  });
});

describe("알림을 누르면 여는 주소 (#188, 푸시-알림.md 6장, #311)", () => {
  it("API push-copy eventUrl 모양 /events/<코드>?team=&occurrence= 을 읽으면 그 회차 상세", () => {
    const url = new URL("https://whenwemeet.day/events/evntcode?team=teamcode&occurrence=2026-11-12");
    expect(parseRouteStep(url.pathname, url.searchParams, "2026-11-11", () => "2026-11-12")).toEqual({
      open: true,
      date: "2026-11-12",
      step: "event",
      code: "evntcode",
      occurrence: "2026-11-12",
    });
  });
});
