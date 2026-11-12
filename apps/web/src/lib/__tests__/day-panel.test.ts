import { describe, expect, it } from "vitest";
import { panelDays, panelMove, panelTitle, PANEL_W } from "../day-panel";
import { MAIN_PANEL, MAIN_NARROW, mainWidthOf } from "../layout";

describe("(#331) panelTitle", () => {
  it("'11월 14일 토요일'", () => {
    expect(panelTitle("2026-11-14")).toBe("11월 14일 토요일");
    expect(panelTitle("2027-01-03")).toBe("1월 3일 일요일");
  });
});

describe("(#331) panelDays: ‹ 13 [14] 15 ›", () => {
  it("전날, 그날, 다음 날", () => {
    expect(panelDays("2026-11-14")).toEqual(["2026-11-13", "2026-11-14", "2026-11-15"]);
  });
  it("달과 해를 넘어간다", () => {
    expect(panelDays("2026-12-31")).toEqual(["2026-12-30", "2026-12-31", "2027-01-01"]);
    expect(panelDays("2026-03-01")).toEqual(["2026-02-28", "2026-03-01", "2026-03-02"]);
  });
});

describe("(#331) panelMove: 열린 패널에서 다른 날을 고를 때 기록 다루기", () => {
  it("닫혀 있으면 연다(한 칸 쌓기)", () => {
    expect(panelMove({ open: false }, 0)).toBe("open");
  });
  it("날짜 단계면 날짜만 바꾼다(기록 그대로)", () => {
    expect(panelMove({ open: true, step: "day", date: "2026-11-14" }, 1)).toBe("replace");
    // 새로 고침으로 들어온 날짜 단계도 같다
    expect(panelMove({ open: true, step: "day", date: "2026-11-14" }, 0)).toBe("replace");
  });
  it("우리가 쌓은 일정 상세, 빠른 추가 위면 한 칸 되돌린 뒤 바꾼다", () => {
    expect(panelMove({ open: true, step: "event", date: "2026-11-14", code: "abcd1234", occurrence: null }, 2)).toBe("back");
    expect(panelMove({ open: true, step: "event", date: "2026-11-14", code: "abcd1234", occurrence: null }, 1)).toBe("back");
    expect(panelMove({ open: true, step: "add", date: "2026-11-14" }, 1)).toBe("back");
  });
  it("새로 고침, 공유 주소로 들어온 일정 상세(되돌릴 칸 없음)는 주소를 바꿔 쓴다", () => {
    expect(panelMove({ open: true, step: "event", date: "2026-11-14", code: "abcd1234", occurrence: null }, 0)).toBe("rewrite");
  });
});

describe("(#331) 패널과 시트 경계", () => {
  it("본문 760 이상이면 패널을 붙이고, 남은 달력 칸(간격 12)이 좁은 제목줄 경계 근처 이상", () => {
    expect(MAIN_PANEL - PANEL_W - 12).toBeGreaterThanOrEqual(340);
    expect(MAIN_PANEL - PANEL_W - 12).toBeLessThan(MAIN_NARROW);
  });
  it.each([
    // [뷰포트, 사이드바, 패널?]
    [600, 72, false],
    [669, 72, false],
    [800, 72, false],
    [895, 72, false],
    [896, 72, true],
    [1024, 264, false],
    [1024, 72, true],
    [1087, 264, false],
    [1088, 264, true],
    [1280, 264, true],
    [1440, 264, true],
  ] as const)("뷰포트 %i, 사이드바 %i → 패널 %s", (w, side, docked) => {
    expect(mainWidthOf(w, side) >= MAIN_PANEL).toBe(docked);
  });
});
