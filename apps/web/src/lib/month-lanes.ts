// 달력 한 주(7칸)의 여러 날 일정 막대 배치 (#202). React 를 import 하지 않는다 (단위 테스트 대상)
// - 여러 날 일정(종일 여러 날, 자정을 넘는 시간 일정, 반복 회차 각각)은 주마다 한 줄 막대로 그린다
// - 레인 배치: 주 안에서 시작이 이른 것부터, 같으면 긴 것부터 비어 있는 가장 낮은 레인에 넣는다.
//   한 일정은 그 주 안에서 같은 레인을 지킨다 (칸마다 다른 높이에 그려지지 않게)
// - 칸 높이(줄 수 capacity) 를 넘으면 마지막 줄을 "+N개 더" 로 쓰고 그날 숨은 막대, 칩 수를 센다
import { dateKeyOf, type DateKey } from "./date";
import { eventKey } from "./recurrence";

export type LaneEvent = { id: number; occurrence?: string | null; startsAt: string; endsAt: string };

/** 한 주 안에서 레인이 정해진 막대 하나 (주 경계에서 잘린 조각) */
export type WeekSegment<T> = {
  event: T;
  key: string;
  lane: number;
  /** 주 안 시작 칸 (0=일) */
  col: number;
  /** 칸 수 */
  span: number;
  /** 이 조각의 왼쪽 끝이 일정의 진짜 시작이면 true (아니면 앞 주에서 이어짐, 각진 끝) */
  isStart: boolean;
  /** 오른쪽 끝이 일정의 진짜 마지막 날이면 true */
  isEnd: boolean;
};

export type PackedWeek<T> = {
  days: readonly DateKey[];
  segments: WeekSegment<T>[];
  /** 칸별 막대가 아닌 일정 (byDay 순서 그대로) */
  singles: T[][];
  /** 레인 수 */
  lanes: number;
};

/** 일정의 첫날, 마지막 날 (끝은 배타. 종일 끝 자정, 시간 일정 자정 끝은 그 앞날까지) */
export function eventDays(ev: LaneEvent): { first: DateKey; last: DateKey } {
  const first = dateKeyOf(ev.startsAt);
  const lastRaw = dateKeyOf(Date.parse(ev.endsAt) - 1);
  return { first, last: lastRaw < first ? first : lastRaw };
}

/**
 * 한 주를 레인으로 묶는다.
 * @param days 그 주 7칸의 날짜 (달력 줄 순서)
 * @param byDay 날짜별 일정 (groupByDay 결과. 여러 날에 걸친 일정은 걸친 날마다 들어 있다)
 * @param isBar 막대로 그릴 일정인지 (보통 isMultiDay)
 */
export function packWeek<T extends LaneEvent>(days: readonly DateKey[], byDay: ReadonlyMap<DateKey, readonly T[]>, isBar: (ev: T) => boolean): PackedWeek<T> {
  const found = new Map<string, { event: T; from: number; to: number }>();
  const singles: T[][] = days.map(() => []);
  days.forEach((day, col) => {
    for (const ev of byDay.get(day) ?? []) {
      if (!isBar(ev)) {
        singles[col].push(ev);
        continue;
      }
      const key = eventKey(ev);
      const hit = found.get(key);
      if (hit) hit.to = col;
      else found.set(key, { event: ev, from: col, to: col });
    }
  });

  const ordered = [...found.entries()].sort(
    ([ka, a], [kb, b]) =>
      a.from - b.from ||
      b.to - b.from - (a.to - a.from) ||
      Date.parse(b.event.endsAt) - Date.parse(b.event.startsAt) - (Date.parse(a.event.endsAt) - Date.parse(a.event.startsAt)) ||
      a.event.startsAt.localeCompare(b.event.startsAt) ||
      ka.localeCompare(kb),
  );

  // lanes[l][col] = 그 칸이 레인 l 에서 차 있는지
  const used: boolean[][] = [];
  const segments: WeekSegment<T>[] = [];
  for (const [key, { event, from, to }] of ordered) {
    let lane = used.findIndex((row) => row.slice(from, to + 1).every((x) => !x));
    if (lane < 0) {
      lane = used.length;
      used.push(days.map(() => false));
    }
    for (let c = from; c <= to; c++) used[lane][c] = true;
    const { first, last } = eventDays(event);
    segments.push({ event, key, lane, col: from, span: to - from + 1, isStart: days[from] === first, isEnd: days[to] === last });
  }
  return { days, segments, singles, lanes: used.length };
}

/** 칸 하나의 칩 자리 */
export type DayFit<T> = {
  /** 칩이 시작하는 줄 (그 위는 막대 레인 자리) */
  chipRow: number;
  /** 보이는 한 날 일정 칩 */
  chips: T[];
  /** "+N개 더" 의 N (숨은 막대 + 숨은 칩). 0 이면 줄 없음 */
  more: number;
};

/** 화면에 그릴 막대 조각. 칸 높이 때문에 어떤 날 숨은 막대는 거기서 끊긴다 */
export type BarPiece<T> = {
  event: T;
  key: string;
  lane: number;
  col: number;
  span: number;
  /** 왼쪽 둥근 끝 (일정의 진짜 시작) */
  roundStart: boolean;
  /** 오른쪽 둥근 끝 (일정의 진짜 끝) */
  roundEnd: boolean;
};

export type WeekFit<T> = { pieces: BarPiece<T>[]; days: DayFit<T>[] };

/**
 * 칸에 들어가는 줄 수(capacity) 에 맞춰 막대 조각과 칸별 칩, "+N개 더" 를 정한다.
 * 그날 필요한 줄 = (그날 차 있는 가장 높은 레인 + 1) + 한 날 일정 수.
 * 넘치면 capacity - 1 줄까지만 그리고 마지막 줄은 "+N개 더" (N = 그날 숨은 막대 + 숨은 칩)
 */
export function fitWeek<T extends LaneEvent>(week: PackedWeek<T>, capacity: number): WeekFit<T> {
  const cols = week.days.length;
  const limit: number[] = [];
  const days: DayFit<T>[] = [];
  for (let col = 0; col < cols; col++) {
    const lanesHere = week.segments.filter((s) => s.col <= col && col < s.col + s.span).map((s) => s.lane);
    const height = lanesHere.length ? Math.max(...lanesHere) + 1 : 0;
    const singles = week.singles[col];
    if (height + singles.length <= capacity) {
      limit.push(capacity);
      days.push({ chipRow: height, chips: singles, more: 0 });
      continue;
    }
    const lim = Math.max(0, capacity - 1);
    limit.push(lim);
    const chips = singles.slice(0, Math.max(0, lim - height));
    const hiddenBars = lanesHere.filter((l) => l >= lim).length;
    days.push({ chipRow: Math.min(height, lim), chips, more: hiddenBars + singles.length - chips.length });
  }

  const pieces: BarPiece<T>[] = [];
  for (const s of week.segments) {
    let runStart = -1;
    for (let col = s.col; col <= s.col + s.span; col++) {
      const visible = col < s.col + s.span && s.lane < limit[col];
      if (visible && runStart < 0) runStart = col;
      if (!visible && runStart >= 0) {
        pieces.push({
          event: s.event,
          key: s.key,
          lane: s.lane,
          col: runStart,
          span: col - runStart,
          roundStart: s.isStart && runStart === s.col,
          roundEnd: s.isEnd && col === s.col + s.span,
        });
        runStart = -1;
      }
    }
  }
  return { pieces, days };
}

/** 폰 칸 하나: 4px 막대 레인(빈 레인은 null 로 자리만) + 레인이 모자라 점으로 내려간 막대 일정 */
export type PhoneDayLanes<T> = { lanes: (WeekSegment<T> | null)[]; overflow: T[] };

/** 폰 칸: maxLanes 까지만 막대, 그 위 레인의 일정은 그날 점으로 (QA3-M2 처럼 숨기지 않는다) */
export function phoneDayLanes<T extends LaneEvent>(week: PackedWeek<T>, col: number, maxLanes: number): PhoneDayLanes<T> {
  const here = week.segments.filter((s) => s.col <= col && col < s.col + s.span);
  const lanes: (WeekSegment<T> | null)[] = [];
  for (let l = 0; l < maxLanes; l++) lanes.push(here.find((s) => s.lane === l) ?? null);
  while (lanes.length && lanes[lanes.length - 1] === null) lanes.pop();
  const overflow = here.filter((s) => s.lane >= maxLanes).sort((a, b) => a.lane - b.lane).map((s) => s.event);
  return { lanes, overflow };
}

/** 폰 칸 이름 칩 하나 (#355). 여러 날 일정은 주 조각 하나가 칩 하나(걸친 칸만큼 넓다) */
export type PhoneChip<T> = {
  event: T;
  key: string;
  /** 0 = 날짜 숫자 바로 아래 줄 */
  lane: number;
  col: number;
  span: number;
  /** 여러 날 일정(진한 막대)인지 */
  multi: boolean;
  /** 왼쪽 끝이 일정의 진짜 시작(둥근 끝). 앞 주에서 이어지면 false */
  roundStart: boolean;
  /** 오른쪽 끝이 일정의 진짜 끝 */
  roundEnd: boolean;
};

export type PhoneWeek<T> = {
  chips: PhoneChip<T>[];
  /** 칸별 "+N" 의 N (못 그린 막대 + 칩). 0 이면 배지 없음 */
  more: number[];
};

/**
 * 폰 월 달력 한 주의 이름 칩 배치 (#355, C안). 칸마다 maxLanes 줄(기본 4).
 * - 여러 날 막대를 먼저(packWeek 순서: 시작 이른 것, 긴 것) 걸친 칸이 모두 비어 있는 가장 낮은 줄에 넣는다.
 *   어느 줄에도 통째로 안 들어가면 걸친 칸마다 "+1" (막대를 칸 중간에서 끊지 않는다)
 * - 한 날 일정은 그 칸의 남은 줄을 위에서부터 채우고(byDay 순서), 모자라면 "+1"
 * - reserved[col] 이 true 인 칸은 0번 줄을 기념일, 공휴일 글자가 쓴다
 */
export function phoneWeek<T extends LaneEvent>(week: PackedWeek<T>, maxLanes = 4, reserved: readonly boolean[] = []): PhoneWeek<T> {
  const cols = week.days.length;
  const used: boolean[][] = Array.from({ length: maxLanes }, (_, l) => Array.from({ length: cols }, (_, c) => l === 0 && Boolean(reserved[c])));
  const more = Array.from({ length: cols }, () => 0);
  const chips: PhoneChip<T>[] = [];

  for (const s of week.segments) {
    const to = s.col + s.span;
    const lane = used.findIndex((row) => row.slice(s.col, to).every((x) => !x));
    if (lane < 0) {
      for (let c = s.col; c < to; c++) more[c] += 1;
      continue;
    }
    for (let c = s.col; c < to; c++) used[lane][c] = true;
    chips.push({ event: s.event, key: s.key, lane, col: s.col, span: s.span, multi: true, roundStart: s.isStart, roundEnd: s.isEnd });
  }

  week.singles.forEach((list, col) => {
    for (const ev of list) {
      const lane = used.findIndex((row) => !row[col]);
      if (lane < 0) {
        more[col] += 1;
        continue;
      }
      used[lane][col] = true;
      chips.push({ event: ev, key: eventKey(ev), lane, col, span: 1, multi: false, roundStart: true, roundEnd: true });
    }
  });
  return { chips, more };
}
