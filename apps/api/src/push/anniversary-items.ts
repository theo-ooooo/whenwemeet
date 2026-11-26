/**
 * 기념일 그날 항목 (#188, 설계 푸시-알림.md 5-5, D-92). 웹 `apps/web/src/lib/anniversary.ts` 의
 * `occurrencesInRange(a, D, D)` 를 서버로 옮긴 순수 함수 (D-59, D-60, D-62 규칙 그대로).
 * 날짜는 KST 달력 날짜 'YYYY-MM-DD'.
 * (#562, D-297) 음력 기념일, 생일도 여기 한 곳에서 해마다 양력 날짜로 바꾼다 (anniversaryOrigin, anniversaryYearDate).
 * 알림, 주간 요약, 구독 피드, 볼까가 모두 이 함수를 거친다
 */
import { type CalendarKind, lunarOccurrence, solarToLunar } from '../common/lunar.js';
import { addDays, dateToDay } from '../events/recurrence.js';

export type AnniversaryKind = 'COUNT_UP' | 'YEARLY' | 'ONCE';

/** ORIGINAL = 등록한 날짜, DAYS = N일, YEARS = N주년, YEARLY = 매년 돌아오는 날 */
export type AnniversaryItemType = 'ORIGINAL' | 'DAYS' | 'YEARS' | 'YEARLY';

export interface AnniversaryLike {
  /** 'YYYY-MM-DD'. 음력이면 음력 연월일 (D-297) */
  date: string;
  kind: AnniversaryKind;
  /** (#562) 생략하면 SOLAR (음력 도입 전 행, 생일) */
  calendar?: CalendarKind;
  /** (#562) 음력 윤달. 양력이면 무시 */
  isLeapMonth?: boolean;
}

export interface AnniversaryItem {
  type: AnniversaryItemType;
  /** DAYS 면 N일의 N, YEARS 면 N주년의 N */
  n: number | null;
  /** "300일", "1주년". ORIGINAL, YEARLY 는 null (이름으로 표시) */
  label: string | null;
}

/** N일 단위: 100 간격 1000일까지, 이후 1000 간격 30000일까지 (D-59) */
export const DAY_MILESTONES: readonly number[] = [
  ...Array.from({ length: 10 }, (_, i) => (i + 1) * 100),
  ...Array.from({ length: 29 }, (_, i) => (i + 2) * 1000),
];
export const MAX_YEARS = 100;

/** 우선순위: N주년 > N일 > 매년/원래 날짜 (기념일-자동표시.md 3-6) */
const RANK: Record<AnniversaryItemType, number> = { YEARS: 0, DAYS: 1, YEARLY: 2, ORIGINAL: 2 };

const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

function parseKey(key: string): { y: number; m: number; d: number } {
  const [y, m, d] = key.split('-').map(Number);
  return { y, m, d };
}

const pad = (n: number) => String(n).padStart(2, '0');

/** 시작일과 같은 월일의 y 년 날짜. 2월 29일은 평년에 2월 28일 */
function sameDayInYear(start: string, y: number): string {
  const { m, d } = parseKey(start);
  return `${String(y).padStart(4, '0')}-${pad(m)}-${pad(m === 2 && d === 29 && !isLeap(y) ? 28 : d)}`;
}

/** 시작일을 1일로 센 그날의 번호. N일 = 시작일 + (N - 1)일 */
function dayNumber(start: string, key: string): number {
  return dateToDay(key) - dateToDay(start) + 1;
}

const isLunar = (a: AnniversaryLike): boolean => a.calendar === 'LUNAR';

/**
 * (#562) 기념일 원래 날짜의 양력. 양력이면 그대로, 음력이면 저장한 음력 연월일의 양력 (윤달이 없는 해, 없는 30일은 lunarOccurrence 규칙).
 * 변환 범위 밖이면 null (입력 검증이 막지만 옛 값 방어)
 */
export function anniversaryOrigin(a: AnniversaryLike): string | null {
  if (!isLunar(a)) return a.date;
  const { y, m, d } = parseKey(a.date);
  return lunarOccurrence(y, m, d, a.isLeapMonth === true);
}

/**
 * (#562) 시작 해에서 n 해 뒤(n >= 1)의 그날 양력. 양력은 같은 월일(2월 29일은 평년 28일, D-62),
 * 음력은 음력 시작 해 + n 의 같은 음력 월일을 양력으로 (윤달은 그해에 없으면 평달, 없는 30일은 그 달 마지막 날, D-297).
 * 음력 12월은 다음 양력 해 1, 2월에 올 수 있다. 범위 밖(음력 2050년 뒤)은 null
 */
export function anniversaryYearDate(a: AnniversaryLike, n: number): string | null {
  const { y, m, d } = parseKey(a.date);
  if (!isLunar(a)) return sameDayInYear(a.date, y + n);
  return lunarOccurrence(y + n, m, d, a.isLeapMonth === true);
}

/** 날짜 `day` 가 몇 해째 후보인가. 양력은 양력 해 차이, 음력은 그날의 음력 해 차이 (범위 밖이면 null) */
function yearIndexOn(a: AnniversaryLike, day: string): number | null {
  const sy = parseKey(a.date).y;
  if (!isLunar(a)) return parseKey(day).y - sy;
  const lunar = solarToLunar(day);
  return lunar ? lunar.year - sy : null;
}

/** 날짜 `day` 의 항목. 우선순위 순 (첫 항목이 알림 문구) */
export function anniversaryItemsOn(a: AnniversaryLike, day: string): AnniversaryItem[] {
  const out: AnniversaryItem[] = [];
  const start = anniversaryOrigin(a);
  if (start === null) return out;
  if (day === start) out.push({ type: 'ORIGINAL', n: null, label: null });

  if (a.kind === 'COUNT_UP') {
    const n = dayNumber(start, day);
    if (DAY_MILESTONES.includes(n) && addDays(start, n - 1) === day) out.push({ type: 'DAYS', n, label: `${n}일` });
  }

  if (a.kind === 'COUNT_UP' || a.kind === 'YEARLY') {
    const n = yearIndexOn(a, day);
    if (n !== null && n >= 1 && !(a.kind === 'COUNT_UP' && n > MAX_YEARS) && anniversaryYearDate(a, n) === day) {
      out.push(a.kind === 'COUNT_UP' ? { type: 'YEARS', n, label: `${n}주년` } : { type: 'YEARLY', n: null, label: null });
    }
  }

  return out.sort((x, y) => RANK[x.type] - RANK[y.type]);
}
