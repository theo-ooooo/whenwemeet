// (#311) 옛 /g/<id>/... → 새 주소
import { describe, expect, it } from "vitest";
import { legacyRoute, legacyTarget } from "../legacy-routes";

const q = (s: string) => new URLSearchParams(s);
const go = (rest: string[], search: string, eventCode: string | null = null) => {
  const route = legacyRoute(rest, q(search));
  return route === null ? null : legacyTarget(route, "teamcode", eventCode);
};

describe("legacyRoute → legacyTarget", () => {
  it("화면 주소는 이름만 바뀌고 ?team= 이 붙는다", () => {
    expect(go([], "")).toBe("/calendar?team=teamcode");
    expect(go(["calendar"], "date=2026-11-12&month=2026-12&day=1&x=1")).toBe("/calendar?date=2026-11-12&month=2026-12&day=1&team=teamcode");
    expect(go(["calendar"], "day=1&add=1")).toBe("/calendar?day=1&add=1&team=teamcode");
    for (const s of ["upcoming", "free", "anniversaries", "news"]) expect(go([s], "")).toBe(`/${s}?team=teamcode`);
    expect(go(["settings"], "invite=1")).toBe("/team?invite=1&team=teamcode");
    expect(go(["settings"], "")).toBe("/team?team=teamcode");
    expect(go(["import"], "")).toBe("/team/import?team=teamcode");
  });

  it("옛 알림 주소 ?day=1&event=<번호> 는 일정 상세 /events/<코드> (코드는 페이지가 찾는다)", () => {
    const route = legacyRoute(["calendar"], q("date=2026-11-14&day=1&event=15"));
    expect(route?.eventRef).toEqual({ as: "detail", eventId: 15, occurrence: null });
    expect(legacyTarget(route!, "teamcode", "evntcode")).toBe("/events/evntcode?team=teamcode");
    const series = legacyRoute(["calendar"], q("date=2026-11-18&day=1&event=200&occurrence=2026-11-18"));
    expect(legacyTarget(series!, "teamcode", "srescode")).toBe("/events/srescode?occurrence=2026-11-18&team=teamcode");
    // 일정이 지워졌으면 그날 날짜 상세, 회차를 모르면 달력
    expect(legacyTarget(series!, "teamcode", null)).toBe("/calendar?date=2026-11-18&day=1&team=teamcode");
    expect(legacyTarget(route!, "teamcode", null)).toBe("/calendar?team=teamcode");
    // day=1 이 없거나 번호가 아니면 일정으로 보지 않는다
    expect(go(["calendar"], "event=15")).toBe("/calendar?team=teamcode");
    expect(go(["calendar"], "day=1&event=abc")).toBe("/calendar?day=1&team=teamcode");
  });

  it("일정 작성, 수정, 복제", () => {
    expect(go(["events", "new"], "start=2026-11-12T01%3A00%3A00.000Z&end=2026-11-12T02%3A00%3A00.000Z&title=%EC%A0%90%EC%8B%AC&allDay=1&reminder=HOUR_1&junk=1")).toBe(
      "/events/new?start=2026-11-12T01%3A00%3A00.000Z&end=2026-11-12T02%3A00%3A00.000Z&title=%EC%A0%90%EC%8B%AC&allDay=1&reminder=HOUR_1&team=teamcode",
    );
    const copy = legacyRoute(["events", "new"], q("copy=5&occurrence=2026-11-18"));
    expect(copy?.eventRef).toEqual({ as: "copy", eventId: 5 });
    expect(legacyTarget(copy!, "teamcode", "evntcode")).toBe("/events/new?occurrence=2026-11-18&copy=evntcode&team=teamcode");
    expect(legacyTarget(copy!, "teamcode", null)).toBe("/events/new?occurrence=2026-11-18&team=teamcode");
    const edit = legacyRoute(["events", "345"], q("occurrence=2026-11-18&scope=this"));
    expect(edit?.eventRef).toEqual({ as: "edit", eventId: 345 });
    expect(legacyTarget(edit!, "teamcode", "evntcode")).toBe("/events/evntcode/edit?occurrence=2026-11-18&scope=this&team=teamcode");
    expect(legacyTarget(edit!, "teamcode", null)).toBe("/calendar?team=teamcode");
  });

  it("모르는 하위 경로는 null (404)", () => {
    for (const rest of [["events"], ["events", "abc"], ["events", "5", "x"], ["calendar", "x"], ["foo"], ["settings", "x"]]) expect(legacyRoute(rest, q(""))).toBeNull();
  });
});
