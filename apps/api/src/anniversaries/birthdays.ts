/**
 * (#305) 멤버 생일 (설계 api.md 2.4, D-224 ~ D-227). 순수 함수.
 * 생일은 User 에 'MM-DD' 하나로 두고 팀 달력, 알림, 구독 피드가 매번 계산한다 (Anniversary 행을 복사하지 않음).
 * 계산은 기념일 "매년 반복"(YEARLY) 규칙을 그대로 쓴다: 2월 29일은 평년에 2월 28일 (D-62)
 */
import { anniversaryItemsOn, type AnniversaryLike } from '../push/anniversary-items.js';
import type { AnniversaryReminderFlags } from './anniversary-reminders.js';

/** 'MM-DD' */
export const BIRTHDAY_PATTERN = /^\d{2}-\d{2}$/;

/** 기준 해. 윤년이라 2월 29일도 담고, 이 해 뒤로는 매년 YEARLY 항목이 된다 */
export const BIRTHDAY_ANCHOR_YEAR = 2000;

/** 달마다 마지막 날. 2월은 29일까지 받는다 (평년에는 28일에 보인다) */
const MONTH_DAYS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** 'MM-DD' 이고 실제로 있는 월일인가 (2월 29일 허용) */
export function isBirthday(value: unknown): value is string {
  if (typeof value !== 'string' || !BIRTHDAY_PATTERN.test(value)) return false;
  const [m, d] = value.split('-').map(Number);
  return m >= 1 && m <= 12 && d >= 1 && d <= MONTH_DAYS[m - 1];
}

/** 기념일 계산에 넣는 모양: 기준 해의 그 날짜, 매년 반복 */
export function birthdayAnniversary(birthday: string): AnniversaryLike {
  return { date: `${BIRTHDAY_ANCHOR_YEAR}-${birthday}`, kind: 'YEARLY' };
}

/** 날짜 `day` ('YYYY-MM-DD', KST) 가 그 사람 생일로 보이는 날인가 */
export function isBirthdayOn(birthday: string, day: string): boolean {
  return anniversaryItemsOn(birthdayAnniversary(birthday), day).length > 0;
}

/** 달력, 알림, 피드의 이름: "지민 생일" (팀 표시 이름 ?? 닉네임) */
export const birthdayTitle = (name: string): string => `${name} 생일`;

/** User 의 생일 알림 칸 → 기념일 알림 칸 모양 */
export interface BirthdayReminderColumns {
  birthdayRemindDayOf: boolean;
  birthdayRemindDayBefore: boolean;
  birthdayRemindWeekBefore: boolean;
}

export function birthdayFlags(row: BirthdayReminderColumns): AnniversaryReminderFlags {
  return { remindDayOf: row.birthdayRemindDayOf, remindDayBefore: row.birthdayRemindDayBefore, remindWeekBefore: row.birthdayRemindWeekBefore };
}

export function birthdayColumns(flags: AnniversaryReminderFlags): BirthdayReminderColumns {
  return { birthdayRemindDayOf: flags.remindDayOf, birthdayRemindDayBefore: flags.remindDayBefore, birthdayRemindWeekBefore: flags.remindWeekBefore };
}
