// @vitest-environment happy-dom
// (#278) 시작 안내 상태 (이 기기 localStorage `wwm.start.<팀 id>`): 저장, 단계 끝내기, 다 끝나면 삭제, 닫기, 저장소 막힘
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearStart, finishStep, formatStartValue, parseStartValue, saveStart } from "../start-guide";

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("저장 값", () => {
  it("쓰임만, 또는 쓰임:끝낸 단계", () => {
    expect(parseStartValue("two")).toEqual({ preset: "two", done: [] });
    expect(parseStartValue("study:first,week")).toEqual({ preset: "study", done: ["first", "week"] });
    expect(formatStartValue({ preset: "family", done: [] })).toBe("family");
    expect(formatStartValue({ preset: "family", done: ["birthday"] })).toBe("family:birthday");
  });

  it("모르는 쓰임은 null, 모르는 단계와 중복은 버린다", () => {
    expect(parseStartValue(null)).toBeNull();
    expect(parseStartValue("")).toBeNull();
    expect(parseStartValue("couple")).toBeNull();
    expect(parseStartValue("two:first,nope,first")).toEqual({ preset: "two", done: ["first"] });
  });
});

describe("저장과 삭제", () => {
  it("팀을 만들면 저장, 단계를 끝내면 쌓이고 다 끝나면 지운다", () => {
    saveStart(7, "two");
    expect(localStorage.getItem("wwm.start.7")).toBe("two");
    finishStep(7, "first");
    finishStep(7, "first");
    expect(localStorage.getItem("wwm.start.7")).toBe("two:first");
    finishStep(7, "todos");
    finishStep(7, "feed");
    expect(localStorage.getItem("wwm.start.7")).toBeNull();
  });

  it("안내가 없는 팀(다른 기기에서 만든 팀, 기존 팀)은 아무것도 남기지 않는다", () => {
    finishStep(8, "first");
    expect(localStorage.getItem("wwm.start.8")).toBeNull();
  });

  it("닫으면 지운다. 다른 팀 안내는 그대로", () => {
    saveStart(1, "family");
    saveStart(2, "study");
    clearStart(1);
    expect(localStorage.getItem("wwm.start.1")).toBeNull();
    expect(localStorage.getItem("wwm.start.2")).toBe("study");
  });

  it("저장소가 막혀도 던지지 않는다", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => saveStart(3, "two")).not.toThrow();
    expect(() => finishStep(3, "first")).not.toThrow();
  });
});
