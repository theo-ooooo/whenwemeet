import { CALENDAR_MAX_EVENTS, parseCalendarSnapshot } from "../snapshot";
import { allDay, GENERATED, timed, WEB } from "./fixture";

const parse = (events: unknown[], generatedAt: unknown = GENERATED) => parseCalendarSnapshot({ generatedAt, events }, WEB);

describe("(#549) parseCalendarSnapshot", () => {
  it("시간 일정, 종일, 반복 회차 UID 를 받고 쓰는 칸만 옮긴다", () => {
    const s = parse([
      { ...timed(1), extra: "버림", notes: "참여: 민지, 지훈\n\n메모" },
      allDay(2, "2026-11-28", "2026-11-29"),
      { ...timed(3), uid: "e3-20261201@whenwemeet.day", location: "성수 카페" },
    ]);
    expect(s).not.toBeNull();
    expect(s!.events).toHaveLength(3);
    expect(s!.events[0]).toEqual({ ...timed(1), notes: "참여: 민지, 지훈\n\n메모" });
    expect(s!.events[1]).toEqual(allDay(2, "2026-11-28", "2026-11-29"));
    expect(s!.events[2].location).toBe("성수 카페");
  });

  it("시간 일정의 순간은 ISO(Z) 로 맞춘다 (+09:00 도 받는다)", () => {
    const s = parse([timed(1, { start: "2026-11-27T19:00:00+09:00", end: "2026-11-27T20:30:00+09:00" })]);
    expect(s!.events[0]).toMatchObject({ start: "2026-11-27T10:00:00.000Z", end: "2026-11-27T11:30:00.000Z" });
  });

  it("빈 목록도 스냅샷이다 (켠 팀에 일정이 없으면 다 지운다)", () => {
    expect(parse([])).toEqual({ generatedAt: GENERATED, events: [] });
  });

  it("하나라도 틀리면 통째로 버린다", () => {
    const bad: unknown[] = [
      { ...timed(1), uid: "x1@whenwemeet.day" },
      { ...timed(1), uid: "e1@evil.com" },
      { ...timed(1), uid: "e1-2026111@whenwemeet.day" },
      { ...timed(1), title: "" },
      { ...timed(1), title: "줄\n바꿈" },
      { ...timed(1), title: "가".repeat(201) },
      { ...timed(1), notes: "탭\t없음" },
      { ...timed(1), location: 3 },
      { ...timed(1), url: "https://evil.com/events/a" },
      { ...timed(1), url: "javascript:alert(1)" },
      { ...timed(1), allDay: "no" },
      { ...timed(1), start: "2026-11-27 10:00" },
      { ...timed(1), start: "2026-11-27T10:00:00" },
      { ...timed(1), end: "2026-11-27T10:00:00.000Z" },
      { ...timed(1), end: "2026-12-30T10:00:00.000Z" },
      allDay(1, "2026-11-28", "2026-11-28"),
      allDay(1, "2026-02-30", "2026-03-01"),
      allDay(1, "2026-11-28T00:00:00Z", "2026-11-29"),
      { ...timed(1), start: "2025-09-01T00:00:00.000Z", end: "2025-09-01T01:00:00.000Z" },
      { ...timed(1), start: "2028-01-01T00:00:00.000Z", end: "2028-01-01T01:00:00.000Z" },
      null,
      [],
    ];
    for (const b of bad) expect(parse([timed(9), b])).toBeNull();
  });

  it("UID 가 겹치면 버린다", () => {
    expect(parse([timed(1), timed(1, { title: "다른 제목" })])).toBeNull();
  });

  it("generatedAt, events 모양과 개수 상한", () => {
    expect(parse([], "어제")).toBeNull();
    expect(parseCalendarSnapshot({ generatedAt: GENERATED }, WEB)).toBeNull();
    expect(parseCalendarSnapshot(null, WEB)).toBeNull();
    const many = Array.from({ length: CALENDAR_MAX_EVENTS + 1 }, (_, i) => timed(i + 1));
    expect(parse(many)).toBeNull();
    expect(parse(many.slice(0, CALENDAR_MAX_EVENTS))?.events).toHaveLength(CALENDAR_MAX_EVENTS);
  });
});
