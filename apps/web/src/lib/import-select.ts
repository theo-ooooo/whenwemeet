// (#314) 일정 가져오기 미리보기 달력에서 골라서 넣기 (설계 `일정-가져오기.md` 5장, D-195). 순수 함수 (단위 테스트 대상)
// 선택은 "뺀 key" 집합으로 둔다. 기본이 전부 선택이라 미리보기를 새로 받으면 빈 집합으로 돌아간다
import { addDays, dateKeyOf, formatDateKo, parseKey, timeOf, type DateKey } from "./date";
import type { ImportItem, Repeat } from "./types";

const n = (count: number) => count.toLocaleString("en-US");

/** 일정이 걸친 날 (KST, 끝 배타). 서버가 30일 넘는 일정을 거르므로 길어야 31칸 */
export function coveredDays(item: Pick<ImportItem, "startsAt" | "endsAt">): DateKey[] {
  const first = dateKeyOf(item.startsAt);
  let last = dateKeyOf(new Date(new Date(item.endsAt).getTime() - 1));
  if (last < first) last = first;
  const days: DateKey[] = [];
  for (let d = first; d <= last && days.length < 62; d = addDays(d, 1)) days.push(d);
  return days;
}

/** 날짜별 일정 (여러 날 일정은 걸친 날마다). 서버 순서(시작 순) 그대로 */
export function itemsByDay(items: readonly ImportItem[]): Map<DateKey, ImportItem[]> {
  const map = new Map<DateKey, ImportItem[]>();
  for (const item of items) {
    for (const day of coveredDays(item)) {
      const list = map.get(day);
      if (list) list.push(item);
      else map.set(day, [item]);
    }
  }
  return map;
}

export type ImportMonth = { key: string; y: number; m: number; label: string; items: ImportItem[] };

/** 일정이 있는 달만, 오래된 순. 달마다 그 달에 걸친 일정 (여러 달에 걸치면 각 달에) */
export function importMonths(items: readonly ImportItem[]): ImportMonth[] {
  const map = new Map<string, ImportMonth>();
  for (const item of items) {
    const seen = new Set<string>();
    for (const day of coveredDays(item)) {
      const key = day.slice(0, 7);
      if (seen.has(key)) continue;
      seen.add(key);
      let month = map.get(key);
      if (!month) {
        const { y, m } = parseKey(`${key}-01`);
        month = { key, y, m, label: `${y}년 ${m}월`, items: [] };
        map.set(key, month);
      }
      month.items.push(item);
    }
  }
  return [...map.values()].sort((a, b) => (a.key < b.key ? -1 : 1));
}

/** 줄의 둘째 줄: "11월 12일 (목), 종일", "11월 12일 (목) ~ 11월 14일 (토), 종일", "11월 12일 (목) 10:00~11:00", 자정을 넘으면 끝 날짜까지 */
export function itemWhen(item: Pick<ImportItem, "startsAt" | "endsAt" | "allDay">): string {
  const start = dateKeyOf(item.startsAt);
  if (item.allDay) {
    // 종일의 끝은 다음 날 00:00 (배타)
    const last = dateKeyOf(new Date(new Date(item.endsAt).getTime() - 1));
    return last === start ? `${formatDateKo(start)}, 종일` : `${formatDateKo(start)} ~ ${formatDateKo(last)}, 종일`;
  }
  const end = dateKeyOf(item.endsAt);
  if (end === start) return `${formatDateKo(start)} ${timeOf(item.startsAt)}~${timeOf(item.endsAt)}`;
  return `${formatDateKo(start)} ${timeOf(item.startsAt)} ~ ${formatDateKo(end)} ${timeOf(item.endsAt)}`;
}

const REPEAT_BADGE: Record<Repeat, string> = { WEEKLY: "매주 반복", BIWEEKLY: "격주 반복", MONTHLY: "매월 반복", YEARLY: "매년 반복", YEARLY_LUNAR: "매년(음력) 반복" };

export function repeatBadge(repeat: Repeat | null): string | null {
  return repeat ? REPEAT_BADGE[repeat] : null;
}

/** 고른 수 */
export function selectedCount(items: readonly ImportItem[], excluded: ReadonlySet<string>): number {
  let count = 0;
  for (const item of items) if (!excluded.has(item.key)) count += 1;
  return count;
}

/** 묶음(달, 전체)의 체크 상태. 일부면 "mixed" */
export function groupState(items: readonly ImportItem[], excluded: ReadonlySet<string>): boolean | "mixed" {
  const count = selectedCount(items, excluded);
  return count === items.length ? true : count === 0 ? false : "mixed";
}

/** 넣기 요청의 include. 미리보기 순서 그대로 */
export function includeKeys(items: readonly ImportItem[], excluded: ReadonlySet<string>): string[] {
  return items.filter((item) => !excluded.has(item.key)).map((item) => item.key);
}

/** "N개 중 M개 선택" */
export function selectionLabel(total: number, selected: number): string {
  return `${n(total)}개 중 ${n(selected)}개 선택`;
}

/** 아래 버튼. 0개면 비활성 문구 */
export function submitLabel(teamName: string, selected: number, total: number): string {
  if (total === 0) return "넣을 일정이 없어요";
  if (selected === 0) return "넣을 일정을 골라 주세요";
  return `${teamName}에 ${n(selected)}개 넣기`;
}

/** 완료 화면에서 뺀 일정 안내 */
export function excludedLine(count: number): string | null {
  return count > 0 ? `뺀 일정 ${n(count)}개는 넣지 않았어요. 같은 파일을 다시 올리면 다시 고를 수 있어요` : null;
}

export type SelectAction =
  /** 미리보기를 새로 받음 (파일, 팀, 기간이 바뀜) → 전부 선택 */
  | { type: "reset" }
  | { type: "toggle"; key: string }
  /** 달 또는 전체: 그 key 들을 모두 고르거나 모두 뺀다 */
  | { type: "set"; keys: readonly string[]; on: boolean };

export function selectReducer(excluded: ReadonlySet<string>, action: SelectAction): ReadonlySet<string> {
  switch (action.type) {
    case "reset":
      return excluded.size === 0 ? excluded : new Set();
    case "toggle": {
      const next = new Set(excluded);
      if (next.has(action.key)) next.delete(action.key);
      else next.add(action.key);
      return next;
    }
    case "set": {
      const next = new Set(excluded);
      for (const key of action.keys) {
        if (action.on) next.delete(key);
        else next.add(key);
      }
      return next;
    }
  }
}
