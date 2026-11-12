import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { layoutFromMatches, layoutOf, MAIN_2XL, MAIN_LG, MAIN_NARROW, MAIN_PANEL, MAIN_XL, mainWidthOf } from "../layout";

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
  it("(#315) 72 레일로 접으면 본문이 192 넓다", () => {
    expect(mainWidthOf(600, 72)).toBe(464);
    expect(mainWidthOf(1024, 72) - mainWidthOf(1024)).toBe(192);
  });
});

describe("(#323) 본문 폭 구간", () => {
  it("펼친 사이드바에서 예전 뷰포트 경계와 같은 본문 폭", () => {
    expect([MAIN_NARROW, MAIN_LG, MAIN_XL, MAIN_2XL]).toEqual([384, 696, 952, 1208]);
  });

  it("globals.css main-* 변형이 같은 값을 px 로 쓴다", () => {
    const css = readFileSync(fileURLToPath(new URL("../../app/globals.css", import.meta.url)), "utf8");
    const px = (name: string) => {
      const m = css.match(new RegExp(`@custom-variant ${name} \\(@container main \\(width (?:>=|<) (\\d+)px\\)\\)`));
      return m ? Number(m[1]) : null;
    };
    expect(px("main-narrow")).toBe(MAIN_NARROW);
    expect(px("main-roomy")).toBe(MAIN_NARROW);
    expect(px("main-lg")).toBe(MAIN_LG);
    expect(px("main-xl")).toBe(MAIN_XL);
    expect(px("main-2xl")).toBe(MAIN_2XL);
    // (#331) 일 상세 패널 / 덮는 시트
    expect(px("main-panel")).toBe(MAIN_PANEL);
    expect(px("main-sheet")).toBe(MAIN_PANEL);
  });

  // 사용자 보고(#323): 접힌 레일 + 600 대에서 빈 시간 결과 칸이 화면 밖으로 넘쳤다.
  // 2단은 본문이 MAIN_LG 이상일 때만 켜져 오른쪽 칸(본문 - 왼쪽 400 - 간격 20)이 최소 276 을 넘는다
  it.each([
    [600, 72],
    [669, 72],
    [800, 72],
    [800, 264],
    [1023, 264],
    [1024, 264],
    [1024, 72],
    [1280, 264],
    [1440, 72],
  ] as const)("뷰포트 %i, 사이드바 %i: 2단이면 오른쪽 칸이 넉넉하다", (w, side) => {
    const main = mainWidthOf(w, side);
    const left = main >= MAIN_XL ? 400 : 340;
    if (main >= MAIN_LG) expect(main - left - 20).toBeGreaterThanOrEqual(276);
    else expect(main).toBeLessThan(MAIN_LG);
  });
});
