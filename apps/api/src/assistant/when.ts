import { addDays } from '../events/recurrence.js';
import { isCalendarDate } from '../common/validation.js';
import { kstWeekday } from './prompt.js';

/**
 * (#458) 날짜 표현 → KST 날짜 (설계 AI-비서.md 4-1, D-276). 순수 함수.
 * 모델은 날짜를 계산하지 않고 사용자가 말한 표현을 그대로 구조로 옮긴다(도구 인자 `when`). 달력 계산은 여기서만 한다.
 * 한 주는 일요일 시작(D-261). 풀 수 없는 표현은 null (부르는 쪽이 되묻는다)
 */

export const WHEN_KINDS = [
  'date',
  'relativeDays',
  'weekday',
  'weekend',
  'week',
  'month',
  'monthDay',
] as const;
export type WhenKind = (typeof WHEN_KINDS)[number];
export const WEEKDAY_WORDS = [
  '일',
  '월',
  '화',
  '수',
  '목',
  '금',
  '토',
] as const;
export type WeekdayWord = (typeof WEEKDAY_WORDS)[number];
export const WHICH_WORDS = ['nearest', 'this', 'next', 'after_next'] as const;
export type Which = (typeof WHICH_WORDS)[number];

/** 도구 인자의 날짜 표현 (strict 라 모든 키가 오고, 안 쓰는 키는 null) */
export interface WhenArg {
  /** null = 말하지 않음 */
  kind: WhenKind | null;
  /** kind=date: 'YYYY-MM-DD' (연도까지 말했거나 앞 대화의 날짜) */
  date: string | null;
  /** kind=relativeDays: 오늘 0, 내일 1, 모레 2, 글피 3, 어제 -1 */
  days: number | null;
  /** kind=weekday: 요일 글자 */
  weekday: WeekdayWord | null;
  /** weekday, weekend, week, month: 없음/요일만 nearest, "이번" this, "다음" next, "다다음" after_next */
  which: Which | null;
  /** kind=month (몇 월), monthDay */
  month: number | null;
  /** kind=monthDay: 며칠 */
  day: number | null;
}

/** 말하지 않음 */
export const NO_WHEN: WhenArg = {
  kind: null,
  date: null,
  days: null,
  weekday: null,
  which: null,
  month: null,
  day: null,
};

export interface ResolveOptions {
  /** 오늘 (KST 'YYYY-MM-DD') */
  today: string;
  /** 주, 주말, 달처럼 기간인 표현에서 첫날(start, 기본)인지 끝날(end)인지 */
  edge?: 'start' | 'end';
  /**
   * 요일만 말했을 때(nearest) 오늘이 그 요일이면: 시작 시각이 지금보다 늦으면 오늘, 아니면 다음 주.
   * 둘 다 없으면(기간, 종일) 오늘을 그대로 쓴다
   */
  nowMinutes?: number;
  startMinutes?: number | null;
  /** 기간 끝처럼 이 날짜 이후여야 하는 표현(월 없이 며칠)의 기준 */
  notBefore?: string;
}

/** 월일만 말했을 때 이 날수보다 더 지난 날이면 다음 해로 본다 ("1월 5일"을 11월에 말하면 내년) */
export const MONTH_DAY_LOOKBACK_DAYS = 31;
const MAX_RELATIVE_DAYS = 730;

const OFFSET: Record<Which, number> = {
  nearest: 0,
  this: 0,
  next: 1,
  after_next: 2,
};
const pad = (n: number): string => String(n).padStart(2, '0');
const ymd = (year: number, month: number, day: number): string | null => {
  const date = `${String(year).padStart(4, '0')}-${pad(month)}-${pad(day)}`;
  return isCalendarDate(date) ? date : null;
};
const isInt = (
  value: number | null,
  min: number,
  max: number,
): value is number =>
  value !== null && Number.isInteger(value) && value >= min && value <= max;

/** 이번 주 일요일 (일요일 시작) */
export const sundayOf = (date: string): string =>
  addDays(date, -kstWeekday(date));

/** 이번 주말 [토, 일]. 오늘이 일요일이면 지금 주말(오늘 하루), 토요일이면 오늘과 내일. which 만큼 7일씩 뒤 */
export function weekendRange(today: string, which: Which): [string, string] {
  const weekday = kstWeekday(today);
  const saturday =
    weekday === 0 ? addDays(today, -1) : addDays(today, 6 - weekday);
  const offset = OFFSET[which];
  const start = addDays(saturday, offset * 7);
  return [
    offset === 0 && start < today ? today : start,
    addDays(saturday, offset * 7 + 1),
  ];
}

/** 일요일 시작 주 [일, 토] */
export function weekRange(today: string, which: Which): [string, string] {
  const sunday = addDays(sundayOf(today), OFFSET[which] * 7);
  return [sunday, addDays(sunday, 6)];
}

/** 달 [1일, 말일]. month 가 있으면 그 달(이번 달이거나 뒤면 올해, 앞이면 내년), 없으면 이번 달 + which */
export function monthRange(
  today: string,
  which: Which,
  month: number | null,
): [string, string] | null {
  const [year, current] = today.split('-').map(Number);
  let y = year;
  let m: number;
  if (month !== null) {
    if (!isInt(month, 1, 12)) return null;
    m = month;
    if (m < current) y += 1;
  } else {
    const index = current - 1 + OFFSET[which];
    y = year + Math.floor(index / 12);
    m = (index % 12) + 1;
  }
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return [ymd(y, m, 1) as string, ymd(y, m, last) as string];
}

/**
 * 요일 → 날짜. this/next/after_next 는 일요일 시작 주 안의 그 요일(지났어도), nearest 는 오늘(기간 끝이면 기간 첫날) 이후 가장 가까운 그 요일
 */
function weekdayDate(
  weekday: number,
  which: Which,
  options: ResolveOptions,
): string {
  const { today } = options;
  if (which !== 'nearest')
    return addDays(sundayOf(today), OFFSET[which] * 7 + weekday);
  const base =
    options.notBefore !== undefined && options.notBefore > today
      ? options.notBefore
      : today;
  const ahead = (weekday - kstWeekday(base) + 7) % 7;
  if (base !== today) return addDays(base, ahead);
  if (
    ahead === 0 &&
    options.nowMinutes !== undefined &&
    options.startMinutes !== undefined &&
    options.startMinutes !== null &&
    options.startMinutes <= options.nowMinutes
  ) {
    return addDays(today, 7);
  }
  return addDays(today, ahead);
}

/** 월일 → 날짜. 월이 있으면 작년, 올해, 내년 중 (기준 이후이고) 가장 이른 것. 월이 없으면 기준 이후 그 날짜가 있는 가장 가까운 달 */
function monthDayDate(
  month: number | null,
  day: number,
  options: ResolveOptions,
): string | null {
  if (!isInt(day, 1, 31)) return null;
  const year = Number(options.today.slice(0, 4));
  if (month !== null) {
    if (!isInt(month, 1, 12)) return null;
    const floor =
      options.notBefore ?? addDays(options.today, -MONTH_DAY_LOOKBACK_DAYS);
    for (const y of [year - 1, year, year + 1, year + 2]) {
      const date = ymd(y, month, day);
      if (date && date >= floor) return date;
    }
    return null;
  }
  const floor = options.notBefore ?? options.today;
  const [floorYear, floorMonth] = floor.split('-').map(Number);
  for (let i = 0; i < 13; i += 1) {
    const index = floorMonth - 1 + i;
    const date = ymd(floorYear + Math.floor(index / 12), (index % 12) + 1, day);
    if (date && date >= floor) return date;
  }
  return null;
}

/**
 * 날짜 표현 하나 → KST 날짜 'YYYY-MM-DD' (없거나 풀 수 없으면 null).
 * - date: 그대로 (요일을 함께 말해 어긋나도 날짜를 믿는다. 카드에 요일이 보인다)
 * - relativeDays: 오늘 + n
 * - weekday: 위 weekdayDate
 * - weekend, week, month: 기간의 첫날(edge start) 또는 끝날(edge end)
 * - monthDay: 위 monthDayDate
 */
export function resolveWhen(
  when: WhenArg,
  options: ResolveOptions,
): string | null {
  const edge = options.edge ?? 'start';
  const which = when.which ?? 'nearest';
  const pick = (range: [string, string] | null): string | null =>
    range ? range[edge === 'start' ? 0 : 1] : null;
  switch (when.kind) {
    case 'date':
      return when.date !== null && isCalendarDate(when.date) ? when.date : null;
    case 'relativeDays':
      return isInt(when.days, -MAX_RELATIVE_DAYS, MAX_RELATIVE_DAYS)
        ? addDays(options.today, when.days)
        : null;
    case 'weekday': {
      const weekday =
        when.weekday === null ? -1 : WEEKDAY_WORDS.indexOf(when.weekday);
      return weekday < 0 ? null : weekdayDate(weekday, which, options);
    }
    case 'weekend':
      return pick(weekendRange(options.today, which));
    case 'week':
      return pick(weekRange(options.today, which));
    case 'month':
      return pick(monthRange(options.today, which, when.month));
    case 'monthDay':
      return when.day === null
        ? null
        : monthDayDate(when.month, when.day, options);
    default:
      return null;
  }
}

/** "이번 주 X요일" 처럼 이번 주로 콕 집은 요일이 오늘보다 앞인가 (일정, 투표 초안은 되묻는다) */
export const isPastThisWeekday = (
  when: WhenArg,
  date: string,
  today: string,
): boolean => when.kind === 'weekday' && when.which === 'this' && date < today;

/**
 * 기간 표현 → 양끝 포함 KST 날짜. to 를 말하지 않으면 from 표현의 끝날(주 → 토요일, 주말 → 일요일, 하루 → 그날).
 * from 이 없으면 null
 */
export function resolvePeriod(
  from: WhenArg,
  to: WhenArg,
  today: string,
): { fromDate: string; toDate: string } | null {
  const fromDate = resolveWhen(from, { today, edge: 'start' });
  if (fromDate === null) return null;
  const toDate =
    to.kind === null
      ? resolveWhen(from, { today, edge: 'end' })
      : resolveWhen(to, { today, edge: 'end', notBefore: fromDate });
  if (toDate === null) return null;
  return { fromDate, toDate };
}
