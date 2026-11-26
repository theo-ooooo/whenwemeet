// 기념일 자동 표시 (docs/기획/기념일-자동표시.md 3장, D-59 ~ D-62). React 를 import 하지 않는 순수 함수 (단위 테스트 대상)
// 모든 계산은 KST 달력 날짜 키('YYYY-MM-DD') 끼리. 미리 목록을 펼치지 않고 보이는 범위만 해석적으로 구한다 (D-60)
// (#562, D-297) 음력 기념일(생일)은 해마다 양력으로 바꾼 날을 쓴다: anniversaryOrigin, anniversaryYearDate 한 곳 (서버 push/anniversary-items.ts 와 같은 규칙)
import { addDays, daysBetween, dday, keyOf, parseKey, type DateKey } from "./date";
import { lunarOccurrence, LUNAR_MAX_YEAR } from "./lunar";
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

type DateLike = Pick<Anniversary, "date" | "calendar" | "isLeapMonth">;

const isLunar = (a: DateLike) => a.calendar === "LUNAR";

/**
 * (#562) 원래 날짜의 양력. 양력이면 그대로, 음력이면 저장한 음력 연월일의 양력 (윤달이 없는 해는 평달, 없는 30일은 그 달 마지막 날).
 * 변환 범위 밖이면 null
 */
export function anniversaryOrigin(a: DateLike): DateKey | null {
  if (!isLunar(a)) return a.date;
  const { y, m, d } = parseKey(a.date);
  return lunarOccurrence(y, m, d, a.isLeapMonth === true);
}

/** (#562) 시작 해에서 n 해 뒤의 그날 양력. 음력은 음력 해로 세고 음력 12월은 다음 양력 해 1, 2월에 온다 */
export function anniversaryYearDate(a: DateLike, n: number): DateKey | null {
  const { y, m, d } = parseKey(a.date);
  if (!isLunar(a)) return sameDayInYear(a.date, y + n);
  return lunarOccurrence(y + n, m, d, a.isLeapMonth === true);
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
  const start = anniversaryOrigin(a);
  if (start === null) return out;
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
    // N주년 / 매년: 범위에 걸친 연도만 (범위는 길어야 몇 년). 음력은 음력 해로 세고, 음력 해 L 의 날은 양력 L 또는 L+1 년이라 한 해 앞부터 본다
    const sy = parseKey(a.date).y;
    const lunar = isLunar(a);
    const lastY = Math.min(parseKey(toKey).y, lunar ? LUNAR_MAX_YEAR : Infinity);
    for (let y = Math.max(parseKey(fromKey).y - (lunar ? 1 : 0), sy + 1); y <= lastY; y++) {
      const n = y - sy;
      if (kind === "COUNT_UP" && n > MAX_YEARS) break;
      const k = anniversaryYearDate(a, n);
      if (k === null || !inRange(k)) continue;
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
  const origin = anniversaryOrigin(a);
  if (origin === null) return null;
  if (origin >= today) return { anniversary: a, date: origin, type: "ORIGINAL", n: null, label: null };
  return occurrencesInRange(a, today, addDays(today, 366))[0] ?? null;
}

/** 대표 라벨 (기획 3-4): 시작일 전 D-n. COUNT_UP 은 "{N}일", YEARLY 는 다음 돌아오는 날 D-n / D-day, ONCE 는 D-day / D+n */
export function mainLabel(a: Anniversary, today: DateKey): string {
  const origin = anniversaryOrigin(a) ?? a.date;
  const diff = daysBetween(origin, today);
  if (diff < 0) return `D${diff}`;
  const kind = kindOf(a);
  if (kind === "COUNT_UP") return `${diff + 1}일`;
  if (kind === "YEARLY") {
    const next = nextOccurrence(a, today);
    return next ? dday(next.date, today).label : "D-day";
  }
  return dday(origin, today).label;
}

/** 항목 이름: 상세 줄 "처음 만난 날 300일", 이름만인 항목은 이름 */
export const occurrenceTitle = (o: Occurrence) => (o.label ? `${o.anniversary.name} ${o.label}` : o.anniversary.name);

/** 달력 칸 글자: "300일", "1주년", 매년/원래 날짜는 이름 */
export const occurrenceCellText = (o: Occurrence) => o.label ?? o.anniversary.name;

/** 여러 기념일의 범위 안 항목을 날짜별로. 각 날의 첫 항목이 칸에 보일 1개 */
export function occurrencesByDay(list: Anniversary[] | null | undefined, fromKey: DateKey, toKey: DateKey): Map<DateKey, Occurrence[]> {
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
export function upcomingOccurrences(list: Anniversary[] | null | undefined, today: DateKey, days = 30, limit = 2): Occurrence[] {
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
    return (anniversaryOrigin(a) ?? a.date).localeCompare(anniversaryOrigin(b) ?? b.date) || a.id - b.id;
  });
}

/**
 * 기념일 목록 한 행의 값 (#173). 오른쪽 큰 값은 종류와 상관없이 '다음 날까지' 하나로 통일한다
 * - value: 다음 항목까지 "D-n" / 당일 "오늘". 다음이 없는 지난 '그날만' 은 "D+n" (tone past)
 * - sub: 보조 줄. 함께한 날 세기는 누적 "N일째" 와 다음 라벨("1092일째, 다음 3주년 11월 15일", 당일이면 "오늘 100일"). 그 밖은 null
 */
export function listValue(a: Anniversary, today: DateKey): { value: string; tone: "today" | "ahead" | "past"; sub: string | null } {
  const next = nextOccurrence(a, today);
  const origin = anniversaryOrigin(a) ?? a.date;
  if (!next) return { value: dday(origin, today).label, tone: "past", sub: null };
  const diff = daysBetween(next.date, today);
  const value = diff === 0 ? "오늘" : `D-${-diff}`;
  const tone = diff === 0 ? "today" : "ahead";
  if (kindOf(a) !== "COUNT_UP" || origin > today) return { value, tone, sub: null };
  const count = `${dayNumber(origin, today)}일째`;
  if (!next.label) return { value, tone, sub: count };
  const { m, d } = parseKey(next.date);
  return { value, tone, sub: diff === 0 ? `오늘 ${next.label}` : `${count}, 다음 ${next.label} ${m}월 ${d}일` };
}

/**
 * (#562) 음력 날짜 아래 한 줄: 그해 양력 날짜. 매년, 함께한 날 세기는 "올해는 5월 1일"(올해 음력 날이 다음 해 1월이면 연도를 붙인다),
 * 그날만이거나 시작 해가 올해 뒤면 "양력 2000년 4월 19일". 윤달, 30일은 해마다 달라지는 규칙을 덧붙인다. 양력이면 null
 */
export function lunarYearHint(a: DateLike & { kind?: AnniversaryKind }, today: DateKey): string | null {
  if (!isLunar(a)) return null;
  const origin = anniversaryOrigin(a);
  if (origin === null) return null;
  const ty = parseKey(today).y;
  const { y, d } = parseKey(a.date);
  const rules = [a.isLeapMonth ? "윤달이 없는 해에는 평달" : null, d === 30 ? "30일이 없는 해에는 그 달 마지막 날" : null].filter(Boolean);
  const rule = rules.length ? `. ${rules.join(", ")}에 보여요` : "";
  const ymd = (k: DateKey, withYear: boolean) => {
    const p = parseKey(k);
    return `${withYear ? `${p.y}년 ` : ""}${p.m}월 ${p.d}일`;
  };
  if ((a.kind ?? "COUNT_UP") === "ONCE" || ty <= y) return `양력 ${ymd(origin, true)}${rule}`;
  const k = anniversaryYearDate(a, ty - y);
  return k ? `올해는 ${ymd(k, parseKey(k).y !== ty)}${rule}` : null;
}
