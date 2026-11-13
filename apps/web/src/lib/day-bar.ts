// (#378) 하루 막대(DayBar)의 배치 계산. 일 상세 C안(하루 막대 + 목록)과 빈 시간 결과 줄이 쓴다 (디자인규칙.md 8-5).
// 시각은 모두 epoch ms, 날짜와 시는 KST. React 를 import 하지 않는다 (단위 테스트 대상)
import { ceilToStep, SLOT_STEP_MINUTES } from "./free-time";
import { kstToIso } from "./date";
import { participantsOf } from "./participants";
import type { DateKey } from "./date";
import type { Event, Member } from "./types";

/** [start, end) ms */
export type Interval = { start: number; end: number };

export type BarSegment = Interval & {
  kind: "free" | "busy";
  /** 막대 왼쪽에서의 위치와 폭 (0~100, %) */
  left: number;
  width: number;
};

/** 막대 기본 창: 오전 8시 ~ 오후 11시 (C안 시안). 빈 시간 찾기 결과는 그 검색 창(예 9~23) 을 넘긴다 */
export const DEFAULT_FROM_HOUR = 8;
export const DEFAULT_TO_HOUR = 23;

/** 그날(KST) fromHour ~ toHour 창. toHour 24 는 다음 날 0시 */
export function dayWindow(date: DateKey, fromHour = DEFAULT_FROM_HOUR, toHour = DEFAULT_TO_HOUR): Interval {
  const at = (h: number) => Date.parse(kstToIso(date, "00:00")) + h * 3_600_000;
  return { start: at(fromHour), end: at(Math.max(fromHour, toHour)) };
}

/** 겹치거나 맞닿은 구간을 합친다 (시작 순). 길이 0 이하는 버린다 */
export function mergeIntervals(list: readonly Interval[]): Interval[] {
  const sorted = list.filter((i) => i.end > i.start).sort((a, b) => a.start - b.start);
  const out: Interval[] = [];
  for (const i of sorted) {
    const last = out[out.length - 1];
    if (last && i.start <= last.end) last.end = Math.max(last.end, i.end);
    else out.push({ start: i.start, end: i.end });
  }
  return out;
}

/** 창 안으로 자르고 합친다 */
export function clipIntervals(list: readonly Interval[], win: Interval): Interval[] {
  return mergeIntervals(list.map((i) => ({ start: Math.max(i.start, win.start), end: Math.min(i.end, win.end) })));
}

/** 창에서 바쁜 구간을 뺀 나머지 (빈 구간) */
export function invertIntervals(busy: readonly Interval[], win: Interval): Interval[] {
  const out: Interval[] = [];
  let at = win.start;
  for (const b of clipIntervals(busy, win)) {
    if (b.start > at) out.push({ start: at, end: b.start });
    at = Math.max(at, b.end);
  }
  if (at < win.end) out.push({ start: at, end: win.end });
  return out;
}

/** 모두 비는 구간: 누구라도 바쁘면 바쁨 */
export function everyoneFree(busyByMember: readonly (readonly Interval[])[], win: Interval): Interval[] {
  return invertIntervals(busyByMember.flat(), win);
}

const pct = (n: number) => Math.round(n * 10_000) / 100;

/**
 * 막대 한 줄: 빈 구간(free)과 그 사이 바쁜 구간(busy)을 창 처음부터 끝까지 빈틈없이 잇는다.
 * free 는 창 밖을 자르고 합친 뒤 쓴다
 */
export function barSegments(free: readonly Interval[], win: Interval): BarSegment[] {
  const span = win.end - win.start;
  if (span <= 0) return [];
  const seg = (kind: BarSegment["kind"], start: number, end: number): BarSegment => ({
    kind,
    start,
    end,
    left: pct((start - win.start) / span),
    width: pct((end - start) / span),
  });
  const out: BarSegment[] = [];
  let at = win.start;
  for (const f of clipIntervals(free, win)) {
    if (f.start > at) out.push(seg("busy", at, f.start));
    out.push(seg("free", f.start, f.end));
    at = f.end;
  }
  if (at < win.end) out.push(seg("busy", at, win.end));
  return out;
}

/** 바쁜 구간만 % 로 (멤버별 얇은 막대) */
export function busyMarks(busy: readonly Interval[], win: Interval): BarSegment[] {
  return barSegments(invertIntervals(busy, win), win).filter((s) => s.kind === "busy");
}

/** 구간 길이 합 (분) */
export function totalMinutes(list: readonly Interval[]): number {
  return Math.round(mergeIntervals(list).reduce((n, i) => n + (i.end - i.start), 0) / 60_000);
}

/**
 * 빈 구간을 누른 자리 → 새 일정 시작 시각. 누른 시각을 30분 단위로 내리고, 구간 시작(30분 올림)보다 앞이면 그것으로.
 * 내린 시각에서 30분이 구간 끝을 넘으면 한 칸 앞으로 당긴다(구간 시작보다 앞으로는 가지 않는다). 키보드(at 없음)는 구간 시작
 */
export function pickStart(seg: Interval, at?: number, stepMinutes = SLOT_STEP_MINUTES): number {
  const step = stepMinutes * 60_000;
  const first = Math.min(ceilToStep(seg.start, stepMinutes), seg.end);
  if (at === undefined) return first;
  let t = Math.floor(at / step) * step;
  if (t + step > seg.end) t = Math.floor((seg.end - step) / step) * step;
  return Math.max(first, t);
}

/** 막대 위 x 비율(0~1) → 시각 */
export function timeAt(win: Interval, ratio: number): number {
  return win.start + Math.min(1, Math.max(0, ratio)) * (win.end - win.start);
}

/** 눈금: fromHour 부터 every 시간마다, 끝 시각은 늘 넣는다 (8 ~ 23, 3시간 → 8 11 14 17 20 23) */
export function barTicks(fromHour: number, toHour: number, every = 3): { hour: number; left: number }[] {
  const span = toHour - fromHour;
  if (span <= 0) return [];
  const out: { hour: number; left: number }[] = [];
  for (let h = fromHour; h < toHour; h += every) out.push({ hour: h, left: pct((h - fromHour) / span) });
  // 끝 눈금이 바로 앞 눈금과 너무 붙으면(1시간 이하) 앞 것을 뺀다
  if (out.length > 1 && toHour - out[out.length - 1].hour <= 1) out.pop();
  out.push({ hour: toHour, left: 100 });
  return out;
}

/** 지금 표시 위치(%). 창 밖이면 null */
export function nowLeft(win: Interval, now: number): number | null {
  if (now < win.start || now > win.end) return null;
  return pct((now - win.start) / (win.end - win.start));
}

/**
 * 멤버별 바쁜 구간 (그날 창 안). 참여자가 "모두" 면 모든 멤버, 참여자 없음이면 아무도 아님.
 * 종일 일정은 기본으로 바쁨에 넣지 않는다(빈 시간 찾기 기본 "종일 일정 제외"와 같은 뜻, api.md 2.5)
 */
export function busyByMember(
  events: readonly Pick<Event, "startsAt" | "endsAt" | "allDay" | "creator" | "participants">[],
  members: readonly Member[],
  win: Interval,
  opts: { includeAllDay?: boolean } = {},
): { member: Member; busy: Interval[] }[] {
  return members.map((member) => {
    const busy = events
      .filter((ev) => opts.includeAllDay || !ev.allDay)
      .filter((ev) => {
        const p = participantsOf(ev);
        return p.all || p.members.some((m) => m.userId !== null && m.userId === member.userId);
      })
      .map((ev) => ({ start: Date.parse(ev.startsAt), end: Date.parse(ev.endsAt) }));
    return { member, busy: clipIntervals(busy, win) };
  });
}
