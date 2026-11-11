// API_MOCK 전용 반복 회차 펼치기 (#187). 서버 apps/api/src/events/recurrence.ts 의 규칙을 ISO 문자열로 옮긴 것.
// 화면을 눌러 보는 데 필요한 만큼만: 주기 4종, 말일 보정, 반복 기준 날짜(D-71), repeatUntil, 예외(취소, 값 덮기)
import { addDays, dateKeyOf, daysBetween, daysInMonth, kstToIso, parseKey, keyOf } from "@/lib/date";
import type { EventReminder, Repeat } from "@/lib/types";

const DAY_MS = 86_400_000;
const MARGIN_DAYS = 31;

export type MockException = {
  occurrence: string;
  cancelled: boolean;
  title?: string | null;
  startsAt?: string | null;
  endsAt?: string | null;
  allDay?: boolean | null;
  memo?: string | null;
  /** (#188) 이 회차의 알림. null/없음 이면 원본 값 */
  reminder?: EventReminder | null;
};

export type MockSeries = {
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  repeat: Repeat;
  repeatUntil: string | null;
  /** (#228) 반복 기준 날짜. 매월은 일, 매년은 월일. 없으면 첫 회차 날짜 (D-71) */
  repeatAnchor?: string | null;
};

export type MockOccurrence = {
  occurrence: string;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  title?: string;
  memo?: string;
  reminder?: EventReminder;
};

/** k 번째 회차의 원래 날짜 (첫 회차 d0 의 연월에서 k, 날짜는 기준 anchor 의 일/월일, 없는 날은 말일) */
function nth(repeat: Repeat, d0: string, k: number, anchor: string = d0): string {
  if (repeat === "WEEKLY") return addDays(d0, 7 * k);
  if (repeat === "BIWEEKLY") return addDays(d0, 14 * k);
  const { y, m } = parseKey(d0);
  const a = parseKey(anchor);
  const d = a.d;
  const idx = repeat === "MONTHLY" ? y * 12 + (m - 1) + k : (y + k) * 12 + (a.m - 1);
  const ny = Math.floor(idx / 12);
  const nm = (idx % 12) + 1;
  return keyOf(ny, nm, Math.min(d, daysInMonth(ny, nm)));
}

/** 원래 날짜 [lo, hi] 안의 회차 날짜들 */
function datesBetween(s: MockSeries, lo: string, hi: string): string[] {
  const d0 = dateKeyOf(s.startsAt);
  const last = s.repeatUntil && s.repeatUntil < hi ? s.repeatUntil : hi;
  const first = lo > d0 ? lo : d0;
  if (first > last) return [];
  const out: string[] = [];
  const step = s.repeat === "WEEKLY" ? 7 : s.repeat === "BIWEEKLY" ? 14 : 0;
  let k = 0;
  if (step) k = Math.max(0, Math.floor(daysBetween(d0, first) / step));
  else {
    const a = parseKey(d0);
    const b = parseKey(first);
    k = Math.max(0, s.repeat === "MONTHLY" ? (b.y - a.y) * 12 + (b.m - a.m) - 1 : b.y - a.y - 1);
  }
  for (; ; k += 1) {
    const day = nth(s.repeat, d0, k, s.repeatAnchor ?? d0);
    if (day > last) break;
    if (day >= first) out.push(day);
  }
  return out;
}

export function isOccurrenceDate(s: MockSeries, date: string): boolean {
  return datesBetween(s, date, date).length === 1;
}

/** 원래 회차 (예외 적용 전). 시각은 원본 KST 벽시계 시각, 길이는 원본 길이 */
export function originalOccurrence(s: MockSeries, date: string): MockOccurrence {
  const offset = Date.parse(s.startsAt) - Date.parse(kstToIso(dateKeyOf(s.startsAt)));
  const start = Date.parse(kstToIso(date)) + offset;
  const len = Date.parse(s.endsAt) - Date.parse(s.startsAt);
  return { occurrence: date, startsAt: new Date(start).toISOString(), endsAt: new Date(start + len).toISOString(), allDay: s.allDay };
}

export function applyException(o: MockOccurrence, x: MockException | undefined): MockOccurrence | null {
  if (!x) return o;
  if (x.cancelled) return null;
  const r: MockOccurrence = {
    occurrence: o.occurrence,
    startsAt: x.startsAt ?? o.startsAt,
    endsAt: x.endsAt ?? o.endsAt,
    allDay: x.allDay ?? o.allDay,
  };
  if (x.title != null) r.title = x.title;
  if (x.memo != null) r.memo = x.memo;
  if (x.reminder != null) r.reminder = x.reminder;
  return r;
}

/** [from, to) 와 겹치는 회차 (예외 반영) */
export function expand(s: MockSeries, exceptions: MockException[], fromMs: number, toMs: number): MockOccurrence[] {
  const lo = dateKeyOf(fromMs - MARGIN_DAYS * DAY_MS);
  const hi = dateKeyOf(toMs + MARGIN_DAYS * DAY_MS - 1);
  const byDate = new Map(exceptions.map((x) => [x.occurrence, x]));
  return datesBetween(s, lo, hi)
    .map((d) => applyException(originalOccurrence(s, d), byDate.get(d)))
    .filter((o): o is MockOccurrence => o !== null && Date.parse(o.startsAt) < toMs && Date.parse(o.endsAt) > fromMs)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}
