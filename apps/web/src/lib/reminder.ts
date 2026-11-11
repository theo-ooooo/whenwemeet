// (#188) 일정 알림 시각 선택지와 검증 (푸시-알림.md 4-1, D-84). React 를 import 하지 않는다 (단위 테스트 대상)
// 서버 apps/api/src/push/remind-at.ts 와 같은 값. 시간 일정과 종일 일정의 선택지가 다르다
import type { EventReminder } from "./types";

/** 시간 일정 선택지 (화면 순서) */
export const TIMED_REMINDERS: readonly EventReminder[] = ["NONE", "AT_START", "MIN_10", "HOUR_1", "DAY_1"];
/** 종일 일정 선택지 (화면 순서) */
export const ALL_DAY_REMINDERS: readonly EventReminder[] = ["NONE", "DAY_OF_0900", "DAY_BEFORE_0900"];

export const REMINDER_LABEL: Record<EventReminder, string> = {
  NONE: "없음",
  AT_START: "정시",
  MIN_10: "10분 전",
  HOUR_1: "1시간 전",
  DAY_1: "1일 전",
  DAY_OF_0900: "당일 오전 9시",
  DAY_BEFORE_0900: "전날 오전 9시",
};

const ALL: readonly EventReminder[] = ["NONE", "AT_START", "MIN_10", "HOUR_1", "DAY_1", "DAY_OF_0900", "DAY_BEFORE_0900"];

/** API 응답 값을 읽는다. 옛 API(필드 없음)나 모르는 값은 NONE */
export function reminderOf(v: unknown): EventReminder {
  return ALL.includes(v as EventReminder) ? (v as EventReminder) : "NONE";
}

/** 종일 여부에 맞는 선택지 */
export function reminderOptions(allDay: boolean): readonly EventReminder[] {
  return allDay ? ALL_DAY_REMINDERS : TIMED_REMINDERS;
}

/** 이 일정(종일 여부)에 고를 수 있는 값인지. NONE 은 언제나 된다 */
export function isReminderAllowed(r: EventReminder, allDay: boolean): boolean {
  return reminderOptions(allDay).includes(r);
}

/** 맞지 않는 값의 오류 문구 (서버 400 VALIDATION_FAILED 와 같은 문장). 맞으면 null */
export function reminderError(r: EventReminder, allDay: boolean): string | null {
  if (isReminderAllowed(r, allDay)) return null;
  return allDay ? "종일 일정에는 고를 수 없는 알림이에요" : "시간 일정에는 고를 수 없는 알림이에요";
}

/** 종일을 켜거나 끈 뒤의 값. 맞지 않으면 "없음" 으로 되돌린다 (8장, 서버 4-1 수정 규칙과 같음) */
export function reminderAfterAllDayChange(r: EventReminder, allDay: boolean): EventReminder {
  return isReminderAllowed(r, allDay) ? r : "NONE";
}

/**
 * 요청 본문에 reminder 를 실을지. 생성은 "없음" 이면 생략(서버 기본 NONE),
 * 수정은 불러온 일정에 reminder 가 있으면(API 가 아는 필드) 늘 싣는다. 옛 API 에 모르는 필드를 보내 400 이 나지 않게 한다
 */
export function reminderToSend(r: EventReminder, loaded: { reminder?: unknown } | null): EventReminder | undefined {
  if (loaded && loaded.reminder !== undefined) return r;
  return r === "NONE" ? undefined : r;
}

/** 일정 상세에 보일 한 줄. 없음이면 null */
export function reminderDetail(r: EventReminder | undefined): string | null {
  if (!r || r === "NONE") return null;
  return `알림 ${REMINDER_LABEL[r]}`;
}
