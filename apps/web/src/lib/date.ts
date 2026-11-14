// KST(+09:00) 고정 날짜 계산. 모든 표시는 KST, API 와 주고받는 값은 UTC ISO.
// 브라우저 시간대에 의존하지 않도록 Date.UTC 기반으로만 계산한다.

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"] as const;

export type KstParts = {
  y: number;
  m: number; // 1~12
  d: number;
  h: number;
  min: number;
  dow: number; // 0=일
};

/** 날짜 키 'YYYY-MM-DD' */
export type DateKey = string;

const pad = (n: number) => String(n).padStart(2, "0");

export function toKst(input: string | Date | number): KstParts {
  const t = typeof input === "number" ? input : new Date(input).getTime();
  const d = new Date(t + KST_OFFSET_MS);
  return {
    y: d.getUTCFullYear(),
    m: d.getUTCMonth() + 1,
    d: d.getUTCDate(),
    h: d.getUTCHours(),
    min: d.getUTCMinutes(),
    dow: d.getUTCDay(),
  };
}

/** KST 날짜/시각 → UTC Date */
export function fromKst(y: number, m: number, d: number, h = 0, min = 0): Date {
  return new Date(Date.UTC(y, m - 1, d, h, min) - KST_OFFSET_MS);
}

export function keyOf(y: number, m: number, d: number): DateKey {
  return `${y}-${pad(m)}-${pad(d)}`;
}

export function parseKey(key: DateKey): { y: number; m: number; d: number } {
  const [y, m, d] = key.split("-").map(Number);
  return { y, m, d };
}

/** ISO → KST 날짜 키 */
export function dateKeyOf(iso: string | Date | number): DateKey {
  const p = toKst(iso);
  return keyOf(p.y, p.m, p.d);
}

export function todayKey(): DateKey {
  return dateKeyOf(Date.now());
}

export function addDays(key: DateKey, n: number): DateKey {
  const { y, m, d } = parseKey(key);
  const t = Date.UTC(y, m - 1, d) + n * DAY_MS;
  const nd = new Date(t);
  return keyOf(nd.getUTCFullYear(), nd.getUTCMonth() + 1, nd.getUTCDate());
}

/** b - a (일). a, b 는 날짜 키 */
export function daysBetween(a: DateKey, b: DateKey): number {
  const pa = parseKey(a);
  const pb = parseKey(b);
  return Math.round(
    (Date.UTC(pb.y, pb.m - 1, pb.d) - Date.UTC(pa.y, pa.m - 1, pa.d)) / DAY_MS,
  );
}

export function dowOf(key: DateKey): number {
  const { y, m, d } = parseKey(key);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** 날짜 키 + 'HH:mm'(KST) → UTC ISO */
export function kstToIso(key: DateKey, time = "00:00"): string {
  const { y, m, d } = parseKey(key);
  const [h, min] = time.split(":").map(Number);
  return fromKst(y, m, d, h, min).toISOString();
}

/** ISO → KST 'HH:mm' */
export function timeOf(iso: string): string {
  const p = toKst(iso);
  return `${pad(p.h)}:${pad(p.min)}`;
}

/** 해당 월의 6주(42일) 그리드. 일요일 시작 */
export function monthGrid(y: number, m: number): DateKey[] {
  const first = keyOf(y, m, 1);
  const lead = dowOf(first);
  const start = addDays(first, -lead);
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function shiftMonth(y: number, m: number, n: number): { y: number; m: number } {
  const idx = y * 12 + (m - 1) + n;
  return { y: Math.floor(idx / 12), m: (idx % 12) + 1 };
}

/** 'YYYY-MM-DD' → '11월 9일 (일)' */
export function formatDateKo(key: DateKey, withYear = false): string {
  const { y, m, d } = parseKey(key);
  const base = `${m}월 ${d}일 (${WEEKDAYS[dowOf(key)]})`;
  return withYear ? `${y}년 ${base}` : base;
}

/**
 * (QA 2026-11-14) 화면에 보이는 시각 표기는 이 모양 하나다 (디자인규칙.md 8-4 일정 줄, D-252): "오전 8:00 ~ 9:00", 앞 0 없음, 물결표 양옆 띄움.
 * 오전/오후가 바뀌면 끝에도 붙인다 "오전 11:00 ~ 오후 1:00". 'HH:mm' 은 입력 값과 주소에만 쓴다
 */
export type Clock = { meridiem: "오전" | "오후"; text: string };

/** 하루 안 분 → 오전/오후 h:mm. 0시는 "오전 12:00", 12시는 "오후 12:00" */
export function clockOfMinutes(total: number): Clock {
  const h = Math.floor(total / 60) % 24;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return { meridiem: h < 12 ? "오전" : "오후", text: `${h12}:${pad(total % 60)}` };
}

/** 시각 하나 → 오전/오후 h:mm (KST) */
export function clockOf(at: string | number): Clock {
  const { h, min } = toKst(at);
  return clockOfMinutes(h * 60 + min);
}

/** "오전 8:00" */
export function clockText(at: string | number): string {
  const c = clockOf(at);
  return `${c.meridiem} ${c.text}`;
}

/** 두 시각 "오전 8:00 ~ 9:00". 오전/오후가 바뀌면 끝에도 붙인다 "오전 11:00 ~ 오후 1:00" */
export function clockPairText(s: Clock, e: Clock): string {
  return `${s.meridiem} ${s.text} ~ ${e.meridiem === s.meridiem ? "" : `${e.meridiem} `}${e.text}`;
}

/** 같은 날 두 시각 "오전 8:00 ~ 9:00" (KST) */
export function clockRangeText(start: string | number, end: string | number): string {
  return clockPairText(clockOf(start), clockOf(end));
}

/**
 * 일정 시간 글자 (사이드바 다가오는 일정, 새 소식, 읽기 이름). 일정 줄(eventRowTime)을 시작한 날에 쓴 것과 같다.
 * - 하루 시간 일정 "오후 7:30 ~ 10:00" (자정에 끝나면 "오후 10:00 ~ 오전 12:00")
 * - 종일 "종일", 여러 날 종일 "종일 ~11월 22일"
 * - 여러 날 시간 일정 "오후 10:00 ~ 11월 23일 오전 2:00"
 */
export function formatEventTime(startsAt: string, endsAt: string, allDay: boolean): string {
  const first = dateKeyOf(startsAt);
  const end = allDay ? addDays(dateKeyOf(endsAt), -1) : dateKeyOf(Date.parse(endsAt) - 1);
  const last = end < first ? first : end;
  const { m, d } = parseKey(last);
  if (allDay) return last > first ? `종일 ~${m}월 ${d}일` : "종일";
  if (first === last) return clockRangeText(startsAt, endsAt);
  return `${clockText(startsAt)} ~ ${m}월 ${d}일 ${clockText(endsAt)}`;
}

/** 분 → '2시간', '1시간 30분' */
export function formatMinutes(min: number): string {
  const h = Math.floor(min / 60);
  const r = min % 60;
  if (h === 0) return `${r}분`;
  if (r === 0) return `${h}시간`;
  return `${h}시간 ${r}분`;
}

/** '3시간 전' 형태 */
export function formatRelative(iso: string, now = Date.now()): string {
  const diff = Math.max(0, now - new Date(iso).getTime());
  const min = Math.floor(diff / 60000);
  if (min < 1) return "방금";
  if (min < 60) return `${min}분 전`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}시간 전`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}일 전`;
  return formatDateKo(dateKeyOf(iso));
}

/** 이번 주(월~일) 의 시작 키 */
export function startOfWeek(key: DateKey): DateKey {
  const dow = dowOf(key); // 0=일
  const back = dow === 0 ? 6 : dow - 1;
  return addDays(key, -back);
}

/** D-day 표기 (화면흐름.md 7). 기념일 대표 라벨은 lib/anniversary.ts mainLabel
 *  diff = 오늘 - date. 0 → D-day, 음수 → D-12, 양수 → D+591 */
export function dday(date: DateKey, today = todayKey()): { label: string; diff: number } {
  const diff = daysBetween(date, today);
  if (diff === 0) return { label: "D-day", diff };
  if (diff < 0) return { label: `D${diff}`, diff };
  return { label: `D+${diff}`, diff };
}
