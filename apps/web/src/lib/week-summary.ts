// 넓은 화면(≥600) 달력 요약 카드 "이번 주 일정" 과 사이드바 묶음이 쓰는 순수 함수 (디자인규칙.md 2-2, 5, #212).
// React 를 import 하지 않는다 (단위 테스트 대상)
import { addDays, kstToIso, startOfWeek, type DateKey } from "./date";
import { eventKey } from "./recurrence";

/** 이번 주 범위(KST 달력 날짜). 주는 월요일 시작 (startOfWeek 과 같다), to 는 다음 주 월요일(포함 안 함) */
export function weekRangeOf(today: DateKey): { from: DateKey; to: DateKey } {
  const from = startOfWeek(today);
  return { from, to: addDays(from, 7) };
}

/** 이번 주 일정을 받을 조회 범위 (ISO). useEvents 에 그대로 넘긴다 */
export function weekQueryOf(today: DateKey): { from: string; to: string } {
  const { from, to } = weekRangeOf(today);
  return { from: kstToIso(from), to: kstToIso(to) };
}

/**
 * [from, to) 와 겹치는 일정 수. 같은 일정은 한 번, 반복 일정은 회차마다 따로 센다 (키 `${id}:${occurrence}`).
 * 끝이 from 과 같은 일정(전날 종일 일정 등)은 겹치지 않는다
 */
export function countEventsInRange(
  events: readonly { id: number; occurrence?: string | null; startsAt: string; endsAt: string }[] | null | undefined,
  fromIso: string,
  toIso: string,
): number {
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  const seen = new Set<string>();
  for (const e of events ?? []) {
    if (Date.parse(e.startsAt) < to && Date.parse(e.endsAt) > from) seen.add(eventKey(e));
  }
  return seen.size;
}
