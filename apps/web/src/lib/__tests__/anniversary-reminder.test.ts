import { describe, expect, it } from "vitest";
import {
  DEFAULT_REMINDERS,
  isChoiceOn,
  normalizeReminders,
  reminderHint,
  remindersOf,
  sameReminders,
  toggleReminder,
} from "../anniversary-reminder";
import type { AnniversaryReminder } from "../types";

describe("기념일 알림 칩 (#269, 기획 푸시-알림.md 3-7)", () => {
  it("기본은 당일만, 응답에 칸이 없으면(옛 API) 당일만", () => {
    expect(DEFAULT_REMINDERS).toEqual(["DAY_OF"]);
    expect(remindersOf({})).toEqual(["DAY_OF"]);
    expect(remindersOf({ reminders: [] })).toEqual([]);
    expect(remindersOf({ reminders: ["WEEK_BEFORE", "DAY_OF"] })).toEqual(["DAY_OF", "WEEK_BEFORE"]);
  });

  it.each<[string, AnniversaryReminder[], Parameters<typeof toggleReminder>[1], AnniversaryReminder[]]>([
    ["당일에 하루 전 켜기", ["DAY_OF"], "DAY_BEFORE", ["DAY_OF", "DAY_BEFORE"]],
    ["순서는 당일, 하루 전, 일주일 전", ["WEEK_BEFORE"], "DAY_OF", ["DAY_OF", "WEEK_BEFORE"]],
    ["켜진 것 끄기", ["DAY_OF", "DAY_BEFORE"], "DAY_OF", ["DAY_BEFORE"]],
    ["마지막 하나를 끄면 없음", ["DAY_OF"], "DAY_OF", []],
    ["없음은 셋을 끈다", ["DAY_OF", "DAY_BEFORE", "WEEK_BEFORE"], "NONE", []],
    ["없음 상태에서 하나 켜기", [], "WEEK_BEFORE", ["WEEK_BEFORE"]],
    ["없음을 다시 눌러도 없음", [], "NONE", []],
  ])("%s", (_, before, choice, after) => {
    expect(toggleReminder(before, choice)).toEqual(after);
  });

  it("칩 켜짐: 없음은 셋 다 꺼졌을 때만", () => {
    expect(isChoiceOn([], "NONE")).toBe(true);
    expect(isChoiceOn(["DAY_OF"], "NONE")).toBe(false);
    expect(isChoiceOn(["DAY_OF"], "DAY_OF")).toBe(true);
    expect(isChoiceOn(["DAY_OF"], "WEEK_BEFORE")).toBe(false);
  });

  it("함께한 날 세기 + 일주일 전이면 100일 단위 안내 (D-144)", () => {
    expect(reminderHint("COUNT_UP", ["DAY_OF", "WEEK_BEFORE"])).toBe("100일 단위는 하루 전까지만 알려 드려요");
    expect(reminderHint("COUNT_UP", ["DAY_OF", "DAY_BEFORE"])).toBeNull();
    expect(reminderHint("YEARLY", ["WEEK_BEFORE"])).toBeNull();
    expect(reminderHint("ONCE", ["WEEK_BEFORE"])).toBeNull();
  });

  it("정렬과 비교", () => {
    expect(normalizeReminders(["DAY_BEFORE", "DAY_BEFORE", "DAY_OF"])).toEqual(["DAY_OF", "DAY_BEFORE"]);
    expect(sameReminders(["DAY_BEFORE", "DAY_OF"], ["DAY_OF", "DAY_BEFORE"])).toBe(true);
    expect(sameReminders(["DAY_OF"], [])).toBe(false);
  });
});
