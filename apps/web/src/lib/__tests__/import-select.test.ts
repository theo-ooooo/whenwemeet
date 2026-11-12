import { describe, expect, it } from "vitest";
import {
  coveredDays,
  excludedLine,
  groupState,
  importMonths,
  includeKeys,
  itemsByDay,
  itemWhen,
  repeatBadge,
  selectedCount,
  selectionLabel,
  selectReducer,
  submitLabel,
} from "../import-select";
import type { ImportItem } from "../types";

const item = (key: string, startsAt: string, endsAt: string, allDay = false, repeat: ImportItem["repeat"] = null): ImportItem => ({
  key,
  title: key,
  startsAt,
  endsAt,
  allDay,
  repeat,
});
// KST 기준: 11월 30일 23:30 은 UTC 14:30, 12월 1일 00:00 은 UTC 11/30 15:00
const items = [
  item("a", "2026-11-11T15:00:00.000Z", "2026-11-12T15:00:00.000Z", true),
  item("b", "2026-11-30T14:30:00.000Z", "2026-11-30T15:30:00.000Z"),
  item("c", "2026-11-30T15:00:00.000Z", "2026-12-01T15:00:00.000Z", true, "WEEKLY"),
  item("d", "2027-01-05T01:00:00.000Z", "2027-01-05T02:00:00.000Z"),
];

describe("import-select (#314)", () => {
  it("걸친 날, 날짜별, 일정이 있는 달 (여러 달에 걸치면 각 달에)", () => {
    expect(coveredDays(items[0])).toEqual(["2026-11-12"]);
    expect(coveredDays(items[1])).toEqual(["2026-11-30", "2026-12-01"]);
    // 끝이 시작 이하여도 하루
    expect(coveredDays(item("z", "2026-11-11T15:00:00.000Z", "2026-11-11T15:00:00.000Z", true))).toEqual(["2026-11-12"]);
    const byDay = itemsByDay(items);
    expect(byDay.get("2026-11-30")!.map((i) => i.key)).toEqual(["b"]);
    expect(byDay.get("2026-12-01")!.map((i) => i.key)).toEqual(["b", "c"]);
    expect(importMonths(items).map((m) => [m.label, m.items.map((i) => i.key).join("")])).toEqual([
      ["2026년 11월", "ab"],
      ["2026년 12월", "bc"],
      ["2027년 1월", "d"],
    ]);
    expect(importMonths([])).toEqual([]);
  });

  it("줄의 날짜: 종일 하루, 종일 여러 날, 시각, 자정 넘김", () => {
    expect(itemWhen(items[0])).toBe("11월 12일 (목), 종일");
    expect(itemWhen(item("x", "2026-11-11T15:00:00.000Z", "2026-11-14T15:00:00.000Z", true))).toBe("11월 12일 (목) ~ 11월 14일 (토), 종일");
    expect(itemWhen(items[3])).toBe("1월 5일 (화) 10:00~11:00");
    expect(itemWhen(items[1])).toBe("11월 30일 (월) 23:30 ~ 12월 1일 (화) 00:30");
    expect(repeatBadge("WEEKLY")).toBe("매주 반복");
    expect(repeatBadge("BIWEEKLY")).toBe("격주 반복");
    expect(repeatBadge(null)).toBeNull();
  });

  it("선택 수, 묶음 상태, include, 문구", () => {
    const none = new Set<string>();
    const some = new Set(["b"]);
    expect(selectedCount(items, none)).toBe(4);
    expect(groupState(items, none)).toBe(true);
    expect(groupState(items, some)).toBe("mixed");
    expect(groupState(items.slice(1, 2), some)).toBe(false);
    expect(includeKeys(items, some)).toEqual(["a", "c", "d"]);
    expect(selectionLabel(1234, 1000)).toBe("1,234개 중 1,000개 선택");
    expect(submitLabel("우리", 3, 4)).toBe("우리에 3개 넣기");
    expect(submitLabel("우리", 0, 4)).toBe("넣을 일정을 골라 주세요");
    expect(submitLabel("우리", 0, 0)).toBe("넣을 일정이 없어요");
    expect(excludedLine(0)).toBeNull();
    expect(excludedLine(2)).toBe("뺀 일정 2개는 넣지 않았어요. 같은 파일을 다시 올리면 다시 고를 수 있어요");
  });

  it("reducer: 하나 토글, 묶음 켜고 끄기, reset 은 전부 선택", () => {
    let s: ReadonlySet<string> = new Set();
    s = selectReducer(s, { type: "toggle", key: "a" });
    expect([...s]).toEqual(["a"]);
    s = selectReducer(s, { type: "toggle", key: "a" });
    expect(s.size).toBe(0);
    s = selectReducer(s, { type: "set", keys: ["a", "b"], on: false });
    expect([...s].sort()).toEqual(["a", "b"]);
    s = selectReducer(s, { type: "set", keys: ["b", "c"], on: true });
    expect([...s]).toEqual(["a"]);
    s = selectReducer(s, { type: "reset" });
    expect(s.size).toBe(0);
    // 이미 비었으면 같은 객체 (다시 그리지 않게)
    expect(selectReducer(s, { type: "reset" })).toBe(s);
  });
});
