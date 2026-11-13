// (#201) 날짜 격자 키보드 이동. 월 달력(CalendarScreen), 날짜 피커(DatePicker), 일 상세 주간 줄(DayView), 주 보기 날짜 머리(WeekView)가 같이 쓴다.
// 키는 APG 날짜 피커 격자와 같다: ← → 하루, ↑ ↓ 한 주, Home End 그 주 처음(일)/끝(토), PageUp PageDown 한 달(없는 날은 말일),
// Shift+PageUp PageDown 한 해. React 를 import 하지 않는다 (단위 테스트 대상)
import { addDays, dowOf, keyOf, parseKey, shiftMonth, type DateKey } from "./date";

/** 키 이벤트에서 쓰는 것만 */
export type GridKey = { key: string; shiftKey?: boolean; altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean };

/** n 달 앞/뒤 같은 날. 그 달에 없는 날이면 말일 (1월 31일 → 2월 28일 또는 29일) */
export function sameDayInMonth(key: DateKey, n: number): DateKey {
  const p = parseKey(key);
  const t = shiftMonth(p.y, p.m, n);
  const last = new Date(Date.UTC(t.y, t.m, 0)).getUTCDate();
  return keyOf(t.y, t.m, Math.min(p.d, last));
}

/** 월 격자에서 이 키로 옮길 날짜. 격자 키가 아니면(또는 Alt, Ctrl, Cmd 와 함께면) null */
export function monthGridTarget(from: DateKey, e: GridKey): DateKey | null {
  if (e.altKey || e.ctrlKey || e.metaKey) return null;
  switch (e.key) {
    case "ArrowLeft":
      return addDays(from, -1);
    case "ArrowRight":
      return addDays(from, 1);
    case "ArrowUp":
      return addDays(from, -7);
    case "ArrowDown":
      return addDays(from, 7);
    case "Home":
      return addDays(from, -dowOf(from));
    case "End":
      return addDays(from, 6 - dowOf(from));
    case "PageUp":
      return sameDayInMonth(from, e.shiftKey ? -12 : -1);
    case "PageDown":
      return sameDayInMonth(from, e.shiftKey ? 12 : 1);
    default:
      return null;
  }
}

/** 한 줄(한 주 7칸) 날짜 줄에서 이 키로 옮길 날짜. ← → 하루, Home End 그 주 처음/끝, PageUp PageDown 한 주. ↑ ↓ 는 없다 */
export function weekRowTarget(from: DateKey, e: GridKey): DateKey | null {
  if (e.altKey || e.ctrlKey || e.metaKey) return null;
  switch (e.key) {
    case "ArrowLeft":
      return addDays(from, -1);
    case "ArrowRight":
      return addDays(from, 1);
    case "Home":
      return addDays(from, -dowOf(from));
    case "End":
      return addDays(from, 6 - dowOf(from));
    case "PageUp":
      return addDays(from, -7);
    case "PageDown":
      return addDays(from, 7);
    default:
      return null;
  }
}

/**
 * 월 격자에서 Tab 으로 들어올 칸(tabIndex=0 하나). 그 달 안의 날짜만 고른다.
 * 방향키로 옮겨 둔 칸 → 선택한 날 → 오늘 → 1일 순 (다른 달 회색 칸은 고르지 않는다)
 */
export function monthTabKey(y: number, m: number, candidates: (DateKey | null | undefined)[]): DateKey {
  for (const k of candidates) {
    if (!k) continue;
    const p = parseKey(k);
    if (p.y === y && p.m === m) return k;
  }
  return keyOf(y, m, 1);
}

/** 달력 날짜 칸 버튼. 월 달력은 `[data-date] > button`(칸 안 버튼), 주 보기 날짜 머리는 `button[data-date]` */
export function dayCellSelector(date: DateKey): string {
  return `[data-date="${date}"] > button, button[data-date="${date}"]`;
}
