// 달력 주 보기 (#192, 디자인규칙.md 2-5) 의 배치 계산. React 를 import 하지 않는다 (단위 테스트 대상)
// - 주는 일요일 시작 (월 그리드, 일 상세 주간 줄과 같다). 시각은 모두 KST
// - 시간 일정은 날마다 [그날 00:00, 다음 날 00:00) 으로 잘라 조각으로 그린다 (자정을 넘으면 다음 날은 00:00 부터)
// - 같은 날 겹치는 조각은 묶음마다 열을 나눈다. 묶음 안 최대 열 수로 폭을 등분하고 최대 3열.
//   넘치면 마지막 열을 "+N" 자리로 쓴다 (N = 그 열과 그 뒤 열에 들어갈 조각 수)
// - 종일 일정은 격자 위 "종일" 줄에서 month-lanes 의 packWeek, fitWeek 를 그대로 쓴다
import { addDays, dateKeyOf, kstToIso, parseKey, timeOf, type DateKey } from "./date";
import { meridiem, weekStrip } from "./day-view";
import { eventKey } from "./recurrence";

export const DAY_MINUTES = 24 * 60;
/** 빈 칸을 누를 때 시각 단위 */
export const SLOT_MINUTES = 30;
/** 처음 보이는 맨 위 시각 (기본 07:00~24:00 이 보이고 위로 스크롤하면 00:00) */
export const DEFAULT_TOP_MINUTE = 7 * 60;
/** 한 묶음에서 나란히 그리는 최대 열 수 */
export const MAX_COLS = 3;
/** 아주 짧은 일정도 이 길이만큼은 그린다 (겹침 판단도 이 길이로 한다. 막대가 겹쳐 그려지지 않게) */
export const MIN_VISUAL_MINUTES = 30;
/** 종일 줄 수 (넘치면 마지막 줄이 "+N개 더") */
export const ALL_DAY_CAPACITY = 4;

type TimedEvent = { id: number; occurrence?: string | null; startsAt: string; endsAt: string; allDay: boolean };

/** 보이는 주 7칸 (일~토). date 가 든 주 */
export const weekDays = (date: DateKey): DateKey[] => weekStrip(date);

/** 받을 범위: 보이는 주 + 앞뒤 1주 (21일, api.md 2.3 62일 한도 안). to 는 빼는 끝 */
export function weekFetchRange(date: DateKey): { from: DateKey; to: DateKey } {
  const sun = weekStrip(date)[0];
  return { from: addDays(sun, -7), to: addDays(sun, 14) };
}

/** 그날 하나의 시간 일정 조각 */
export type DaySegment<T> = {
  event: T;
  key: string;
  /** 그날 00:00 부터 분 (0~1440) */
  start: number;
  end: number;
  /** 조각의 위 끝이 일정의 진짜 시작이면 true (아니면 앞날에서 이어짐) */
  isStart: boolean;
  /** 아래 끝이 진짜 끝이면 true (아니면 다음 날로 이어짐) */
  isEnd: boolean;
};

const minutesBetween = (a: number, b: number) => Math.round((b - a) / 60000);

/**
 * 그날의 시간 일정 조각. 종일 일정은 빼고, 같은 회차는 한 번만. 시작 순(같으면 긴 것 먼저)
 * 길이 0 인 일정은 시작한 날에만 둔다
 */
export function daySegments<T extends TimedEvent>(events: readonly T[], day: DateKey): DaySegment<T>[] {
  const dayStart = Date.parse(kstToIso(day));
  const dayEnd = Date.parse(kstToIso(addDays(day, 1)));
  const seen = new Set<string>();
  const out: DaySegment<T>[] = [];
  for (const ev of events) {
    if (ev.allDay) continue;
    const s = Date.parse(ev.startsAt);
    const e = Math.max(s, Date.parse(ev.endsAt));
    const inside = s === e ? s >= dayStart && s < dayEnd : s < dayEnd && e > dayStart;
    if (!inside) continue;
    const key = eventKey(ev);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      event: ev,
      key,
      start: minutesBetween(dayStart, Math.max(s, dayStart)),
      end: minutesBetween(dayStart, Math.min(e, dayEnd)),
      isStart: s >= dayStart,
      isEnd: e <= dayEnd,
    });
  }
  return out.sort((a, b) => a.start - b.start || b.end - a.end || a.key.localeCompare(b.key));
}

/** 그려지는 끝 (짧은 일정은 MIN_VISUAL_MINUTES 만큼, 자정에서 멈춘다) */
export const visualEnd = (seg: { start: number; end: number }) => Math.min(DAY_MINUTES, Math.max(seg.end, seg.start + MIN_VISUAL_MINUTES));

export type PlacedSegment<T> = DaySegment<T> & {
  /** 묶음 안 열 (0 부터) */
  col: number;
  /** 묶음의 열 수 (폭 = 1/cols) */
  cols: number;
};

/** 열이 모자라 숨은 조각을 대신하는 "+N" 자리 */
export type MoreSlot<T> = { start: number; end: number; col: number; cols: number; events: T[] };

export type DayLayout<T> = { placed: PlacedSegment<T>[]; more: MoreSlot<T>[] };

/**
 * 하루의 조각을 겹침 묶음별 열로 나눈다.
 * 묶음: 그려지는 범위가 이어서 겹치는 조각들. 묶음 안에서는 시작 순으로 비어 있는 가장 왼쪽 열에 넣는다.
 * 묶음 열 수가 maxCols 를 넘으면 maxCols - 1 열까지 그리고 마지막 열은 "+N" (그 열 이후 조각을 모은다)
 */
export function layoutDay<T>(segments: readonly DaySegment<T>[], maxCols = MAX_COLS): DayLayout<T> {
  const sorted = [...segments].sort((a, b) => a.start - b.start || visualEnd(b) - visualEnd(a) || a.key.localeCompare(b.key));
  const placed: PlacedSegment<T>[] = [];
  const more: MoreSlot<T>[] = [];

  let group: { seg: DaySegment<T>; col: number }[] = [];
  let colEnds: number[] = [];
  let groupEnd = -1;

  const flush = () => {
    if (group.length === 0) return;
    const cols = colEnds.length;
    if (cols <= maxCols) {
      for (const g of group) placed.push({ ...g.seg, col: g.col, cols });
    } else {
      const keep = Math.max(0, maxCols - 1);
      const hidden = group.filter((g) => g.col >= keep);
      for (const g of group) if (g.col < keep) placed.push({ ...g.seg, col: g.col, cols: maxCols });
      more.push({
        start: Math.min(...hidden.map((g) => g.seg.start)),
        end: Math.max(...hidden.map((g) => visualEnd(g.seg))),
        col: keep,
        cols: maxCols,
        events: hidden.map((g) => g.seg.event),
      });
    }
    group = [];
    colEnds = [];
    groupEnd = -1;
  };

  for (const seg of sorted) {
    if (seg.start >= groupEnd) flush();
    const end = visualEnd(seg);
    let col = colEnds.findIndex((e) => e <= seg.start);
    if (col < 0) {
      col = colEnds.length;
      colEnds.push(end);
    } else {
      colEnds[col] = end;
    }
    group.push({ seg, col });
    groupEnd = Math.max(groupEnd, end);
  }
  flush();
  return { placed, more };
}

/** 격자 위 세로 위치(px) → 그 칸의 시각(분). 30분 단위로 내림, 23:30 까지 */
export function slotMinuteAt(offsetPx: number, hourPx: number): number {
  const min = (Math.max(0, offsetPx) / hourPx) * 60;
  const slot = Math.floor(min / SLOT_MINUTES) * SLOT_MINUTES;
  return Math.min(slot, DAY_MINUTES - SLOT_MINUTES);
}

const pad = (n: number) => String(n).padStart(2, "0");

/** 분 → 'HH:mm' (1440 은 '24:00') */
export function hhmm(minute: number): string {
  return `${pad(Math.floor(minute / 60))}:${pad(minute % 60)}`;
}

/** 지금 시각 선 자리. 이번 주가 아니면 null */
export function nowMarker(days: readonly DateKey[], nowMs: number): { col: number; minute: number } | null {
  const today = dateKeyOf(nowMs);
  const col = days.indexOf(today);
  if (col < 0) return null;
  return { col, minute: minutesBetween(Date.parse(kstToIso(today)), nowMs) };
}

/**
 * 처음 열 때 맨 위에 둘 시각(분). 이번 주면 지금 - 1시간, 아니면 그 주(7칸 전체)에서 가장 이른 시간 일정 시작 30분 앞, 일정이 없으면 07:00.
 * 첫 칸(일요일)의 첫 일정이 아니라 주 전체에서 가장 이른 시각이라야 월, 화의 아침 일정이 위로 숨지 않는다.
 * 앞날에서 자정을 넘어 이어지는 조각(00:00 부터)은 그 주에 진짜 시작이 하나도 없을 때만 본다
 * (스크롤이 끝까지 내려가도 보이는 범위 안이게 0 ~ 1440 사이로)
 */
export function initialTopMinute<T extends TimedEvent>(days: readonly DateKey[], events: readonly T[] | null, nowMs: number): number {
  const now = nowMarker(days, nowMs);
  if (now) return Math.max(0, now.minute - 60);
  const segs = days.flatMap((day) => daySegments(events ?? [], day));
  if (!segs.length) return DEFAULT_TOP_MINUTE;
  const starts = segs.filter((s) => s.isStart);
  const earliest = Math.min(...(starts.length ? starts : segs).map((s) => s.start));
  return Math.max(0, Math.floor((earliest - 30) / SLOT_MINUTES) * SLOT_MINUTES);
}

/**
 * 시간 막대 안 시각 글자. 날마다 자른 조각의 범위가 아니라 일정의 진짜 시각을 쓴다
 * (22:00 ~ 다음 날 02:00 이 앞날 칸에서 "22:00~24:00" 으로 보이지 않게).
 * 같은 날 "09:00~10:00", 다음 날에 끝나면 "22:00~02:00"(자정에 끝나면 "22:00~24:00"),
 * 이틀 넘게 걸치면 "22:00~11/16 02:00"
 */
export function barTimeText(ev: { startsAt: string; endsAt: string }): string {
  const s = dateKeyOf(ev.startsAt);
  const e = dateKeyOf(ev.endsAt);
  const start = timeOf(ev.startsAt);
  const end = timeOf(ev.endsAt);
  if (e === s) return `${start}~${end}`;
  if (e === addDays(s, 1)) return `${start}~${end === "00:00" ? "24:00" : end}`;
  // 막대는 좁아 짧은 24시 표기를 쓴다 (일정 줄의 오전/오후 표기와 따로, #433). 끝 날짜만 덧붙인다
  const d = parseKey(e);
  return `${start}~${d.m}/${d.d} ${end}`;
}

/**
 * 주 보기 제목. "11월 9일 ~ 15일", 달이 걸치면 "11월 30일 ~ 12월 6일". 올해가 아니면 앞에 연도.
 * short (폰 제목줄): "11월 9~15일", 달이 걸치면 "11/30~12/6"
 */
export function weekTitle(days: readonly DateKey[], thisYear: number, short = false): string {
  const a = parseKey(days[0]);
  const b = parseKey(days[days.length - 1]);
  const year = a.y !== thisYear || b.y !== thisYear ? `${a.y}년 ` : "";
  if (short) return a.m === b.m ? `${year}${a.m}월 ${a.d}~${b.d}일` : `${year}${a.m}/${a.d}~${b.m}/${b.d}`;
  if (a.m === b.m) return `${year}${a.m}월 ${a.d}일 ~ ${b.d}일`;
  const yb = a.y !== b.y ? `${b.y}년 ` : "";
  return `${year}${a.m}월 ${a.d}일 ~ ${yb}${b.m}월 ${b.d}일`;
}

/** 빈 시간 구간을 그날 분 범위로 자른다 (빈 시간 겹쳐 보기) */
export function freeBands(slots: readonly { startsAt: string; endsAt: string }[], day: DateKey): { start: number; end: number }[] {
  const dayStart = Date.parse(kstToIso(day));
  const dayEnd = Date.parse(kstToIso(addDays(day, 1)));
  const out: { start: number; end: number }[] = [];
  for (const s of slots) {
    const a = Math.max(Date.parse(s.startsAt), dayStart);
    const b = Math.min(Date.parse(s.endsAt), dayEnd);
    if (b > a) out.push({ start: minutesBetween(dayStart, a), end: minutesBetween(dayStart, b) });
  }
  return out;
}

/** 시각 열 라벨: "0시" ~ "23시" */
export const hourLabel = (h: number) => `${h}시`;

/** 읽어 주는 시각: "오후 6시", "오전 9시 30분", 24:00 은 "자정" */
function spoken(iso: string): string {
  const t = new Date(iso);
  const key = dateKeyOf(t);
  const minute = minutesBetween(Date.parse(kstToIso(key)), t.getTime());
  const m = meridiem(hhmm(minute));
  const [h, mm] = m.value.split(":");
  return `${m.label} ${h}시${mm === "00" ? "" : ` ${Number(mm)}분`}`;
}

const md = (key: DateKey) => {
  const p = parseKey(key);
  return `${p.m}월 ${p.d}일`;
};

/** 막대 aria-label 의 앞부분: "저녁 약속, 11월 12일 오후 6시부터 8시까지" (참여자는 부르는 쪽이 withWho 로 붙인다) */
export function segmentLabel(ev: { title: string; startsAt: string; endsAt: string }): string {
  const s = dateKeyOf(ev.startsAt);
  const e = dateKeyOf(ev.endsAt);
  const start = spoken(ev.startsAt);
  let end = spoken(ev.endsAt);
  if (e !== s) {
    // 다음 날 자정에 끝나면 "자정까지"
    end = e === addDays(s, 1) && end === "오전 12시" ? "자정" : `${md(e)} ${end}`;
  } else if (end.split(" ")[0] === start.split(" ")[0]) {
    end = end.slice(end.indexOf(" ") + 1);
  }
  return `${ev.title}, ${md(s)} ${start}부터 ${end}까지`;
}
