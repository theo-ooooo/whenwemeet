// 달력 주소 규칙 (#81, 폴더블.md 5-5, #311 D-198). React 를 import 하지 않는다 (단위 테스트 대상)
//   /calendar?date=YYYY-MM-DD  선택 날짜. 오늘이면 생략
//   ?month=YYYY-MM    보던 달. 선택 날짜의 달과 같으면 생략
//   &day=1            날짜 상세(폰 일 상세, 넓은 화면 오른쪽 패널) 열림. pushState 로 한 칸
//   &add=1            그 안에서 빠른 추가. 한 칸 더 (새로고침 시 무시)
//   /events/<일정 공개 코드>[?occurrence=YYYY-MM-DD]  그 안에서 일정 상세. 한 칸 더. 경로가 바뀌지만 같은 달력 화면이 그린다 (pushState)
//     반복 일정이면 occurrence 가 그 회차의 원래 날짜 (#187). 옛 `&event=<번호>` 는 받지 않는다 (옛 주소는 lib/legacy-routes.ts 가 바꾼다)
import { parseKey, type DateKey } from "./date";
import { CALENDAR_PATH, eventHref, routeInfo } from "./routes";

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

/** `/events/<코드>` 로 바로 들어왔을 때 서버가 알아낸 일정 자리 (CalendarScreen initialEvent). date 는 그 회차가 시작하는 KST 날짜 */
export type EventRouteTarget = { code: string; date: DateKey; occurrence: DateKey | null };

export type DayStep =
  | { open: false }
  | { open: true; date: DateKey; step: "day" }
  | { open: true; date: DateKey; step: "event"; code: string; occurrence: DateKey | null }
  | { open: true; date: DateKey; step: "add" };

type Params = { get(name: string): string | null };

/** `/calendar` 의 쿼리 → 날짜 상세 상태. day=1 이 없으면 닫힘 */
export function parseDayStep(params: Params, today: DateKey): DayStep {
  if (params.get("day") !== "1") return { open: false };
  const date = dateParam(params.get("date")) ?? today;
  if (params.get("add") === "1") return { open: true, date, step: "add" };
  return { open: true, date, step: "day" };
}

/**
 * 경로까지 보는 날짜 상세 상태. `/events/<코드>` 면 일정 상세 단계 (회차는 `?occurrence=`).
 * 그 일정의 날짜(시트 뒤에 보일 날)는 호출자가 안다: 연 순간 기억한 값, 서버가 넘긴 값, 받아 둔 일정 목록 순. 모르면 오늘
 */
export function parseRouteStep(pathname: string, params: Params, today: DateKey, dateOf: (code: string, occurrence: DateKey | null) => DateKey | null): DayStep {
  const info = routeInfo(pathname);
  if (info.eventDetail && info.eventCode) {
    const occurrence = dateParam(params.get("occurrence"));
    return { open: true, step: "event", code: info.eventCode, occurrence, date: dateOf(info.eventCode, occurrence) ?? today };
  }
  return parseDayStep(params, today);
}

/** 이 상태가 쌓는 기록 칸 수. 닫힘 0, 날짜 상세 1, 일정 상세/빠른 추가 2 */
export function stepDepth(s: DayStep): 0 | 1 | 2 {
  if (!s.open) return 0;
  return s.step === "day" ? 1 : 2;
}

export type StepTarget =
  | { step: "closed" }
  | { step: "day"; date: DateKey }
  | { step: "event"; date: DateKey; code: string; occurrence: DateKey | null }
  | { step: "add"; date: DateKey };

/**
 * 달력 주소(search 문자열)에 날짜 상세 상태(닫힘, 날짜 상세, 빠른 추가)를 입힌 새 search 문자열 ("?" 포함, 비면 "").
 * date 는 #81 규칙대로 오늘이면 뗀다. month 등 다른 쿼리는 건드리지 않는다 (closed 이면 date 도 그대로).
 * 일정 상세는 search 가 아니라 경로(`/events/<코드>`)라 dayStepUrl 이 맡는다
 */
export function withDayStep(search: string, target: Exclude<StepTarget, { step: "event" }>, today: DateKey): string {
  const q = new URLSearchParams(search);
  q.delete("day");
  q.delete("add");
  // 옛 주소의 흔적(#311 전 `&event=`)은 지운다
  q.delete("event");
  q.delete("occurrence");
  if (target.step !== "closed") {
    if (target.date === today) q.delete("date");
    else q.set("date", target.date);
    q.set("day", "1");
    if (target.step === "add") q.set("add", "1");
  }
  const s = q.toString();
  return s ? `?${s}` : "";
}

/**
 * 날짜 상세 상태를 입힌 전체 주소 (경로 + search). 일정 상세는 `/events/<코드>[?occurrence=]`,
 * 그 밖은 `/calendar` + withDayStep. calendarSearch 는 달력 쿼리(date, month ...)의 바탕
 */
export function dayStepUrl(calendarSearch: string, target: StepTarget, today: DateKey): string {
  if (target.step === "event") return eventHref({ publicCode: target.code, occurrence: target.occurrence });
  return `${CALENDAR_PATH}${withDayStep(calendarSearch, target, today)}`;
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
 * 일정 화면(수정, 복제)에서 일정이 404 일 때 갈 곳 (QA3-L7).
 * - 회차 주소(?occurrence=) 인데 원본은 아직 있으면: 그 회차 날짜의 일 상세. 회차가 "이후 모두" 로 새 원본에 옮겨 갔거나
 *   (새 소식 "이 일정만" 기록이 옛 원본을 가리킨다) 그 회차만 취소된 경우라, 그날을 보여 주는 것이 맞다
 * - 회차 주소가 아니거나 원본도 없으면: "이미 삭제된 일정이에요" + 달력 (지금 규칙)
 */
export function missingEventTarget(occurrence: DateKey | null | undefined, seriesAlive: boolean, today: DateKey): { href: string; deleted: boolean } {
  if (occurrence && seriesAlive) return { href: `${CALENDAR_PATH}${withDayStep("", { step: "day", date: occurrence }, today)}`, deleted: false };
  return { href: CALENDAR_PATH, deleted: true };
}
