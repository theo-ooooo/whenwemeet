import { describe, expect, it } from "vitest";
import { dayCellSelector, monthGridTarget, monthTabKey, sameDayInMonth, weekRowTarget } from "../calendar-keys";

describe("sameDayInMonth", () => {
  it("한 달 앞뒤 같은 날", () => {
    expect(sameDayInMonth("2026-11-12", 1)).toBe("2026-12-12");
    expect(sameDayInMonth("2026-11-12", -1)).toBe("2026-10-12");
  });
  it("없는 날은 말일로 (31일 → 30일)", () => {
    expect(sameDayInMonth("2026-10-31", 1)).toBe("2026-11-30");
    expect(sameDayInMonth("2026-03-31", -1)).toBe("2026-02-28");
  });
  it("윤년 2월은 29일", () => {
    expect(sameDayInMonth("2028-01-31", 1)).toBe("2028-02-29");
    expect(sameDayInMonth("2028-02-29", 12)).toBe("2029-02-28");
    expect(sameDayInMonth("2028-02-29", -48)).toBe("2024-02-29");
  });
  it("해를 넘긴다", () => {
    expect(sameDayInMonth("2026-12-15", 1)).toBe("2027-01-15");
    expect(sameDayInMonth("2027-01-15", -1)).toBe("2026-12-15");
  });
});

describe("monthGridTarget", () => {
  // 2026-11-12 은 목요일
  const from = "2026-11-12";
  it("방향키: 하루, 한 주", () => {
    expect(monthGridTarget(from, { key: "ArrowLeft" })).toBe("2026-11-11");
    expect(monthGridTarget(from, { key: "ArrowRight" })).toBe("2026-11-13");
    expect(monthGridTarget(from, { key: "ArrowUp" })).toBe("2026-11-05");
    expect(monthGridTarget(from, { key: "ArrowDown" })).toBe("2026-11-19");
  });
  it("달 경계를 넘는다", () => {
    expect(monthGridTarget("2026-11-01", { key: "ArrowLeft" })).toBe("2026-10-31");
    expect(monthGridTarget("2026-11-30", { key: "ArrowRight" })).toBe("2026-12-01");
    expect(monthGridTarget("2026-11-03", { key: "ArrowUp" })).toBe("2026-10-27");
    expect(monthGridTarget("2026-11-28", { key: "ArrowDown" })).toBe("2026-12-05");
  });
  it("해를 넘긴다", () => {
    expect(monthGridTarget("2026-12-31", { key: "ArrowRight" })).toBe("2027-01-01");
    expect(monthGridTarget("2027-01-01", { key: "ArrowLeft" })).toBe("2026-12-31");
  });
  it("Home, End: 그 주 일요일, 토요일", () => {
    expect(monthGridTarget(from, { key: "Home" })).toBe("2026-11-08");
    expect(monthGridTarget(from, { key: "End" })).toBe("2026-11-14");
    // 일요일, 토요일이면 그대로
    expect(monthGridTarget("2026-11-08", { key: "Home" })).toBe("2026-11-08");
    expect(monthGridTarget("2026-11-14", { key: "End" })).toBe("2026-11-14");
    // 주가 달을 걸치면 다른 달로
    expect(monthGridTarget("2026-11-01", { key: "End" })).toBe("2026-11-07");
    expect(monthGridTarget("2026-12-02", { key: "Home" })).toBe("2026-11-29");
  });
  it("PageUp, PageDown: 한 달, 말일 보정", () => {
    expect(monthGridTarget(from, { key: "PageUp" })).toBe("2026-10-12");
    expect(monthGridTarget(from, { key: "PageDown" })).toBe("2026-12-12");
    expect(monthGridTarget("2027-01-31", { key: "PageDown" })).toBe("2027-02-28");
    expect(monthGridTarget("2028-03-30", { key: "PageUp" })).toBe("2028-02-29");
  });
  it("Shift+PageUp, PageDown: 한 해", () => {
    expect(monthGridTarget(from, { key: "PageUp", shiftKey: true })).toBe("2025-11-12");
    expect(monthGridTarget(from, { key: "PageDown", shiftKey: true })).toBe("2027-11-12");
    expect(monthGridTarget("2028-02-29", { key: "PageDown", shiftKey: true })).toBe("2029-02-28");
  });
  it("다른 키, 수정 키와 함께면 null (브라우저, 스크린리더 단축키에 맡긴다)", () => {
    expect(monthGridTarget(from, { key: "Enter" })).toBeNull();
    expect(monthGridTarget(from, { key: "t" })).toBeNull();
    expect(monthGridTarget(from, { key: "ArrowLeft", altKey: true })).toBeNull();
    expect(monthGridTarget(from, { key: "ArrowRight", metaKey: true })).toBeNull();
    expect(monthGridTarget(from, { key: "Home", ctrlKey: true })).toBeNull();
  });
});

describe("weekRowTarget", () => {
  const from = "2026-11-12";
  it("← → 하루, Home End 그 주 처음/끝, PageUp PageDown 한 주", () => {
    expect(weekRowTarget(from, { key: "ArrowLeft" })).toBe("2026-11-11");
    expect(weekRowTarget(from, { key: "ArrowRight" })).toBe("2026-11-13");
    expect(weekRowTarget(from, { key: "Home" })).toBe("2026-11-08");
    expect(weekRowTarget(from, { key: "End" })).toBe("2026-11-14");
    expect(weekRowTarget(from, { key: "PageUp" })).toBe("2026-11-05");
    expect(weekRowTarget(from, { key: "PageDown" })).toBe("2026-11-19");
  });
  it("↑ ↓ 와 수정 키는 null", () => {
    expect(weekRowTarget(from, { key: "ArrowUp" })).toBeNull();
    expect(weekRowTarget(from, { key: "ArrowDown" })).toBeNull();
    expect(weekRowTarget(from, { key: "ArrowLeft", ctrlKey: true })).toBeNull();
  });
});

describe("monthTabKey", () => {
  it("그 달 안의 첫 후보", () => {
    expect(monthTabKey(2026, 11, ["2026-11-20", "2026-11-12"])).toBe("2026-11-20");
    expect(monthTabKey(2026, 11, [null, "2026-11-12", "2026-11-13"])).toBe("2026-11-12");
  });
  it("다른 달 후보는 건너뛴다 (선택한 날이 다른 달이면 오늘, 그것도 아니면 1일)", () => {
    expect(monthTabKey(2026, 11, ["2026-12-01", "2026-10-31", "2026-11-13"])).toBe("2026-11-13");
    expect(monthTabKey(2026, 12, [undefined, "2026-11-12", "2026-11-13"])).toBe("2026-12-01");
    expect(monthTabKey(2027, 11, ["2026-11-12"])).toBe("2027-11-01");
  });
});

describe("dayCellSelector", () => {
  it("월 칸 안 버튼과 주 보기 머리 버튼", () => {
    expect(dayCellSelector("2026-11-12")).toBe('[data-date="2026-11-12"] > button, button[data-date="2026-11-12"]');
  });
});
