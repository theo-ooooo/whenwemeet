// 달력 주소 규칙 (#81, 폴더블.md 5-5). React 를 import 하지 않는다 (단위 테스트 대상)
//   ?date=YYYY-MM-DD  선택 날짜. 오늘이면 생략
//   ?month=YYYY-MM    보던 달. 선택 날짜의 달과 같으면 생략
//   &day=1            날짜 상세(시트/팝오버) 열림. pushState 로 한 칸
//   &event=<id>       그 안에서 일정 상세. 한 칸 더
//   &occurrence=YYYY-MM-DD  반복 일정이면 그 회차 날짜 (#187). event 와 같이만 쓴다
//   &add=1            그 안에서 빠른 추가. 한 칸 더 (새로고침 시 무시)
import { parseKey, type DateKey } from "./date";

/** 쿼리의 날짜(YYYY-MM-DD)를 검사한다. 2026-02-31 처럼 없는 날은 버린다 */
export function dateParam(raw: string | null): DateKey | null {
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const { y, m, d } = parseKey(raw);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d ? raw : null;
}

/** 쿼리의 보던 달(YYYY-MM) */
export function monthParam(raw: string | null): { y: number; m: number } | null {
  if (!raw || !/^\d{4}-(0[1-9]|1[0-2])$/.test(raw)) return null;
  const [y, m] = raw.split("-").map(Number);
  return { y, m };
}

export type DayStep =
  | { open: false }
  | { open: true; date: DateKey; step: "day" }
  | { open: true; date: DateKey; step: "event"; eventId: number; occurrence: DateKey | null }
  | { open: true; date: DateKey; step: "add" };

type Params = { get(name: string): string | null };

/** 주소 → 날짜 상세 상태. day=1 이 없으면 닫힘. event 와 add 가 같이 있으면 event 를 따른다 */
export function parseDayStep(params: Params, today: DateKey): DayStep {
  if (params.get("day") !== "1") return { open: false };
  const date = dateParam(params.get("date")) ?? today;
  const ev = params.get("event");
  if (ev && /^[1-9]\d{0,15}$/.test(ev)) {
    return { open: true, date, step: "event", eventId: Number(ev), occurrence: dateParam(params.get("occurrence")) };
  }
  if (params.get("add") === "1") return { open: true, date, step: "add" };
  return { open: true, date, step: "day" };
}

/** 이 상태가 쌓는 기록 칸 수. 닫힘 0, 날짜 상세 1, 일정 상세/빠른 추가 2 */
export function stepDepth(s: DayStep): 0 | 1 | 2 {
  if (!s.open) return 0;
  return s.step === "day" ? 1 : 2;
}

export type StepTarget =
  | { step: "closed" }
  | { step: "day"; date: DateKey }
  | { step: "event"; date: DateKey; eventId: number; occurrence: DateKey | null }
  | { step: "add"; date: DateKey };

/**
 * 지금 주소(search 문자열)에 날짜 상세 상태를 입힌 새 search 문자열을 돌려준다 ("?" 포함, 비면 "").
 * date 는 #81 규칙대로 오늘이면 뗀다. month 등 다른 쿼리는 건드리지 않는다 (closed 이면 date 도 그대로)
 */
export function withDayStep(search: string, target: StepTarget, today: DateKey): string {
  const q = new URLSearchParams(search);
  q.delete("day");
  q.delete("event");
  q.delete("occurrence");
  q.delete("add");
  if (target.step !== "closed") {
    if (target.date === today) q.delete("date");
    else q.set("date", target.date);
    q.set("day", "1");
    if (target.step === "event") {
      q.set("event", String(target.eventId));
      if (target.occurrence) q.set("occurrence", target.occurrence);
    }
    if (target.step === "add") q.set("add", "1");
  }
  const s = q.toString();
  return s ? `?${s}` : "";
}

/**
 * 선택 날짜와 보던 달을 쿼리에 맞춘 search 문자열 (#81). 바뀔 게 없으면 null.
 * date 는 오늘이 아닐 때만, month 는 선택 날짜와 다른 달을 볼 때만 붙인다
 */
export function withSelection(search: string, selected: DateKey, today: DateKey, view: { y: number; m: number }): string | null {
  const q = new URLSearchParams(search);
  const sel = parseKey(selected);
  const date = selected === today ? null : selected;
  const month = sel.y === view.y && sel.m === view.m ? null : `${view.y}-${String(view.m).padStart(2, "0")}`;
  if (q.get("date") === date && q.get("month") === month) return null;
  if (date) q.set("date", date);
  else q.delete("date");
  if (month) q.set("month", month);
  else q.delete("month");
  const s = q.toString();
  return s ? `?${s}` : "";
}

/**
 * 달력 밖(다가오는 일정 목록, #222)에서 일정 상세로 가는 주소. 홈 다가오는 일정 카드와 같은 곳(그날 상세 → 일정 상세)을 연다.
 * date 는 그 일정을 묶은 날 (오늘이면 date 를 뗀다)
 */
export function calendarEventHref(groupId: number, date: DateKey, ev: { id: number; occurrence?: string | null }, today: DateKey): string {
  return `/g/${groupId}/calendar${withDayStep("", { step: "event", date, eventId: ev.id, occurrence: ev.occurrence ?? null }, today)}`;
}

/**
 * 일정 화면(수정, 복제)에서 일정이 404 일 때 갈 곳 (QA3-L7).
 * - 회차 주소(?occurrence=) 인데 원본은 아직 있으면: 그 회차 날짜의 일 상세. 회차가 "이후 모두" 로 새 원본에 옮겨 갔거나
 *   (새 소식 "이 일정만" 기록이 옛 원본을 가리킨다) 그 회차만 취소된 경우라, 그날을 보여 주는 것이 맞다
 * - 회차 주소가 아니거나 원본도 없으면: "이미 삭제된 일정이에요" + 달력 (지금 규칙)
 */
export function missingEventTarget(
  groupId: number,
  occurrence: DateKey | null | undefined,
  seriesAlive: boolean,
  today: DateKey,
): { href: string; deleted: boolean } {
  if (occurrence && seriesAlive) return { href: `/g/${groupId}/calendar${withDayStep("", { step: "day", date: occurrence }, today)}`, deleted: false };
  return { href: `/g/${groupId}/calendar`, deleted: true };
}
