// (#378 B) 빈 시간 찾기 화면의 글자와 묶음: 조건 칩("이번 주", "오전 9:00 ~ 오후 11:00", "2시간 이상"), 요약 한 줄(몇 곳, 가장 긴 곳),
// 날짜별 묶음(하루 막대 + 시간 칩). React 를 import 하지 않는다 (단위 테스트 대상)
import { clockOfMinutes, clockPairText, dateKeyOf, dowOf, parseKey, WEEKDAYS, type DateKey } from "./date";
import type { Interval } from "./day-bar";
import type { FreeSlots } from "./types";

type FreeSlot = FreeSlots["slots"][number];

const minutesOfHhmm = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

/**
 * 시간대 칩 "오전 9:00 ~ 오후 11:00". 결과 칩, 일정 줄과 같은 표기(lib/date.ts clockPairText, QA 2026-11-14).
 * 끝 24:00 은 결과 칩(자정에 끝나는 구간)과 같이 "오전 12:00" ("오후 9:00 ~ 오전 12:00")
 */
export function dayRangeText(dayStart: string, dayEnd: string): string {
  return clockPairText(clockOfMinutes(minutesOfHhmm(dayStart)), clockOfMinutes(minutesOfHhmm(dayEnd)));
}

/** 최소 길이 칩 "2시간 이상", 360 은 "반나절 이상" */
export function minLengthText(min: number): string {
  if (min === 360) return "반나절 이상";
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h ? `${h}시간` : ""}${h && m ? " " : ""}${m ? `${m}분` : ""} 이상`;
}

/** 날짜 짧게 "금 11/13" */
export function shortDay(key: DateKey): string {
  const p = parseKey(key);
  return `${WEEKDAYS[dowOf(key)]} ${p.m}/${p.d}`;
}

/** 기간 칩: 직접 고른 기간은 "11/13 ~ 11/19" (끝 날 포함) */
export function periodText(period: "thisWeek" | "nextWeek" | "custom", from: DateKey, lastDay: DateKey): string {
  if (period === "thisWeek") return "이번 주";
  if (period === "nextWeek") return "다음 주";
  const a = parseKey(from);
  const b = parseKey(lastDay);
  return from === lastDay ? `${a.m}/${a.d}` : `${a.m}/${a.d} ~ ${b.m}/${b.d}`;
}

const minutesOf = (s: FreeSlot) => Math.round((Date.parse(s.endsAt) - Date.parse(s.startsAt)) / 60_000);

export type FreeDay = {
  date: DateKey;
  slots: FreeSlot[];
  /** 하루 막대에 넘길 빈 구간 (ms) */
  free: Interval[];
  /** 그날 빈 시간 합 (분) */
  minutes: number;
};

/** 날짜(시작한 날, KST)별 묶음. 날짜 오름차순 */
export function groupFreeDays(slots: readonly FreeSlot[]): FreeDay[] {
  const map = new Map<DateKey, FreeSlot[]>();
  for (const s of slots) {
    const k = dateKeyOf(s.startsAt);
    map.set(k, [...(map.get(k) ?? []), s]);
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, list]) => ({
      date,
      slots: list,
      free: list.map((s) => ({ start: Date.parse(s.startsAt), end: Date.parse(s.endsAt) })),
      minutes: list.reduce((n, s) => n + minutesOf(s), 0),
    }));
}

/** 가장 긴 구간 (같으면 먼저 오는 것). 없으면 null */
export function longestSlot(slots: readonly FreeSlot[]): FreeSlot | null {
  let best: FreeSlot | null = null;
  for (const s of slots) if (!best || minutesOf(s) > minutesOf(best)) best = s;
  return best;
}

/** 요약 앞머리: 둘이면 "둘 모두", 셋 이상 "3명 모두", 혼자(개인 달력)면 "내 일정 기준" */
export function whoText(memberCount: number): string {
  if (memberCount <= 1) return "내 일정 기준";
  return memberCount === 2 ? "둘 모두" : `${memberCount}명 모두`;
}
