import { describe, expect, it } from "vitest";
import {
  ALL_DAY_REMINDERS,
  isReminderAllowed,
  REMINDER_LABEL,
  reminderAfterAllDayChange,
  reminderDetail,
  reminderError,
  reminderOf,
  reminderOptions,
  reminderToSend,
  TIMED_REMINDERS,
} from "../reminder";

describe("알림 선택지 (푸시-알림.md 4-1)", () => {
  it("시간 일정: 없음 / 정시 / 10분 전 / 1시간 전 / 1일 전", () => {
    expect(reminderOptions(false).map((r) => REMINDER_LABEL[r])).toEqual(["없음", "정시", "10분 전", "1시간 전", "1일 전"]);
    expect(reminderOptions(false)).toBe(TIMED_REMINDERS);
  });

  it("종일 일정: 없음 / 당일 오전 9시 / 전날 오전 9시", () => {
    expect(reminderOptions(true).map((r) => REMINDER_LABEL[r])).toEqual(["없음", "당일 오전 9시", "전날 오전 9시"]);
    expect(reminderOptions(true)).toBe(ALL_DAY_REMINDERS);
  });

  it("종일 여부와 맞지 않는 값은 서버와 같은 문장으로 막는다", () => {
    expect(isReminderAllowed("NONE", true)).toBe(true);
    expect(isReminderAllowed("NONE", false)).toBe(true);
    expect(isReminderAllowed("HOUR_1", true)).toBe(false);
    expect(isReminderAllowed("DAY_OF_0900", false)).toBe(false);
    expect(reminderError("HOUR_1", true)).toBe("종일 일정에는 고를 수 없는 알림이에요");
    expect(reminderError("DAY_BEFORE_0900", false)).toBe("시간 일정에는 고를 수 없는 알림이에요");
    expect(reminderError("MIN_10", false)).toBeNull();
  });

  it("종일을 바꾸면 맞지 않는 값은 없음으로 되돌린다 (8장)", () => {
    expect(reminderAfterAllDayChange("HOUR_1", true)).toBe("NONE");
    expect(reminderAfterAllDayChange("DAY_OF_0900", false)).toBe("NONE");
    expect(reminderAfterAllDayChange("NONE", true)).toBe("NONE");
    expect(reminderAfterAllDayChange("DAY_1", false)).toBe("DAY_1");
    expect(reminderAfterAllDayChange("DAY_BEFORE_0900", true)).toBe("DAY_BEFORE_0900");
  });

  it("응답 값 읽기: 옛 API(필드 없음), 모르는 값은 없음", () => {
    expect(reminderOf(undefined)).toBe("NONE");
    expect(reminderOf("MIN_5")).toBe("NONE");
    expect(reminderOf("HOUR_1")).toBe("HOUR_1");
  });

  it("보낼 값: 생성은 없음이면 생략, 수정은 API 가 아는 필드면 늘 싣는다", () => {
    expect(reminderToSend("NONE", null)).toBeUndefined();
    expect(reminderToSend("HOUR_1", null)).toBe("HOUR_1");
    expect(reminderToSend("NONE", { reminder: "HOUR_1" })).toBe("NONE");
    expect(reminderToSend("MIN_10", { reminder: "NONE" })).toBe("MIN_10");
    // 옛 API 응답(reminder 없음) 수정: 없음이면 보내지 않는다
    expect(reminderToSend("NONE", {})).toBeUndefined();
  });

  it("상세 한 줄", () => {
    expect(reminderDetail("HOUR_1")).toBe("알림 1시간 전");
    expect(reminderDetail("DAY_BEFORE_0900")).toBe("알림 전날 오전 9시");
    expect(reminderDetail("NONE")).toBeNull();
    expect(reminderDetail(undefined)).toBeNull();
  });
});
