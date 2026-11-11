/**
 * 일정 알림 시각 (#188, 설계 푸시-알림.md 4-1, D-84). 순수 함수 (단위 테스트 대상)
 * 시간 일정은 회차 시작 기준 오프셋, 종일 일정은 시작의 KST 날짜 09:00 / 전날 09:00
 */
import { DAY_MS, type EventReminderValue, kstDate, kstMidnight } from '../events/recurrence.js';

export type EventReminder = EventReminderValue;

export const EVENT_REMINDERS: readonly EventReminder[] = ['NONE', 'AT_START', 'MIN_10', 'HOUR_1', 'DAY_1', 'DAY_OF_0900', 'DAY_BEFORE_0900'];

/** 시간 일정에 고를 수 있는 값 */
export const TIMED_REMINDERS: readonly EventReminder[] = ['NONE', 'AT_START', 'MIN_10', 'HOUR_1', 'DAY_1'];
/** 종일 일정에 고를 수 있는 값 */
export const ALL_DAY_REMINDERS: readonly EventReminder[] = ['NONE', 'DAY_OF_0900', 'DAY_BEFORE_0900'];

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

/** 시간 일정의 회차 시작 대비 오프셋 */
const TIMED_OFFSET_MS: Partial<Record<EventReminder, number>> = {
  AT_START: 0,
  MIN_10: 10 * MINUTE_MS,
  HOUR_1: HOUR_MS,
  DAY_1: DAY_MS,
};

/** 종일 여부와 맞는 값인지. NONE 은 둘 다 맞다 */
export function reminderFits(allDay: boolean, reminder: EventReminder): boolean {
  return (allDay ? ALL_DAY_REMINDERS : TIMED_REMINDERS).includes(reminder);
}

/** 종일 여부와 안 맞을 때의 안내 문구 (설계 4-1) */
export function reminderMismatchMessage(allDay: boolean): string {
  return allDay ? '종일 일정에는 고를 수 없는 알림이에요' : '시간 일정에는 고를 수 없는 알림이에요';
}

/**
 * 알림 시각. NONE 이거나 종일 여부와 안 맞으면 null.
 * 종일은 startsAt 의 KST 날짜로 계산한다 (startsAt 이 KST 자정이 아니어도 같은 날짜 규칙)
 */
export function remindAt(startsAt: Date, allDay: boolean, reminder: EventReminder): Date | null {
  if (reminder === 'NONE' || !reminderFits(allDay, reminder)) return null;
  if (allDay) {
    const dayStart = kstMidnight(kstDate(startsAt)).getTime();
    return new Date(dayStart + (reminder === 'DAY_OF_0900' ? 9 * HOUR_MS : -15 * HOUR_MS));
  }
  return new Date(startsAt.getTime() - (TIMED_OFFSET_MS[reminder] as number));
}
