import { describe, expect, it } from "vitest";
import { hasRail, layoutFromMatches, layoutOf } from "../layout";

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
