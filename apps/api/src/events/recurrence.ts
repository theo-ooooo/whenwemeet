/**
 * 반복 일정 회차 펼치기 (#187, 설계 `반복-일정.md` 3장, D-63, D-64).
 * 회차는 저장하지 않고 조회 기간만 계산한다. 일정 목록, 단건, 빈 시간 찾기가 같이 쓰는 순수 함수.
 * 날짜는 KST 달력 기준 (고정 +09:00, 한국은 서머타임이 없다). KST 날짜는 'YYYY-MM-DD' 문자열로 다룬다
 */
import { LUNAR_MAX_YEAR, lunarOccurrence, solarToLunar } from '../common/lunar.js';
import type { PlaceValue } from './place.js';

export type Repeat = 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY' | 'YEARLY' | 'YEARLY_LUNAR';

export const REPEATS: readonly Repeat[] = ['WEEKLY', 'BIWEEKLY', 'MONTHLY', 'YEARLY', 'YEARLY_LUNAR'];

export const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
export const DAY_MS = 24 * 60 * 60 * 1000;

/** 펼치기 창 여유. 일정 길이 상한 30일 + 하루 (설계 3장) */
export const EXPANSION_MARGIN_DAYS = 31;
/** "이 일정만" 으로 회차를 옮길 수 있는 범위. 원래 회차 날짜 앞뒤 30일 (설계 4-1) */
export const EXCEPTION_SHIFT_DAYS = 30;

/** 주기별 일정 길이 상한 (이 값 이상이면 거부, 기획 3-1, 설계 4-1) */
/** (#562) 매년(음력) 은 윤달 기준이 다음 해 평달로 가면 회차 간격이 300일 남짓까지 줄어 300 (일정 길이 상한 30일이라 실제로 막히지 않는다) */
export const REPEAT_PERIOD_DAYS: Record<Repeat, number> = { WEEKLY: 7, BIWEEKLY: 14, MONTHLY: 28, YEARLY: 365, YEARLY_LUNAR: 300 };

/** 원본 일정의 반복 규칙 */
export interface SeriesRule {
  startsAt: Date;
  endsAt: Date;
  allDay: boolean;
  repeat: Repeat;
  /** KST 날짜 'YYYY-MM-DD'. 그날 시작하는 회차까지 포함. null 이면 계속 */
  repeatUntil: string | null;
  /**
   * (#228, D-71) 반복 기준 날짜 'YYYY-MM-DD' (KST). MONTHLY 는 이 날짜의 일, YEARLY 는 월일로 회차 날짜를 정한다.
   * (#562) YEARLY_LUNAR 는 이 날짜의 음력 월일(윤달 포함)로 정한다.
   * 생략/null 이면 startsAt 의 KST 날짜. WEEKLY/BIWEEKLY 는 무시한다
   */
  repeatAnchor?: string | null;
}

/** 회차 하나의 예외 (D-65). null 은 원본 값 */
export interface ExceptionRule {
  occurrence: string;
  cancelled: boolean;
  title?: string | null;
  startsAt?: Date | null;
  endsAt?: Date | null;
  allDay?: boolean | null;
  memo?: string | null;
  /** (#188) 이 회차의 알림. null 이면 원본 값 (펼치기 규칙과 무관, 그대로 전달만) */
  reminder?: EventReminderValue | null;
  /** (#199) 이 회차의 장소. null 이면 원본 값, CLEARED_PLACE(text '') 면 이 회차만 장소 없음 (펼치기 규칙과 무관, 그대로 전달만) */
  place?: PlaceValue | null;
}

/** (#188) 일정 알림 값 (push/remind-at.ts 의 EventReminder 와 같은 집합) */
export type EventReminderValue = 'NONE' | 'AT_START' | 'MIN_10' | 'HOUR_1' | 'DAY_1' | 'DAY_OF_0900' | 'DAY_BEFORE_0900';

export interface Occurrence {
  /** 원래 회차 날짜 (KST). 예외로 옮겨도 그대로 */
  occurrence: string;
  startsAt: Date;
  endsAt: Date;
  allDay: boolean;
  /** 예외로 바꾼 제목/메모. 없으면 원본 값을 쓴다 */
  title?: string;
  memo?: string;
  /** (#188) 예외로 바꾼 알림. 없으면 원본 값을 쓴다 */
  reminder?: EventReminderValue;
  /** (#199) 예외로 바꾼 장소 (CLEARED_PLACE 는 이 회차만 없음). 없으면 원본 값을 쓴다 */
  place?: PlaceValue;
  /** 예외가 적용된 회차인지 */
  exception: boolean;
}

// ---------- KST 날짜 계산 ----------

/** 1970-01-01 부터 센 KST 날짜 번호 */
export function kstDayNumber(instant: Date): number {
  return Math.floor((instant.getTime() + KST_OFFSET_MS) / DAY_MS);
}

/** KST 날짜 'YYYY-MM-DD' */
export function kstDate(instant: Date): string {
  return dayToDate(kstDayNumber(instant));
}

/** KST 날짜 그날 00:00 (UTC 순간) */
export function kstMidnight(date: string): Date {
  return new Date(dateToDay(date) * DAY_MS - KST_OFFSET_MS);
}

/** 'YYYY-MM-DD' → 날짜 번호 */
export function dateToDay(date: string): number {
  return Math.floor(Date.parse(`${date}T00:00:00.000Z`) / DAY_MS);
}

/** 날짜 번호 → 'YYYY-MM-DD' */
export function dayToDate(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

/** 날짜 문자열에 일 수를 더한다 */
export function addDays(date: string, days: number): string {
  return dayToDate(dateToDay(date) + days);
}

function ymd(day: number): { y: number; m: number; d: number } {
  const date = new Date(day * DAY_MS);
  return { y: date.getUTCFullYear(), m: date.getUTCMonth(), d: date.getUTCDate() };
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
}

/** y년 m월(0부터)의 day 일. 그 날짜가 없으면 말일 (D-64: 31일 → 4월 30일, 2/29 → 평년 2/28) */
function clampedDay(y: number, m: number, day: number): number {
  return Math.floor(Date.UTC(y, m, Math.min(day, daysInMonth(y, m))) / DAY_MS);
}

/** 규칙의 기준 날짜 번호. repeatAnchor 가 없으면 첫 회차 날짜 (D-71) */
function anchorDay(series: Pick<SeriesRule, 'startsAt' | 'repeatAnchor'>): number {
  return series.repeatAnchor ? dateToDay(series.repeatAnchor) : kstDayNumber(series.startsAt);
}

/**
 * (#562, D-297) 매년(음력) k 번째 회차: 첫 회차 날짜 d0 의 음력 해 + k 에서 기준 날짜의 음력 월일.
 * 윤달 기준은 그해에 그 윤달이 없으면 평달, 그 달에 없는 30일은 그 달 마지막 날 (common/lunar.ts lunarOccurrence).
 * 변환 범위(음력 2050년) 밖이면 null
 */
function lunarNthDay(d0: number, k: number, anchor: number): number | null {
  const first = solarToLunar(dayToDate(d0));
  const base = solarToLunar(dayToDate(anchor));
  if (!first || !base) return null;
  const date = lunarOccurrence(first.year + k, base.month, base.day, base.leap);
  return date === null ? null : dateToDay(date);
}

/**
 * k 번째 회차의 원래 날짜 번호 (k >= 0). 주간은 첫 회차 날짜 d0 에서 7, 14일씩.
 * 매월/매년은 d0 의 연월(연)에서 k 만큼 간 달(해)의 기준 날짜 일(월일), 없으면 말일 (D-64, D-71).
 * (#562) 매년(음력)은 음력 해로 센다. 변환 범위 밖이면 null (그 회차 없음)
 */
function nthOccurrenceDay(repeat: Repeat, d0: number, k: number, anchor: number = d0): number | null {
  switch (repeat) {
    case 'WEEKLY':
      return d0 + 7 * k;
    case 'BIWEEKLY':
      return d0 + 14 * k;
    case 'MONTHLY': {
      const { y, m } = ymd(d0);
      const total = m + k;
      return clampedDay(y + Math.floor(total / 12), total % 12, ymd(anchor).d);
    }
    case 'YEARLY': {
      const a = ymd(anchor);
      return clampedDay(ymd(d0).y + k, a.m, a.d);
    }
    case 'YEARLY_LUNAR':
      return lunarNthDay(d0, k, anchor);
  }
}

/**
 * 기준 날짜가 시작 날짜와 맞는지 (D-71). 매월은 시작 달의 기준 일(말일 보정), 매년은 시작 해의 기준 월일(2/29 → 평년 2/28) 이
 * 시작 날짜와 같아야 한다. (#562) 매년(음력)은 시작 음력 해의 기준 음력 월일. 주간이나 기준 날짜가 없으면 항상 true
 */
export function anchorMatchesStart(repeat: Repeat, startsAt: Date, repeatAnchor: string | null): boolean {
  if (repeatAnchor === null || repeat === 'WEEKLY' || repeat === 'BIWEEKLY') return true;
  const d0 = kstDayNumber(startsAt);
  return nthOccurrenceDay(repeat, d0, 0, dateToDay(repeatAnchor)) === d0;
}

/**
 * [lo, hi] (날짜 번호, 양끝 포함) 에 들 수 있는 k 범위. 루프 없이 바로 계산한다 (기념일 D-60 방식).
 * MONTHLY/YEARLY 는 말일 보정 때문에 경계 달/해가 범위 밖일 수 있어 호출자가 날짜로 한 번 더 거른다.
 * (#562) YEARLY_LUNAR 는 음력 해 차이 (음력 해 L 의 회차는 언제나 음력 해 L 안의 날짜다)
 */
function kRange(repeat: Repeat, d0: number, lo: number, hi: number): [number, number] {
  if (repeat === 'WEEKLY' || repeat === 'BIWEEKLY') {
    const step = repeat === 'WEEKLY' ? 7 : 14;
    return [Math.max(0, Math.ceil((lo - d0) / step)), Math.floor((hi - d0) / step)];
  }
  if (repeat === 'YEARLY_LUNAR') {
    const first = solarToLunar(dayToDate(d0));
    const l = solarToLunar(dayToDate(lo));
    // 범위 밖(양력 2050년 뒤)은 음력 마지막 해로 본다. 그 뒤 회차는 lunarNthDay 가 null
    const h = solarToLunar(dayToDate(hi)) ?? { year: LUNAR_MAX_YEAR };
    if (!first || !l) return [0, -1];
    return [Math.max(0, l.year - first.year), h.year - first.year];
  }
  const a = ymd(d0);
  const l = ymd(lo);
  const h = ymd(hi);
  if (repeat === 'MONTHLY') {
    const base = a.y * 12 + a.m;
    return [Math.max(0, l.y * 12 + l.m - base), h.y * 12 + h.m - base];
  }
  return [Math.max(0, l.y - a.y), h.y - a.y];
}

/** date 가 이 규칙의 원래 회차 날짜인지 (repeatUntil 포함 검사) */
export function isOccurrenceDate(series: SeriesRule, date: string): boolean {
  const d0 = kstDayNumber(series.startsAt);
  const anchor = anchorDay(series);
  const day = dateToDay(date);
  if (day < d0) return false;
  if (series.repeatUntil !== null && day > dateToDay(series.repeatUntil)) return false;
  const [kMin, kMax] = kRange(series.repeat, d0, day, day);
  for (let k = kMin; k <= kMax; k += 1) {
    if (nthOccurrenceDay(series.repeat, d0, k, anchor) === day) return true;
  }
  return false;
}

/** 원래 회차 날짜의 시각 (예외 적용 전). 시각은 원본의 KST 벽시계 시각, 길이는 원본 길이 */
export function originalOccurrence(series: SeriesRule, date: string): Occurrence {
  const offset = series.startsAt.getTime() - kstMidnight(kstDate(series.startsAt)).getTime();
  const startsAt = new Date(kstMidnight(date).getTime() + offset);
  const endsAt = new Date(startsAt.getTime() + (series.endsAt.getTime() - series.startsAt.getTime()));
  return { occurrence: date, startsAt, endsAt, allDay: series.allDay, exception: false };
}

/** 예외를 덮은 회차. cancelled 면 null */
export function applyException(original: Occurrence, exception: ExceptionRule | undefined): Occurrence | null {
  if (!exception) return original;
  if (exception.cancelled) return null;
  const result: Occurrence = {
    occurrence: original.occurrence,
    startsAt: exception.startsAt ?? original.startsAt,
    endsAt: exception.endsAt ?? original.endsAt,
    allDay: exception.allDay ?? original.allDay,
    exception: true,
  };
  if (exception.title != null) result.title = exception.title;
  if (exception.memo != null) result.memo = exception.memo;
  if (exception.reminder != null) result.reminder = exception.reminder;
  if (exception.place != null) result.place = exception.place;
  return result;
}

/** 펼치기에 쓰는 원래 날짜 창 [from - 31일, to + 31일) 을 날짜 번호(양끝 포함)로 */
function expansionDays(from: Date, to: Date): [number, number] {
  const margin = EXPANSION_MARGIN_DAYS * DAY_MS;
  return [kstDayNumber(new Date(from.getTime() - margin)), kstDayNumber(new Date(to.getTime() + margin - 1))];
}

/**
 * 조회 기간 후보 원본을 고르는 DB 조건 (설계 4-2). 첫 회차 시작 < to + 31일,
 * repeatUntil 이 없거나 from - 31일 의 KST 날짜 이후
 */
export function seriesCandidateWindow(from: Date, to: Date): { startsBefore: Date; untilOnOrAfter: string } {
  const [lo] = expansionDays(from, to);
  return { startsBefore: new Date(to.getTime() + EXPANSION_MARGIN_DAYS * DAY_MS), untilOnOrAfter: dayToDate(lo) };
}

/**
 * 원본 하나를 [from, to) 에 겹치는 회차로 펼친다 (설계 3장 1~5단계).
 * 1. 원래 회차 날짜를 [from - 31일, to + 31일) 에서 k 범위로 바로 구한다 (매월/매년 날짜는 기준 날짜, D-71)
 * 2. 시각 = 그 날짜 + 원본 벽시계 시각, 끝 = 시작 + 원본 길이
 * 3. repeatUntil 이후 날짜는 뺀다
 * 4. 예외 적용 (cancelled 는 빼고 나머지는 덮는다)
 * 5. 최종 시각이 [from, to) 와 겹치는 것만, startsAt 오름차순
 */
export function expand(series: SeriesRule, exceptions: readonly ExceptionRule[], from: Date, to: Date): Occurrence[] {
  const d0 = kstDayNumber(series.startsAt);
  const anchor = anchorDay(series);
  const [windowLo, windowHi] = expansionDays(from, to);
  const lo = Math.max(windowLo, d0);
  const hi = series.repeatUntil === null ? windowHi : Math.min(windowHi, dateToDay(series.repeatUntil));
  if (lo > hi) return [];

  const byDate = new Map(exceptions.map((exception) => [exception.occurrence, exception]));
  const fromMs = from.getTime();
  const toMs = to.getTime();
  const result: Occurrence[] = [];
  const [kMin, kMax] = kRange(series.repeat, d0, lo, hi);
  for (let k = kMin; k <= kMax; k += 1) {
    const day = nthOccurrenceDay(series.repeat, d0, k, anchor);
    if (day === null || day < lo || day > hi) continue;
    const date = dayToDate(day);
    const occurrence = applyException(originalOccurrence(series, date), byDate.get(date));
    if (occurrence && occurrence.startsAt.getTime() < toMs && occurrence.endsAt.getTime() > fromMs) result.push(occurrence);
  }
  return result.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
}

/** 일정 길이가 주기보다 짧은지 (기획 3-1) */
export function fitsInPeriod(repeat: Repeat, startsAt: Date, endsAt: Date): boolean {
  return endsAt.getTime() - startsAt.getTime() < REPEAT_PERIOD_DAYS[repeat] * DAY_MS;
}

/** 예외 시각이 원래 회차 날짜 앞뒤 30일 안인지 (설계 4-1). 시작 >= 그날 00:00 - 30일, 끝 <= 다음 날 00:00 + 30일 */
export function withinShiftLimit(occurrence: string, startsAt: Date, endsAt: Date): boolean {
  const limit = EXCEPTION_SHIFT_DAYS * DAY_MS;
  const dayStart = kstMidnight(occurrence).getTime();
  return startsAt.getTime() >= dayStart - limit && endsAt.getTime() <= dayStart + DAY_MS + limit;
}
