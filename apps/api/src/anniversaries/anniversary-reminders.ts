/**
 * 기념일 알림 시점 (#269, 설계 api.md 2.4, 푸시-알림.md 5-5, D-143). 모두 오전 9시 KST.
 * DB 는 Boolean 칸 3개, API 는 켜진 시점의 배열 (`[]` = 알림 없음)
 */
export const ANNIVERSARY_REMINDERS = ['DAY_OF', 'DAY_BEFORE', 'WEEK_BEFORE'] as const;
export type AnniversaryReminder = (typeof ANNIVERSARY_REMINDERS)[number];

/** 그날보다 며칠 앞서 보내는가 */
export const REMINDER_OFFSET_DAYS: Record<AnniversaryReminder, number> = { DAY_OF: 0, DAY_BEFORE: 1, WEEK_BEFORE: 7 };

/** 생략했을 때와 #269 전 행 (지금 동작 그대로) */
export const DEFAULT_ANNIVERSARY_REMINDERS: readonly AnniversaryReminder[] = ['DAY_OF'];

export interface AnniversaryReminderFlags {
  remindDayOf: boolean;
  remindDayBefore: boolean;
  remindWeekBefore: boolean;
}

export function toReminderFlags(reminders: readonly AnniversaryReminder[]): AnniversaryReminderFlags {
  return {
    remindDayOf: reminders.includes('DAY_OF'),
    remindDayBefore: reminders.includes('DAY_BEFORE'),
    remindWeekBefore: reminders.includes('WEEK_BEFORE'),
  };
}

/** 응답 순서는 고정 (당일, 하루 전, 일주일 전) */
export function fromReminderFlags(flags: AnniversaryReminderFlags): AnniversaryReminder[] {
  const out: AnniversaryReminder[] = [];
  if (flags.remindDayOf) out.push('DAY_OF');
  if (flags.remindDayBefore) out.push('DAY_BEFORE');
  if (flags.remindWeekBefore) out.push('WEEK_BEFORE');
  return out;
}
