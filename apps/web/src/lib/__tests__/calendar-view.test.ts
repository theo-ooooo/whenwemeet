import { describe, expect, it } from "vitest";
import { CAL_VIEW_KEY, parseCalView, readCalView, resolveCalView, withCalView, writeCalView } from "../calendar-view";

describe("(#192) 달력 보기", () => {
  it("주소가 우선, 없으면 저장값, 없으면 월", () => {
    expect(resolveCalView("week", "month")).toBe("week");
    expect(resolveCalView("month", "week")).toBe("month");
    expect(resolveCalView(null, "week")).toBe("week");
    expect(resolveCalView("day", null)).toBe("month");
    expect(parseCalView("WEEK")).toBeNull();
  });

  it("저장소: 막혀도 던지지 않는다", () => {
    const map = new Map<string, string>();
    const ok = { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v) };
    writeCalView(ok, "week");
    expect(map.get(CAL_VIEW_KEY)).toBe("week");
    expect(readCalView(ok)).toBe("week");
    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(readCalView(broken)).toBeNull();
    expect(() => writeCalView(broken, "month")).not.toThrow();
    expect(readCalView(null)).toBeNull();
  });

  it("주소: 주는 view=week, 월은 뗀다, 같으면 null. 다른 쿼리는 그대로", () => {
    expect(withCalView("?date=2026-11-20", "week")).toBe("?date=2026-11-20&view=week");
    expect(withCalView("?date=2026-11-20&view=week", "week")).toBeNull();
    expect(withCalView("?view=week&date=2026-11-20&day=1", "month")).toBe("?date=2026-11-20&day=1");
    expect(withCalView("?view=week", "month")).toBe("");
    expect(withCalView("", "month")).toBeNull();
  });
});
