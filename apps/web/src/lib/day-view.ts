// 폰 일 상세 (디자인규칙.md 2-3, #212) 의 날짜 계산과 시각 열 표기. React 를 import 하지 않는다 (단위 테스트 대상)
import { addDays, dateKeyOf, dowOf, kstToIso, timeOf, type DateKey } from "./date";
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
 * 일정 목록 왼쪽 48px 시각 열 (라벨 11 + 값 16/700).
 * - 종일 일정, 그날을 통째로 덮는 여러 날 일정: "하루 종일" (값 없음)
 * - 그날 시작: 시작 시각 "오전 10:00"
 * - 전날부터 이어져 그날 끝남: 끝 시각 "~3:00" (라벨은 끝 시각의 오전/오후)
 */
export function timeColumn(ev: Pick<Event, "startsAt" | "endsAt" | "allDay">, date: DateKey): { label: string; value: string | null } {
  if (ev.allDay) return { label: "하루 종일", value: null };
  const dayStart = Date.parse(kstToIso(date));
  const dayEnd = Date.parse(kstToIso(addDays(date, 1)));
  const s = Date.parse(ev.startsAt);
  const e = Date.parse(ev.endsAt);
  if (s >= dayStart && dateKeyOf(ev.startsAt) === date) return meridiem(timeOf(ev.startsAt));
  if (e >= dayEnd) return { label: "하루 종일", value: null };
  const end = meridiem(timeOf(ev.endsAt));
  return { label: end.label, value: `~${end.value}` };
}

/** 홈 "기념일" 구역 카드: 기념일마다 다음 항목 하나(오늘 포함), 가까운 순 최대 limit 개. 다음이 없는 지난 '그날만' 은 뺀다 */
export function nextOccurrences(list: Anniversary[] | null | undefined, today: DateKey, limit = 10): Occurrence[] {
  return sortByNext(list ?? [], today)
    .map((a) => nextOccurrence(a, today))
    .filter((o): o is Occurrence => o !== null)
    .slice(0, limit);
}
