/**
 * 빈 시간 계산 순수 함수 (api.md 2.5 쿼리 전략 4~6단계).
 * 날짜 창은 고정 +09:00 (KST, DST 없음) 으로 자른다.
 */

export interface Interval {
  startsAt: Date;
  endsAt: Date;
}

export const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
/** 응답 상한 (결정기록 D-13) */
export const MAX_SLOTS = 100;

/** `HH:mm` → 자정 기준 분. 형식이 틀리면 null */
export function parseHHmm(value: string): number | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

/** startsAt 오름차순으로 정렬된 구간을 한 번 훑어 겹치거나 맞닿은 것을 병합 */
export function mergeIntervals(sorted: readonly Interval[]): Interval[] {
  const merged: Interval[] = [];
  for (const interval of sorted) {
    const last = merged[merged.length - 1];
    if (last && interval.startsAt.getTime() <= last.endsAt.getTime()) {
      if (interval.endsAt.getTime() > last.endsAt.getTime()) last.endsAt = interval.endsAt;
      continue;
    }
    merged.push({ startsAt: interval.startsAt, endsAt: interval.endsAt });
  }
  return merged;
}

/**
 * [from, to) 를 KST 날짜별로 나눠 각 날의 [dayStart, dayEnd) 창을 만든다. 창은 [from, to) 로 잘라낸다.
 * dayStartMin/dayEndMin 은 자정 기준 분. 호출자가 dayStart < dayEnd 를 보장한다
 */
export function buildDayWindows(from: Date, to: Date, dayStartMin: number, dayEndMin: number): Interval[] {
  const windows: Interval[] = [];
  const fromMs = from.getTime();
  const toMs = to.getTime();
  if (toMs <= fromMs) return windows;

  // KST 로 옮긴 시각의 "UTC 날짜 번호" 가 곧 KST 날짜 번호
  const firstDay = Math.floor((fromMs + KST_OFFSET_MS) / DAY_MS);
  const lastDay = Math.floor((toMs - 1 + KST_OFFSET_MS) / DAY_MS);

  for (let day = firstDay; day <= lastDay; day += 1) {
    const kstMidnightUtc = day * DAY_MS - KST_OFFSET_MS;
    const start = Math.max(kstMidnightUtc + dayStartMin * MINUTE_MS, fromMs);
    const end = Math.min(kstMidnightUtc + dayEndMin * MINUTE_MS, toMs);
    if (start < end) windows.push({ startsAt: new Date(start), endsAt: new Date(end) });
  }
  return windows;
}

/** 각 창에서 병합된 busy 를 빼고 길이 >= minMinutes 인 조각만 남긴다. busy 는 병합되어 정렬된 상태 */
export function subtractBusy(windows: readonly Interval[], busy: readonly Interval[], minMinutes: number): Interval[] {
  const minMs = minMinutes * MINUTE_MS;
  const free: Interval[] = [];
  let busyIndex = 0;

  for (const window of windows) {
    const windowStart = window.startsAt.getTime();
    const windowEnd = window.endsAt.getTime();
    let cursor = windowStart;

    // 창 시작 이전에 끝난 busy 는 건너뛴다 (창도 busy 도 정렬돼 있어 되돌아갈 일이 없다)
    while (busyIndex < busy.length && busy[busyIndex].endsAt.getTime() <= windowStart) busyIndex += 1;

    for (let i = busyIndex; i < busy.length; i += 1) {
      const busyStart = busy[i].startsAt.getTime();
      const busyEnd = busy[i].endsAt.getTime();
      if (busyStart >= windowEnd) break;
      if (busyStart > cursor) pushIfLongEnough(free, cursor, Math.min(busyStart, windowEnd), minMs);
      cursor = Math.max(cursor, busyEnd);
      if (cursor >= windowEnd) break;
    }
    if (cursor < windowEnd) pushIfLongEnough(free, cursor, windowEnd, minMs);
  }
  return free;
}

function pushIfLongEnough(target: Interval[], start: number, end: number, minMs: number): void {
  if (end - start >= minMs) target.push({ startsAt: new Date(start), endsAt: new Date(end) });
}

export interface FindFreeSlotsInput {
  from: Date;
  to: Date;
  dayStartMin: number;
  dayEndMin: number;
  minMinutes: number;
  /** startsAt 오름차순 */
  busy: readonly Interval[];
  limit?: number;
}

/** 4~6단계 한 번에. 결과는 startsAt 오름차순, 최대 limit 개 */
export function findFreeSlots(input: FindFreeSlotsInput): Interval[] {
  const merged = mergeIntervals(input.busy);
  const windows = buildDayWindows(input.from, input.to, input.dayStartMin, input.dayEndMin);
  return subtractBusy(windows, merged, input.minMinutes).slice(0, input.limit ?? MAX_SLOTS);
}
