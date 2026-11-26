/**
 * 기념일 알림 시점 (#269, 설계 api.md 2.4, 푸시-알림.md 5-5, D-144). 모두 오전 9시 KST.
 * DB 는 켜진 시점마다 자식 행 하나(#369, 옛 Boolean 칸 3개는 #376 에서 DROP), API 는 켜진 시점의 배열 (`[]` = 알림 없음)
 */
export const ANNIVERSARY_REMINDERS = [
  'DAY_OF',
  'DAY_BEFORE',
  'WEEK_BEFORE',
] as const;
export type AnniversaryReminder = (typeof ANNIVERSARY_REMINDERS)[number];

/** 생략했을 때와 #269 전 행 (지금 동작 그대로) */
export const DEFAULT_ANNIVERSARY_REMINDERS: readonly AnniversaryReminder[] = [
  'DAY_OF',
];

export interface AnniversaryReminderFlags {
  remindDayOf: boolean;
  remindDayBefore: boolean;
  remindWeekBefore: boolean;
}

export function toReminderFlags(
  reminders: readonly AnniversaryReminder[],
): AnniversaryReminderFlags {
  return {
    remindDayOf: reminders.includes('DAY_OF'),
    remindDayBefore: reminders.includes('DAY_BEFORE'),
    remindWeekBefore: reminders.includes('WEEK_BEFORE'),
  };
}

/** 응답 순서는 고정 (당일, 하루 전, 일주일 전) */
export function fromReminderFlags(
  flags: AnniversaryReminderFlags,
): AnniversaryReminder[] {
  const out: AnniversaryReminder[] = [];
  if (flags.remindDayOf) out.push('DAY_OF');
  if (flags.remindDayBefore) out.push('DAY_BEFORE');
  if (flags.remindWeekBefore) out.push('WEEK_BEFORE');
  return out;
}

/**
 * (#369) 저장은 켜진 시점마다 자식 행 하나 (`AnniversaryReminder`, `BirthdayReminder` 의 offset, D-249).
 * 시점 이름이 DB enum `ReminderOffset` 과 같다. 안에서는 칸 모양(AnniversaryReminderFlags)으로 다룬다
 */
export const REMINDER_ROWS_SELECT = { select: { offset: true } } as const;

/** 자식 행 → 칸 모양 */
export function flagsFromRows(
  rows: readonly { offset: AnniversaryReminder }[],
): AnniversaryReminderFlags {
  return toReminderFlags(rows.map((row) => row.offset));
}

/** 칸 모양 → 만들 자식 행 (당일, 하루 전, 일주일 전 순) */
export function rowsFromFlags(
  flags: AnniversaryReminderFlags,
): { offset: AnniversaryReminder }[] {
  return fromReminderFlags(flags).map((offset) => ({ offset }));
}
