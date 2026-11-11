import { describe, expect, it } from "vitest";
import { doneHeadline, looksLikeIcs, previewHeadline, previewLines, SKIP_LABEL, warningLines } from "../import-copy";
import type { ImportPreview } from "../types";

const base: ImportPreview = {
  total: 9,
  toCreate: 1234,
  recurringKept: 2,
  expanded: 11,
  expandedSeries: 3,
  skipped: [],
  firstStartsAt: "2026-11-11T15:00:00.000Z",
  lastStartsAt: "2026-12-31T00:00:00.000Z",
  warnings: [],
  sample: [],
};

describe("import-copy (#279)", () => {
  it("제목: 수에 쉼표, 0 이면 넣을 일정이 없어요", () => {
    expect(previewHeadline(base)).toBe("1,234개를 넣어요");
    expect(previewHeadline({ toCreate: 0 })).toBe("넣을 일정이 없어요");
    expect(doneHeadline(42)).toBe("42개를 넣었어요");
    expect(doneHeadline(0)).toBe("새로 넣은 일정이 없어요");
  });

  it("줄: 반복 유지, 나눠 넣음, 첫/마지막 날짜 (올해면 연도 없이)", () => {
    expect(previewLines(base, "2026-11-11")).toEqual([
      "반복 일정 2개는 반복 그대로 넣어요",
      "반복 규칙을 옮길 수 없는 일정 3개는 1년 안 회차 11개로 나눠 넣어요",
      "11월 12일 (목) ~ 12월 31일 (목)",
    ]);
    expect(previewLines({ ...base, recurringKept: 0, expanded: 0, lastStartsAt: "2027-01-05T00:00:00.000Z" }, "2026-11-11")).toEqual([
      "2026년 11월 12일 (목) ~ 2027년 1월 5일 (화)",
    ]);
    expect(previewLines({ ...base, recurringKept: 0, expanded: 0, firstStartsAt: null, lastStartsAt: null })).toEqual([]);
  });

  it("경고와 건너뜀 이유 문구", () => {
    expect(warningLines({ warnings: ["UNKNOWN_TZID", "TRUNCATED_TITLE"] })).toHaveLength(2);
    expect(Object.keys(SKIP_LABEL)).toHaveLength(6);
  });

  it(".ics 이름이나 text/calendar 만", () => {
    expect(looksLikeIcs({ name: "basic.ICS", type: "" })).toBe(true);
    expect(looksLikeIcs({ name: "x", type: "text/calendar" })).toBe(true);
    expect(looksLikeIcs({ name: "photo.jpg", type: "image/jpeg" })).toBe(false);
  });
});
