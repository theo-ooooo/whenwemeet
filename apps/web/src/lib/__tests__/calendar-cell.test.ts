import { describe, expect, it } from "vitest";
import { cellDensity } from "../calendar-cell";

const by = (...colors: string[]) => colors.map((color) => ({ creator: { color } }));

describe("cellDensity — 폰 달력 칸 바쁜 정도 (#139)", () => {
  it("일정이 없으면 점도 없다", () => {
    expect(cellDensity([])).toEqual({ dots: [], more: 0 });
  });

  it("일정 하나에 점 하나, 같은 사람이어도 개수만큼", () => {
    expect(cellDensity(by("#A", "#A"))).toEqual({ dots: ["#A", "#A"], more: 0 });
  });

  it("3개까지는 점만", () => {
    expect(cellDensity(by("#A", "#B", "#C"))).toEqual({ dots: ["#A", "#B", "#C"], more: 0 });
  });

  it("넘치면 +N (7개 = 점 3 + 4)", () => {
    expect(cellDensity(by("#A", "#A", "#A", "#A", "#A", "#A", "#A"))).toEqual({ dots: ["#A", "#A", "#A"], more: 4 });
  });

  it("최대 개수를 바꿀 수 있다", () => {
    expect(cellDensity(by("#A", "#B", "#C"), 2)).toEqual({ dots: ["#A", "#B"], more: 1 });
  });
});
