// "다가오는 일정" 목록 화면(/upcoming, #222) 의 묶음과 표기. React 를 import 하지 않는다 (단위 테스트 대상)
// - 30일 창 단위로 받는다 (api.md 2.3 한 번에 62일까지). 창 i = [오늘 + 30i, 오늘 + 30(i+1))
// - 일정은 **시작한 날 하나에만** 둔다 (여러 날 일정은 시각 글자에 "~11월 14일"). 이미 시작해 진행 중인 것은 오늘에
//   → 같은 일정이 두 창에 걸쳐 와도 묶이는 날은 하나라서 창끼리 겹치지 않는다
// - 기념일 항목(N일, N주년, 매년, 원래 날짜)은 그날 묶음의 일정 앞 줄로 넣는다 (기념일만 있는 날도 묶음이 생긴다)
import { addDays, dateKeyOf, dowOf, parseKey, timeOf, WEEKDAYS, type DateKey } from "./date";
import { occurrencesByDay, type Occurrence } from "./anniversary";
import { holidayOf } from "./holidays";
import { eventKey } from "./recurrence";
import type { Anniversary, Event } from "./types";

export const UPCOMING_WINDOW_DAYS = 30;

/** 창 i 의 범위. to 는 그날을 빼는 끝 (KST 자정) */
export function upcomingWindow(today: DateKey, index: number): { from: DateKey; to: DateKey } {
  return { from: addDays(today, index * UPCOMING_WINDOW_DAYS), to: addDays(today, (index + 1) * UPCOMING_WINDOW_DAYS) };
}

export type UpcomingDay = {
  date: DateKey;
  /** 왼쪽 48px 열 위 라벨: "오늘", "내일", 그 밖은 요일 "목" */
  label: string;
  /** 왼쪽 열 값: 날짜 숫자 */
  day: number;
  tone: "today" | "holiday" | "plain";
  anniversaries: Occurrence[];
  events: Event[];
};

/** 묶는 날: 시작한 날, 이미 시작했으면 오늘 */
export function upcomingDayOf(ev: Pick<Event, "startsAt">, today: DateKey): DateKey {
  const start = dateKeyOf(ev.startsAt);
  return start < today ? today : start;
}

export function dayLabel(date: DateKey, today: DateKey): string {
  if (date === today) return "오늘";
  if (date === addDays(today, 1)) return "내일";
  return WEEKDAYS[dowOf(date)];
}

/** 마지막 날 (KST). 종일은 끝 자정 앞날, 시간 일정은 끝 시각 바로 앞 순간의 날 (자정에 끝나면 그 앞날) */
export function lastDayOf(ev: Pick<Event, "startsAt" | "endsAt" | "allDay">): DateKey {
  const end = ev.allDay ? addDays(dateKeyOf(ev.endsAt), -1) : dateKeyOf(Date.parse(ev.endsAt) - 1);
  const start = dateKeyOf(ev.startsAt);
  return end < start ? start : end;
}

const md = (k: DateKey) => {
  const p = parseKey(k);
  return `${p.m}월 ${p.d}일`;
};

/**
 * 행의 시각 글자 (묶인 날 기준).
 * - 종일 하루: "종일" / 여러 날: "종일, ~11월 14일"
 * - 시간 같은 날: "10:00~11:00" / 여러 날: "22:00~11월 14일 02:00"
 * - 오늘 전에 시작해 진행 중: "~18:00" (오늘 끝남) / "~11월 14일 02:00"
 */
export function upcomingTimeText(ev: Pick<Event, "startsAt" | "endsAt" | "allDay">, day: DateKey): string {
  const last = lastDayOf(ev);
  const started = dateKeyOf(ev.startsAt) < day;
  if (ev.allDay) return last > day ? `종일, ~${md(last)}` : "종일";
  const endText = last > day ? `${md(last)} ${timeOf(ev.endsAt)}` : timeOf(ev.endsAt);
  return started ? `~${endText}` : `${timeOf(ev.startsAt)}~${endText}`;
}

// 같은 날 안의 순서: 여러 날 종일 → 종일 → 시간 (groupByDay 와 같은 규칙), 그다음 시작 순
const rank = (e: Event) => (e.allDay ? (lastDayOf(e) > dateKeyOf(e.startsAt) ? 0 : 1) : 2);

/**
 * 창 하나의 날짜 묶음. 끝난 일정(endsAt <= now)은 뺀다. 같은 회차가 두 번 와도 한 번.
 * 일정이나 기념일이 있는 날만, 날짜 오름차순
 */
export function groupUpcoming(
  events: Event[] | null | undefined,
  anniversaries: Anniversary[] | null | undefined,
  range: { from: DateKey; to: DateKey },
  today: DateKey,
  nowMs: number,
): UpcomingDay[] {
  const byDay = new Map<DateKey, Event[]>();
  const seen = new Set<string>();
  for (const ev of events ?? []) {
    const k = eventKey(ev);
    if (seen.has(k) || Date.parse(ev.endsAt) <= nowMs) continue;
    seen.add(k);
    const day = upcomingDayOf(ev, today);
    if (day < range.from || day >= range.to) continue;
    const arr = byDay.get(day) ?? [];
    arr.push(ev);
    byDay.set(day, arr);
  }
  const ann = occurrencesByDay(anniversaries, range.from < today ? today : range.from, addDays(range.to, -1));
  const dates = [...new Set([...byDay.keys(), ...ann.keys()])].sort();
  return dates.map((date) => {
    const list = (byDay.get(date) ?? []).sort(
      (a, b) => rank(a) - rank(b) || a.startsAt.localeCompare(b.startsAt) || a.id - b.id || (a.occurrence ?? "").localeCompare(b.occurrence ?? ""),
    );
    const dow = dowOf(date);
    return {
      date,
      label: dayLabel(date, today),
      day: parseKey(date).d,
      tone: date === today ? "today" : dow === 0 || dow === 6 || holidayOf(date) ? "holiday" : "plain",
      anniversaries: ann.get(date) ?? [],
      events: list,
    };
  });
}

/** 달 구분 제목을 붙일 묶음: 목록 맨 처음, 그리고 앞 묶음과 달이 바뀌는 곳. "11월" (해가 다르면 "2027년 1월") */
export function monthBreak(prev: DateKey | null, date: DateKey, today: DateKey): string | null {
  const p = parseKey(date);
  if (prev !== null) {
    const q = parseKey(prev);
    if (q.y === p.y && q.m === p.m) return null;
  }
  return p.y === parseKey(today).y ? `${p.m}월` : `${p.y}년 ${p.m}월`;
}

/** 창 범위 글자 "12월 11일 ~ 1월 9일" (빈 창 안내, 더 보기 안내) */
export function windowRangeText(range: { from: DateKey; to: DateKey }): string {
  return `${md(range.from)} ~ ${md(addDays(range.to, -1))}`;
}

/**
 * (#192 Q3) "지난 일정" 창 i (1 부터, 1 = 오늘 포함 지난 30일). to 는 빼는 끝.
 * 지난 일정 = 이미 끝난 일정(endsAt <= now). 오늘 끝난 일정도 들어가고, 아직 안 끝난 일정은 다가오는 목록에만 있다
 */
export function pastWindow(today: DateKey, index: number): { from: DateKey; to: DateKey } {
  const to = addDays(today, 1 - (index - 1) * UPCOMING_WINDOW_DAYS);
  return { from: addDays(to, -UPCOMING_WINDOW_DAYS), to };
}

/** 지난 창 하나의 날짜 묶음. 끝난 일정만, 시작한 날에 묶는다. 날짜 오름차순 (기념일은 넣지 않는다) */
export function groupPast(events: Event[] | null | undefined, range: { from: DateKey; to: DateKey }, today: DateKey, nowMs: number): UpcomingDay[] {
  const byDay = new Map<DateKey, Event[]>();
  const seen = new Set<string>();
  for (const ev of events ?? []) {
    const k = eventKey(ev);
    if (seen.has(k) || Date.parse(ev.endsAt) > nowMs) continue;
    seen.add(k);
    const day = dateKeyOf(ev.startsAt);
    if (day < range.from || day >= range.to) continue;
    const arr = byDay.get(day) ?? [];
    arr.push(ev);
    byDay.set(day, arr);
  }
  return [...byDay.keys()].sort().map((date) => {
    const dow = dowOf(date);
    return {
      date,
      label: date === addDays(today, -1) ? "어제" : dayLabel(date, today),
      day: parseKey(date).d,
      tone: date === today ? "today" : dow === 0 || dow === 6 || holidayOf(date) ? "holiday" : "plain",
      anniversaries: [],
      events: (byDay.get(date) ?? []).sort(
        (a, b) => rank(a) - rank(b) || a.startsAt.localeCompare(b.startsAt) || a.id - b.id || (a.occurrence ?? "").localeCompare(b.occurrence ?? ""),
      ),
    };
  });
}
