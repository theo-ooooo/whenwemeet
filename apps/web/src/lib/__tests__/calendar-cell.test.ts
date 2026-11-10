import { describe, expect, it } from "vitest";
import { cellDensity, cellMarks } from "../calendar-cell";

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

describe("cellMarks — 막대와 점 (QA3-M2)", () => {
  type Ev = { id: number; band: boolean; creator: { color: string } };
  const ev = (id: number, band: boolean, color = "#A"): Ev => ({ id, band, creator: { color } });
  const isBand = (e: Ev) => e.band;

  it("막대가 있는 날도 나머지 일정은 점으로 남는다", () => {
    const trip = ev(1, true, "#T");
    const marks = cellMarks([trip, ev(2, false, "#B"), ev(3, false, "#C")], isBand);
    expect(marks.band).toBe(trip);
    expect(marks.density).toEqual({ dots: ["#B", "#C"], more: 0 });
  });

  it("막대만 있으면 점은 없다", () => {
    expect(cellMarks([ev(1, true)], isBand).density).toEqual({ dots: [], more: 0 });
  });

  it("막대가 둘이면 첫째만 막대, 둘째는 점", () => {
    const marks = cellMarks([ev(1, true, "#T"), ev(2, true, "#U")], isBand);
    expect(marks.band?.id).toBe(1);
    expect(marks.density.dots).toEqual(["#U"]);
  });

  it("막대가 없으면 전부 점 (넘치면 +N)", () => {
    const marks = cellMarks([ev(1, false), ev(2, false), ev(3, false), ev(4, false)], isBand);
    expect(marks.band).toBeNull();
    expect(marks.density).toEqual({ dots: ["#A", "#A", "#A"], more: 1 });
  });
});
