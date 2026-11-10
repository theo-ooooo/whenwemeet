// 날짜 상세(DayPanel) 와 달력 개요에 쓰는 순수 계산. React 를 import 하지 않는다 (단위 테스트 대상)
import { addDays, dateKeyOf, daysBetween, dday, type DateKey } from "./date";
import { occurrencesByDay, type Occurrence } from "./anniversary";
import type { Anniversary, Event } from "./types";

export const isMultiDayAllDay = (ev: Event) => ev.allDay && daysBetween(dateKeyOf(ev.startsAt), dateKeyOf(ev.endsAt)) > 1;

/** 여러 날에 걸친 일정 (종일이든 시간이든). 끝 시각이 자정이면 그 앞날까지로 본다. 넓은 화면 칩 모양에 쓴다 (#174 L13) */
export const isMultiDay = (ev: Event) =>
  ev.allDay ? isMultiDayAllDay(ev) : dateKeyOf(ev.startsAt) !== dateKeyOf(Date.parse(ev.endsAt) - 1);

/** 날짜별 일정 (겹치는 모든 날에 넣는다). 여러 날 종일 → 종일 → 시각 순 */
export function groupByDay(events: Event[]): Map<DateKey, Event[]> {
  const map = new Map<DateKey, Event[]>();
  for (const ev of events) {
    const startKey = dateKeyOf(ev.startsAt);
    const endKeyExclusive = dateKeyOf(new Date(ev.endsAt).getTime() - 1);
    let k = startKey;
    while (k <= endKeyExclusive) {
      const arr = map.get(k) ?? [];
      arr.push(ev);
      map.set(k, arr);
      k = addDays(k, 1);
    }
  }
  const rank = (e: Event) => (isMultiDayAllDay(e) ? 0 : e.allDay ? 1 : 2);
  for (const arr of map.values()) arr.sort((a, b) => rank(a) - rank(b) || a.startsAt.localeCompare(b.startsAt));
  return map;
}

/**
 * 그날 보여 줄 기념일 항목 전부 (원래 날짜, N일, N주년, 매년. #107, 기획 3장).
 * 우선순위(N주년 > N일 > 매년/원래 날짜, 같으면 id) 순. DayPanel 은 이 결과만 그린다
 */
export function anniversariesOn(list: Anniversary[] | null | undefined, key: DateKey): Occurrence[] {
  return occurrencesByDay(list, key, key).get(key) ?? [];
}

/** 날짜 상세 기념일 줄 오른쪽 값: 오늘이면 "오늘", 아니면 오늘 기준 D-3 / D+5 */
export function dayBadge(key: DateKey, today: DateKey): string {
  const { label } = dday(key, today);
  return label === "D-day" ? "오늘" : label;
}

/** 다가오는 일정: 아직 끝나지 않은 것, 시작 순, 최대 limit 개 (같은 일정은 한 번) */
export function upcomingEvents(events: Event[] | null | undefined, nowMs: number, limit: number): Event[] {
  const seen = new Set<number>();
  return (events ?? [])
    .filter((e) => Date.parse(e.endsAt) > nowMs && !seen.has(e.id) && seen.add(e.id))
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.id - b.id)
    .slice(0, limit);
}

export type SheetMode = "half" | "full";

/**
 * 바텀 시트를 끌다 놓았을 때 갈 곳. dy 는 아래로 +px, vy 는 놓기 직전 속도(px/ms, 아래로 +).
 * 반 높이: 아래로 80px 넘게(또는 빠르게) → 닫힘, 위로 48px 넘게(또는 빠르게) → 전체.
 * 전체: 아래로 80px 넘게(또는 빠르게) → 반. 그 밖은 제자리
 */
export function sheetSnap(mode: SheetMode, dy: number, vy = 0): SheetMode | "close" {
  const fastDown = vy > 0.6;
  const fastUp = vy < -0.6;
  if (mode === "half") {
    if (dy > 80 || (fastDown && dy > 16)) return "close";
    if (dy < -48 || (fastUp && dy < -16)) return "full";
    return "half";
  }
  if (dy > 80 || (fastDown && dy > 16)) return "half";
  return "full";
}
