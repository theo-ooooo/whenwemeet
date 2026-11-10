/**
 * 반복 일정 회차 펼치기 (#187, 설계 `반복-일정.md` 3장, D-63, D-64).
 * 회차는 저장하지 않고 조회 기간만 계산한다. 일정 목록, 단건, 빈 시간 찾기가 같이 쓰는 순수 함수.
 * 날짜는 KST 달력 기준 (고정 +09:00, 한국은 서머타임이 없다). KST 날짜는 'YYYY-MM-DD' 문자열로 다룬다
 */

export type Repeat = 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY' | 'YEARLY';

export const REPEATS: readonly Repeat[] = ['WEEKLY', 'BIWEEKLY', 'MONTHLY', 'YEARLY'];

export const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
export const DAY_MS = 24 * 60 * 60 * 1000;

/** 펼치기 창 여유. 일정 길이 상한 30일 + 하루 (설계 3장) */
export const EXPANSION_MARGIN_DAYS = 31;
/** "이 일정만" 으로 회차를 옮길 수 있는 범위. 원래 회차 날짜 앞뒤 30일 (설계 4-1) */
export const EXCEPTION_SHIFT_DAYS = 30;

/** 주기별 일정 길이 상한 (이 값 이상이면 거부, 기획 3-1, 설계 4-1) */
export const REPEAT_PERIOD_DAYS: Record<Repeat, number> = { WEEKLY: 7, BIWEEKLY: 14, MONTHLY: 28, YEARLY: 365 };

/** 원본 일정의 반복 규칙 */
export interface SeriesRule {
  startsAt: Date;
  endsAt: Date;
  allDay: boolean;
  repeat: Repeat;
  /** KST 날짜 'YYYY-MM-DD'. 그날 시작하는 회차까지 포함. null 이면 계속 */
  repeatUntil: string | null;
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
}

export interface Occurrence {
  /** 원래 회차 날짜 (KST). 예외로 옮겨도 그대로 */
  occurrence: string;
  startsAt: Date;
  endsAt: Date;
  allDay: boolean;
  /** 예외로 바꾼 제목/메모. 없으면 원본 값을 쓴다 */
  title?: string;
  memo?: string;
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

/** k 번째 회차의 원래 날짜 번호 (k >= 0). 기준은 항상 첫 회차 날짜 d0 */
function nthOccurrenceDay(repeat: Repeat, d0: number, k: number): number {
  switch (repeat) {
    case 'WEEKLY':
      return d0 + 7 * k;
    case 'BIWEEKLY':
      return d0 + 14 * k;
    case 'MONTHLY': {
      const { y, m, d } = ymd(d0);
      const total = m + k;
      return clampedDay(y + Math.floor(total / 12), total % 12, d);
    }
    case 'YEARLY': {
      const { y, m, d } = ymd(d0);
      return clampedDay(y + k, m, d);
    }
  }
}

/**
 * [lo, hi] (날짜 번호, 양끝 포함) 에 들 수 있는 k 범위. 루프 없이 바로 계산한다 (기념일 D-60 방식).
 * MONTHLY/YEARLY 는 말일 보정 때문에 경계 달/해가 범위 밖일 수 있어 호출자가 날짜로 한 번 더 거른다
 */
function kRange(repeat: Repeat, d0: number, lo: number, hi: number): [number, number] {
  if (repeat === 'WEEKLY' || repeat === 'BIWEEKLY') {
    const step = repeat === 'WEEKLY' ? 7 : 14;
    return [Math.max(0, Math.ceil((lo - d0) / step)), Math.floor((hi - d0) / step)];
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
  const day = dateToDay(date);
  if (day < d0) return false;
  if (series.repeatUntil !== null && day > dateToDay(series.repeatUntil)) return false;
  const [kMin, kMax] = kRange(series.repeat, d0, day, day);
  for (let k = kMin; k <= kMax; k += 1) {
    if (nthOccurrenceDay(series.repeat, d0, k) === day) return true;
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
 * 1. 원래 회차 날짜를 [from - 31일, to + 31일) 에서 k 범위로 바로 구한다
 * 2. 시각 = 그 날짜 + 원본 벽시계 시각, 끝 = 시작 + 원본 길이
 * 3. repeatUntil 이후 날짜는 뺀다
 * 4. 예외 적용 (cancelled 는 빼고 나머지는 덮는다)
 * 5. 최종 시각이 [from, to) 와 겹치는 것만, startsAt 오름차순
 */
export function expand(series: SeriesRule, exceptions: readonly ExceptionRule[], from: Date, to: Date): Occurrence[] {
  const d0 = kstDayNumber(series.startsAt);
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
    const day = nthOccurrenceDay(series.repeat, d0, k);
    if (day < lo || day > hi) continue;
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
