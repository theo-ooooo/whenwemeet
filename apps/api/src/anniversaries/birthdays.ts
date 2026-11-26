/**
 * (#305) 멤버 생일 (설계 api.md 2.4, D-230 ~ D-233). 순수 함수.
 * 생일은 User 에 'MM-DD' 하나로 두고 팀 달력, 알림, 구독 피드가 매번 계산한다 (Anniversary 행을 복사하지 않음).
 * 계산은 기념일 "매년 반복"(YEARLY) 규칙을 그대로 쓴다: 2월 29일은 평년에 2월 28일 (D-62).
 * (#562, D-297) 음력 생일은 'MM-DD' 가 음력 월일이고 calendar LUNAR, 윤달 여부. 해마다 양력은 기념일과 같은 함수(anniversary-items)
 */
import type { CalendarKind } from '../common/lunar.js';
import { anniversaryItemsOn, type AnniversaryLike } from '../push/anniversary-items.js';

/** 'MM-DD' */
export const BIRTHDAY_PATTERN = /^\d{2}-\d{2}$/;

/** 기준 해. 윤년이라 2월 29일도 담고, 이 해 뒤로는 매년 YEARLY 항목이 된다 */
export const BIRTHDAY_ANCHOR_YEAR = 2000;

/** 달마다 마지막 날. 2월은 29일까지 받는다 (평년에는 28일에 보인다) */
const MONTH_DAYS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
/** (#562) 음력 달은 29일 또는 30일. 30일은 29일인 해에 그 달 마지막 날(29일)에 보인다 */
const LUNAR_MONTH_MAX_DAY = 30;

/** (#562) 생일 값: 'MM-DD' + 달력 종류 + 윤달 (DB User.birthday, birthdayCalendar, birthdayLeapMonth) */
export interface BirthdayValue {
  date: string;
  calendar: CalendarKind;
  isLeapMonth: boolean;
}

/** 'MM-DD' 이고 실제로 있는 월일인가 (양력은 2월 29일 허용, 음력은 1~30일) */
export function isBirthday(value: unknown, calendar: CalendarKind = 'SOLAR'): value is string {
  if (typeof value !== 'string' || !BIRTHDAY_PATTERN.test(value)) return false;
  const [m, d] = value.split('-').map(Number);
  const max = calendar === 'LUNAR' ? LUNAR_MONTH_MAX_DAY : MONTH_DAYS[m - 1];
  return m >= 1 && m <= 12 && d >= 1 && d <= max;
}

/** 기념일 계산에 넣는 모양: 기준 해의 그 날짜, 매년 반복 (음력이면 음력 2000년의 그 월일) */
export function birthdayAnniversary(birthday: BirthdayValue): AnniversaryLike {
  return { date: `${BIRTHDAY_ANCHOR_YEAR}-${birthday.date}`, kind: 'YEARLY', calendar: birthday.calendar, isLeapMonth: birthday.isLeapMonth };
}

/** 날짜 `day` ('YYYY-MM-DD', KST) 가 그 사람 생일로 보이는 날인가 */
export function isBirthdayOn(birthday: BirthdayValue, day: string): boolean {
  return anniversaryItemsOn(birthdayAnniversary(birthday), day).length > 0;
}

/** DB 칸 (birthday, birthdayCalendar, birthdayLeapMonth) → 생일 값. 생일이 없으면 null */
export function birthdayOf(row: { birthday: string | null; birthdayCalendar: CalendarKind; birthdayLeapMonth: boolean }): BirthdayValue | null {
  return row.birthday === null ? null : { date: row.birthday, calendar: row.birthdayCalendar, isLeapMonth: row.birthdayLeapMonth };
}

/** 달력, 알림, 피드의 이름: "지민 생일" (팀 표시 이름 ?? 닉네임) */
export const birthdayTitle = (name: string): string => `${name} 생일`;
