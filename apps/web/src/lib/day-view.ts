// 폰 일 상세 (디자인규칙.md 2-3, #212, #378 C안) 의 날짜 계산과 "지금" 줄 자리. React 를 import 하지 않는다 (단위 테스트 대상)
import { addDays, dowOf, type DateKey } from "./date";
import { nextOccurrence, sortByNext, type Occurrence } from "./anniversary";
import type { Anniversary, Event } from "./types";

/** 주간 줄 7칸: 그 날이 든 주의 일요일부터 토요일까지 (달력 머리 일~토 와 같은 순서). 날짜는 KST */
export function weekStrip(date: DateKey): DateKey[] {
  const sun = addDays(date, -dowOf(date));
  return Array.from({ length: 7 }, (_, i) => addDays(sun, i));
}

/** 주간 줄을 옆으로 넘길 때: 같은 요일의 지난주(-1) / 다음 주(+1) */
export const shiftWeek = (date: DateKey, dir: 1 | -1): DateKey => addDays(date, dir * 7);

/** "14:30" → { label: "오후", value: "2:30" }. 0시는 오전 12시, 12시는 오후 12시 */
export function meridiem(hhmm: string): { label: "오전" | "오후"; value: string } {
  const [h, min] = hhmm.split(":").map(Number);
  const label = h < 12 ? "오전" : "오후";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return { label, value: `${h12}:${String(min).padStart(2, "0")}` };
}

/**
 * (#378) 일 상세 목록(C안)에서 "지금" 줄을 넣을 자리 (그 번호의 일정 앞). 목록은 groupByDay 순서(종일 → 시간 일정 시작 순).
 * 아직 시작하지 않은 첫 시간 일정 앞에 둔다. 앞에 시간 일정이 하나도 없으면(종일뿐, 또는 다 앞으로의 일정) 줄을 넣지 않는다(null).
 * 모두 지났으면 맨 끝
 */
export function nowLineIndex(events: readonly Pick<Event, "startsAt" | "allDay">[], now: number): number | null {
  const next = events.findIndex((e) => !e.allDay && Date.parse(e.startsAt) > now);
  const at = next === -1 ? events.length : next;
  return events.slice(0, at).some((e) => !e.allDay) ? at : null;
}

/** 홈 "기념일" 구역 카드: 기념일마다 다음 항목 하나(오늘 포함), 가까운 순 최대 limit 개. 다음이 없는 지난 '그날만' 은 뺀다 */
export function nextOccurrences(list: Anniversary[] | null | undefined, today: DateKey, limit = 10): Occurrence[] {
  return sortByNext(list ?? [], today)
    .map((a) => nextOccurrence(a, today))
    .filter((o): o is Occurrence => o !== null)
    .slice(0, limit);
}
