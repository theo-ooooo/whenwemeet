// 기념일 자동 표시 (docs/기획/기념일-자동표시.md 3장, D-59 ~ D-62). React 를 import 하지 않는 순수 함수 (단위 테스트 대상)
// 모든 계산은 KST 달력 날짜 키('YYYY-MM-DD') 끼리. 미리 목록을 펼치지 않고 보이는 범위만 해석적으로 구한다 (D-60)
import { addDays, daysBetween, dday, keyOf, parseKey, type DateKey } from "./date";
import type { Anniversary, AnniversaryKind } from "./types";

/** 표시 항목 종류. ORIGINAL = 등록한 날짜, DAYS = N일, YEARS = N주년, YEARLY = 매년 돌아오는 날 */
export type OccurrenceType = "ORIGINAL" | "DAYS" | "YEARS" | "YEARLY";

export type Occurrence = {
  anniversary: Anniversary;
  date: DateKey;
  type: OccurrenceType;
  /** DAYS 면 N일의 N, YEARS 면 N주년의 N, 그 밖은 null */
  n: number | null;
  /** "300일", "1주년". ORIGINAL, YEARLY 는 null (이름으로 표시) */
  label: string | null;
};

/** 기념일 종류 (api.md 2.4). 응답에 없으면(종류 도입 전 캐시 등) COUNT_UP */
export const kindOf = (a: Pick<Anniversary, "kind">): AnniversaryKind => a.kind ?? "COUNT_UP";

export const KIND_OPTIONS: { value: AnniversaryKind; label: string; hint: string }[] = [
  { value: "COUNT_UP", label: "함께한 날 세기", hint: "100일, 200일, 1주년이 달력에 자동으로 보여요" },
  { value: "YEARLY", label: "매년 반복", hint: "생일처럼 매년 같은 날 달력에 보여요" },
  { value: "ONCE", label: "그날만", hint: "등록한 날 하루만 달력에 보여요" },
];

/** N일 단위: 100 간격 1000일까지, 이후 1000 간격 30000일까지 (D-59) */
export const DAY_MILESTONES: readonly number[] = [
  ...Array.from({ length: 10 }, (_, i) => (i + 1) * 100),
  ...Array.from({ length: 29 }, (_, i) => (i + 2) * 1000),
];
export const MAX_YEARS = 100;

const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

/** 시작일과 같은 월일의 y 년 날짜. 2월 29일은 평년에 2월 28일 */
export function sameDayInYear(start: DateKey, y: number): DateKey {
  const { m, d } = parseKey(start);
  return keyOf(y, m, m === 2 && d === 29 && !isLeap(y) ? 28 : d);
}

/** 시작일을 1일로 센 그날의 번호. N일 = 시작일 + (N - 1)일 */
export const dayNumber = (start: DateKey, key: DateKey) => daysBetween(start, key) + 1;

/** 우선순위: N주년 > N일 > 매년/원래 날짜 (3-6) */
const RANK: Record<OccurrenceType, number> = { YEARS: 0, DAYS: 1, YEARLY: 2, ORIGINAL: 2 };

/** 같은 날 안에서의 순서: 우선순위, 같으면 먼저 등록한 기념일(id 오름차순) */
export function compareOccurrence(a: Occurrence, b: Occurrence): number {
  return a.date.localeCompare(b.date) || RANK[a.type] - RANK[b.type] || a.anniversary.id - b.anniversary.id;
}

/** 범위 [fromKey, toKey] (양끝 포함) 안의 표시 항목. 날짜, 우선순위 순 */
export function occurrencesInRange(a: Anniversary, fromKey: DateKey, toKey: DateKey): Occurrence[] {
  if (toKey < fromKey) return [];
  const out: Occurrence[] = [];
  const start = a.date;
  const kind = kindOf(a);
  const inRange = (k: DateKey) => k >= fromKey && k <= toKey;

  if (inRange(start)) out.push({ anniversary: a, date: start, type: "ORIGINAL", n: null, label: null });

  if (kind === "COUNT_UP") {
    // N일: 범위 양끝의 날 번호 사이에 드는 단위만
    const nFrom = Math.max(1, dayNumber(start, fromKey));
    const nTo = dayNumber(start, toKey);
    for (const n of DAY_MILESTONES) {
      if (n < nFrom) continue;
      if (n > nTo) break;
      out.push({ anniversary: a, date: addDays(start, n - 1), type: "DAYS", n, label: `${n}일` });
    }
  }

  if (kind === "COUNT_UP" || kind === "YEARLY") {
    // N주년 / 매년: 범위에 걸친 연도만 (범위는 길어야 몇 년)
    const sy = parseKey(start).y;
    for (let y = Math.max(parseKey(fromKey).y, sy + 1); y <= parseKey(toKey).y; y++) {
      const n = y - sy;
      if (kind === "COUNT_UP" && n > MAX_YEARS) break;
      const k = sameDayInYear(start, y);
      if (!inRange(k)) continue;
      out.push(
        kind === "COUNT_UP"
          ? { anniversary: a, date: k, type: "YEARS", n, label: `${n}주년` }
          : { anniversary: a, date: k, type: "YEARLY", n: null, label: null },
      );
    }
  }

  return out.sort(compareOccurrence);
}

/** 오늘 포함 가장 가까운 다음 항목. COUNT_UP(상한 전), YEARLY 는 1년 안에 반드시 있다. 지난 ONCE 는 null */
export function nextOccurrence(a: Anniversary, today: DateKey): Occurrence | null {
  if (a.date >= today) return { anniversary: a, date: a.date, type: "ORIGINAL", n: null, label: null };
  return occurrencesInRange(a, today, addDays(today, 366))[0] ?? null;
}

/** 대표 라벨 (기획 3-4): 시작일 전 D-n. COUNT_UP 은 "{N}일", YEARLY 는 다음 돌아오는 날 D-n / D-day, ONCE 는 D-day / D+n */
export function mainLabel(a: Anniversary, today: DateKey): string {
  const diff = daysBetween(a.date, today);
  if (diff < 0) return `D${diff}`;
  const kind = kindOf(a);
  if (kind === "COUNT_UP") return `${diff + 1}일`;
  if (kind === "YEARLY") {
    const next = nextOccurrence(a, today);
    return next ? dday(next.date, today).label : "D-day";
  }
  return dday(a.date, today).label;
}

/** 항목 이름: 상세 줄 "처음 만난 날 300일", 이름만인 항목은 이름 */
export const occurrenceTitle = (o: Occurrence) => (o.label ? `${o.anniversary.name} ${o.label}` : o.anniversary.name);

/** 달력 칸 글자: "300일", "1주년", 매년/원래 날짜는 이름 */
export const occurrenceCellText = (o: Occurrence) => o.label ?? o.anniversary.name;

/** 여러 기념일의 범위 안 항목을 날짜별로. 각 날의 첫 항목이 칸에 보일 1개 */
export function occurrencesByDay(
  list: Anniversary[] | null | undefined,
  fromKey: DateKey,
  toKey: DateKey,
): Map<DateKey, Occurrence[]> {
  const map = new Map<DateKey, Occurrence[]>();
  for (const a of list ?? []) {
    for (const o of occurrencesInRange(a, fromKey, toKey)) {
      const arr = map.get(o.date) ?? [];
      arr.push(o);
      map.set(o.date, arr);
    }
  }
  for (const arr of map.values()) arr.sort(compareOccurrence);
  return map;
}

/** 다가오는 일정에 섞을 기념일 항목: 오늘 ~ 오늘 + days, 날짜순 최대 limit 개 (3-6) */
export function upcomingOccurrences(
  list: Anniversary[] | null | undefined,
  today: DateKey,
  days = 30,
  limit = 2,
): Occurrence[] {
  const end = addDays(today, days);
  return (list ?? [])
    .flatMap((a) => occurrencesInRange(a, today, end))
    .sort(compareOccurrence)
    .slice(0, limit);
}

/** D-day 타일: 모든 기념일 중 오늘 포함 가장 가까운 다음 항목 1개 */
export function nearestOccurrence(list: Anniversary[] | null | undefined, today: DateKey): Occurrence | null {
  let best: Occurrence | null = null;
  for (const a of list ?? []) {
    const o = nextOccurrence(a, today);
    if (o && (!best || compareOccurrence(o, best) < 0)) best = o;
  }
  return best;
}

/** 기념일 화면 정렬: 다음 항목 날짜순, 다음이 없는 것(지난 ONCE)은 맨 아래 (그 안에서는 날짜 오름차순) */
export function sortByNext(list: Anniversary[], today: DateKey): Anniversary[] {
  const next = new Map(list.map((a) => [a.id, nextOccurrence(a, today)]));
  return [...list].sort((a, b) => {
    const na = next.get(a.id);
    const nb = next.get(b.id);
    if (na && nb) return compareOccurrence(na, nb);
    if (na) return -1;
    if (nb) return 1;
    return a.date.localeCompare(b.date) || a.id - b.id;
  });
}

/**
 * 기념일 목록 한 행의 값 (#173). 오른쪽 큰 값은 종류와 상관없이 '다음 날까지' 하나로 통일한다
 * - value: 다음 항목까지 "D-n" / 당일 "오늘". 다음이 없는 지난 '그날만' 은 "D+n" (tone past)
 * - sub: 보조 줄. 함께한 날 세기는 누적 "N일째" 와 다음 라벨("1092일째, 다음 3주년 11월 15일", 당일이면 "오늘 100일"). 그 밖은 null
 */
export function listValue(
  a: Anniversary,
  today: DateKey,
): { value: string; tone: "today" | "ahead" | "past"; sub: string | null } {
  const next = nextOccurrence(a, today);
  if (!next) return { value: dday(a.date, today).label, tone: "past", sub: null };
  const diff = daysBetween(next.date, today);
  const value = diff === 0 ? "오늘" : `D-${-diff}`;
  const tone = diff === 0 ? "today" : "ahead";
  if (kindOf(a) !== "COUNT_UP" || a.date > today) return { value, tone, sub: null };
  const count = `${dayNumber(a.date, today)}일째`;
  if (!next.label) return { value, tone, sub: count };
  const { m, d } = parseKey(next.date);
  return { value, tone, sub: diff === 0 ? `오늘 ${next.label}` : `${count}, 다음 ${next.label} ${m}월 ${d}일` };
}
