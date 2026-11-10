import { describe, expect, it } from "vitest";
import { layoutFromMatches, layoutOf, mainWidthOf } from "../layout";

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

describe("layoutFromMatches", () => {
  it("pc 가 fold 보다 앞선다", () => {
    expect(layoutFromMatches(true, true)).toBe("pc");
    expect(layoutFromMatches(true, false)).toBe("fold");
    expect(layoutFromMatches(false, false)).toBe("phone");
  });
});

describe("mainWidthOf (#212: 사이드바 264 + 바깥 여백 32 양쪽)", () => {
  it.each([
    [600, 272],
    [884, 556],
    [984, 656],
    [1180, 852],
    [1440, 1112],
  ] as const)("%i → %i", (w, want) => {
    expect(mainWidthOf(w)).toBe(want);
  });
  it("가장 좁은 넓은 화면(600)에서도 요약 카드 3열이 칸마다 80px 을 넘는다 (간격 12 두 번)", () => {
    expect((mainWidthOf(600) - 24) / 3).toBeGreaterThan(80);
  });
});
