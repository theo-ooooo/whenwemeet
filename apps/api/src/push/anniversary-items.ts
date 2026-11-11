/**
 * 기념일 그날 항목 (#188, 설계 푸시-알림.md 5-5, D-92). 웹 `apps/web/src/lib/anniversary.ts` 의
 * `occurrencesInRange(a, D, D)` 를 서버로 옮긴 순수 함수 (D-59, D-60, D-62 규칙 그대로).
 * 날짜는 KST 달력 날짜 'YYYY-MM-DD'
 */
import { addDays, dateToDay } from '../events/recurrence.js';

export type AnniversaryKind = 'COUNT_UP' | 'YEARLY' | 'ONCE';

/** ORIGINAL = 등록한 날짜, DAYS = N일, YEARS = N주년, YEARLY = 매년 돌아오는 날 */
export type AnniversaryItemType = 'ORIGINAL' | 'DAYS' | 'YEARS' | 'YEARLY';

export interface AnniversaryLike {
  /** 'YYYY-MM-DD' */
  date: string;
  kind: AnniversaryKind;
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
export function sameDayInYear(start: string, y: number): string {
  const { m, d } = parseKey(start);
  return `${String(y).padStart(4, '0')}-${pad(m)}-${pad(m === 2 && d === 29 && !isLeap(y) ? 28 : d)}`;
}

/** 시작일을 1일로 센 그날의 번호. N일 = 시작일 + (N - 1)일 */
export function dayNumber(start: string, key: string): number {
  return dateToDay(key) - dateToDay(start) + 1;
}

/** 날짜 `day` 의 항목. 우선순위 순 (첫 항목이 알림 문구) */
export function anniversaryItemsOn(a: AnniversaryLike, day: string): AnniversaryItem[] {
  const out: AnniversaryItem[] = [];
  const start = a.date;
  if (day === start) out.push({ type: 'ORIGINAL', n: null, label: null });

  if (a.kind === 'COUNT_UP') {
    const n = dayNumber(start, day);
    if (DAY_MILESTONES.includes(n) && addDays(start, n - 1) === day) out.push({ type: 'DAYS', n, label: `${n}일` });
  }

  if (a.kind === 'COUNT_UP' || a.kind === 'YEARLY') {
    const sy = parseKey(start).y;
    const y = parseKey(day).y;
    const n = y - sy;
    if (n >= 1 && !(a.kind === 'COUNT_UP' && n > MAX_YEARS) && sameDayInYear(start, y) === day) {
      out.push(a.kind === 'COUNT_UP' ? { type: 'YEARS', n, label: `${n}주년` } : { type: 'YEARLY', n: null, label: null });
    }
  }

  return out.sort((x, y) => RANK[x.type] - RANK[y.type]);
}
