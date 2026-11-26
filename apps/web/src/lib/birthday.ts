// (#305) 멤버 생일 (설계 api.md 2.4, 결정 D-230 ~ D-233). 순수 함수 (단위 테스트 대상).
// 서버는 'MM-DD' 만 준다. 화면은 기념일 "매년 반복" 항목으로 바꿔 달력, 일 상세, 다가오는 일정, 위젯에 같은 규칙으로 섞는다
// (2월 29일은 평년에 2월 28일, lib/anniversary.ts sameDayInYear)
import { formatLunar, type CalendarKind } from "./lunar";
import type { Anniversary, Birthday } from "./types";

/** 기준 해. 윤년이라 2월 29일을 담고, 이 해 뒤로는 매년 항목이 된다 (서버 BIRTHDAY_ANCHOR_YEAR 와 같음) */
export const BIRTHDAY_ANCHOR_YEAR = 2000;

/** 달마다 마지막 날. 2월은 29일까지 고를 수 있다 */
export const MONTH_DAYS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;
/** (#562) 음력 달은 30일까지 고를 수 있다 (29일인 해에는 29일에 보인다) */
const LUNAR_MONTH_DAYS = 30;

const pad = (n: number) => String(n).padStart(2, "0");

/** 'MM-DD' ↔ { m, d } */
export function parseBirthday(value: string | null | undefined, calendar: CalendarKind = "SOLAR"): { m: number; d: number } | null {
  if (!value || !/^\d{2}-\d{2}$/.test(value)) return null;
  const [m, d] = value.split("-").map(Number);
  if (m < 1 || m > 12 || d < 1 || d > (calendar === "LUNAR" ? LUNAR_MONTH_DAYS : MONTH_DAYS[m - 1])) return null;
  return { m, d };
}

export const toBirthday = (m: number, d: number) => `${pad(m)}-${pad(d)}`;

/** 달을 바꿨을 때 그 달에 없는 날은 마지막 날로 (4월 31일 → 30일) */
export const clampDay = (m: number, d: number) => Math.min(d, MONTH_DAYS[m - 1]);

/** "3월 5일". (#562) 음력이면 "음력 3월 5일", 윤달 "음력 윤4월 5일" */
export function formatBirthday(value: string | null | undefined, calendar: CalendarKind = "SOLAR", leap = false): string | null {
  const p = parseBirthday(value, calendar);
  if (!p) return null;
  return calendar === "LUNAR" ? formatLunar(p.m, p.d, leap) : `${p.m}월 ${p.d}일`;
}

export const birthdayTitle = (name: string) => `${name} 생일`;

/**
 * 생일 → 기념일 항목. id 는 서버 기념일과 겹치지 않게 음수(-userId), 만든 사람 자리에 그 멤버(이름, 색).
 * birthdayOf 가 있으면 기념일 화면이 수정 시트 대신 생일 줄로 그린다
 */
export function birthdayToAnniversary(b: Birthday, groupId: number): Anniversary {
  const userId = b.member.userId ?? 0;
  return {
    id: -userId,
    groupId,
    name: birthdayTitle(b.member.displayName),
    date: `${BIRTHDAY_ANCHOR_YEAR}-${b.date}`,
    kind: "YEARLY",
    // (#562) 음력 생일은 음력 2000년의 그 월일. 해마다 양력은 lib/anniversary.ts 가 바꾼다
    calendar: b.calendar ?? "SOLAR",
    isLeapMonth: b.isLeapMonth ?? false,
    reminders: [],
    creator: b.member,
    createdAt: `${BIRTHDAY_ANCHOR_YEAR}-01-01T00:00:00.000Z`,
    birthdayOf: userId,
  };
}

/**
 * 기념일 목록 + 멤버 생일. 기념일이 아직 없으면(로딩) null 그대로, 생일을 못 받았으면(null) 기념일만
 */
export function withBirthdays(anniversaries: Anniversary[] | null, birthdays: Birthday[] | null, groupId: number): Anniversary[] | null {
  if (anniversaries === null) return null;
  if (!birthdays || birthdays.length === 0) return anniversaries;
  return [...anniversaries, ...birthdays.map((b) => birthdayToAnniversary(b, groupId))];
}
