import { describe, expect, it } from "vitest";
import { hasRail, hasSplit, layoutFromMatches, layoutOf, calendarWidthOf, overviewWidthOf, SPLIT_MIN } from "../layout";

describe("layoutOf (폴더블.md 3장 경계)", () => {
  it.each([
    [360, "phone"],
    [412, "phone"],
    [599, "phone"],
    [600, "fold"],
    [890, "fold"],
    [984, "fold"],
    [1023, "fold"],
    [1024, "pc"],
    [1092, "pc"],
    [1440, "pc"],
  ] as const)("%i → %s", (w, want) => {
    expect(layoutOf(w)).toBe(want);
  });
});

describe("hasRail (600~1199 레일, 1200 부터 사이드바)", () => {
  it.each([
    [599, false],
    [600, true],
    [1100, true],
    [1199, true],
    [1200, false],
    [1440, false],
  ] as const)("%i → %s", (w, want) => {
    expect(hasRail(w)).toBe(want);
  });
});

describe("layoutFromMatches", () => {
  it("pc 가 fold 보다 앞선다", () => {
    expect(layoutFromMatches(true, true)).toBe("pc");
    expect(layoutFromMatches(true, false)).toBe("fold");
    expect(layoutFromMatches(false, false)).toBe("phone");
  });
});

describe("hasSplit (#128: 개요 칸은 860 부터 달력 옆)", () => {
  it.each([
    [599, false],
    [600, false],
    [673, false],
    [759, false],
    [859, false],
    [860, true],
    [890, true],
    [984, true],
  ] as const)("%i → %s", (w, want) => {
    expect(hasSplit(w)).toBe(want);
  });
});

describe("calendarWidthOf (#128: 레일 폭에서 달력이 개요 칸보다 좁아지지 않는다)", () => {
  it("600~859 는 1단이라 레일과 여백만 뺀다", () => {
    expect(calendarWidthOf(600)).toBe(504);
    expect(calendarWidthOf(673)).toBe(577);
  });
  it("2단인 폭에서는 달력이 개요 칸보다 넓다", () => {
    for (let w = SPLIT_MIN; w < 1200; w++) {
      expect(calendarWidthOf(w)).toBeGreaterThan(overviewWidthOf(w));
    }
  });
  it("레일 폭 전 구간에서 달력 타일은 480px 이상 (칸 하나 약 68px, 제목 서너 글자)", () => {
    for (let w = 600; w < 1200; w++) {
      expect(calendarWidthOf(w)).toBeGreaterThanOrEqual(480);
    }
  });
});
