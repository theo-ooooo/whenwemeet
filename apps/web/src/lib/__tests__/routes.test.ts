// (#311) 주소 규칙
import { describe, expect, it } from "vitest";
import {
  activeTab,
  afterTeamSwitch,
  calendarHref,
  eventCopyHref,
  eventEditHref,
  eventHref,
  newEventHref,
  parsePublicCode,
  routeInfo,
  stripTeam,
  teamHref,
  withTeam,
} from "../routes";

describe("parsePublicCode", () => {
  it("소문자 영숫자 8자만. 대문자와 공백은 맞춰 받고, 그 밖은 null", () => {
    expect(parsePublicCode("k3x9ab12")).toBe("k3x9ab12");
    expect(parsePublicCode(" K3X9AB12 ")).toBe("k3x9ab12");
    for (const bad of ["", "short", "k3x9ab123", "k3x9-b12", "12", ["k3x9ab12"], null, undefined]) expect(parsePublicCode(bad)).toBeNull();
  });
});

describe("주소 만들기", () => {
  it("화면 주소", () => {
    expect(teamHref()).toBe("/team");
    expect(teamHref({ invite: true })).toBe("/team?invite=1");
    expect(calendarHref()).toBe("/calendar");
    expect(calendarHref({ date: "2026-11-12", month: null })).toBe("/calendar?date=2026-11-12");
    expect(eventHref({ publicCode: "evntcode" })).toBe("/events/evntcode");
    expect(eventHref({ publicCode: "evntcode", occurrence: "2026-11-18" })).toBe("/events/evntcode?occurrence=2026-11-18");
    expect(eventEditHref({ publicCode: "evntcode" })).toBe("/events/evntcode/edit");
    expect(eventCopyHref({ publicCode: "evntcode" })).toBe("/events/new?copy=evntcode");
    expect(newEventHref({ start: "2026-11-12T01:00:00.000Z", end: "2026-11-12T02:00:00.000Z" })).toBe(
      "/events/new?start=2026-11-12T01%3A00%3A00.000Z&end=2026-11-12T02%3A00%3A00.000Z",
    );
    const q = new URLSearchParams({ title: "점심", allDay: "1" });
    expect(newEventHref(q)).toBe("/events/new?title=%EC%A0%90%EC%8B%AC&allDay=1");
  });
  it("withTeam 은 ?team= 을 붙이거나 바꾸고 해시를 지킨다, stripTeam 은 뗀다", () => {
    expect(withTeam("/calendar", "teamcode")).toBe("/calendar?team=teamcode");
    expect(withTeam("/calendar?date=2026-11-12#top", "teamcode")).toBe("/calendar?date=2026-11-12&team=teamcode#top");
    expect(withTeam("/news?team=old12345", "teamcode")).toBe("/news?team=teamcode");
    expect(stripTeam("?team=teamcode")).toBe("");
    expect(stripTeam("?date=2026-11-12&team=teamcode&day=1")).toBe("?date=2026-11-12&day=1");
    expect(stripTeam("date=2026-11-12")).toBe("?date=2026-11-12");
  });
});

describe("routeInfo, activeTab, afterTeamSwitch", () => {
  it("화면과 일정 코드, 작성 화면 여부", () => {
    expect(routeInfo("/calendar")).toEqual({ screen: "calendar", eventCode: null, form: false, eventDetail: false });
    expect(routeInfo("/team/import")).toEqual({ screen: "team", eventCode: null, form: true, eventDetail: false });
    expect(routeInfo("/events/new")).toEqual({ screen: "events", eventCode: null, form: true, eventDetail: false });
    expect(routeInfo("/events/evntcode")).toEqual({ screen: "events", eventCode: "evntcode", form: false, eventDetail: true });
    expect(routeInfo("/events/evntcode/edit")).toEqual({ screen: "events", eventCode: "evntcode", form: true, eventDetail: false });
    expect(routeInfo("/events/evntcode/x")).toEqual({ screen: "events", eventCode: "evntcode", form: false, eventDetail: false });
    expect(routeInfo("/events/bad")).toEqual({ screen: "events", eventCode: null, form: false, eventDetail: false });
    expect(routeInfo("/me")).toEqual({ screen: null, eventCode: null, form: false, eventDetail: false });
  });
  it("켤 메뉴: 일정 화면과 다가오는 일정은 달력 쪽", () => {
    expect(activeTab("/events/evntcode")).toBe("calendar");
    expect(activeTab("/events/new")).toBe("calendar");
    expect(activeTab("/upcoming")).toBe("upcoming");
    expect(activeTab("/team/import")).toBe("team");
    expect(activeTab("/news")).toBe("news");
    expect(activeTab("/groups/new")).toBeNull();
  });
  it("팀을 바꾼 뒤: 같은 화면은 그대로(null), 일정 주소는 달력으로", () => {
    expect(afterTeamSwitch("/calendar?date=2026-11-12")).toBeNull();
    expect(afterTeamSwitch("/free")).toBeNull();
    expect(afterTeamSwitch("/team/import")).toBeNull();
    expect(afterTeamSwitch("/events/new")).toBeNull();
    expect(afterTeamSwitch("/events/evntcode")).toBe("/calendar");
    expect(afterTeamSwitch("/events/evntcode/edit")).toBe("/calendar");
    expect(afterTeamSwitch("/unknown")).toBe("/calendar");
  });
});
