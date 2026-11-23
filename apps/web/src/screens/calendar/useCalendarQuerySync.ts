"use client";
// (#484) 선택 날짜, 보는 달, 보기(월 | 주)를 주소 쿼리에 남긴다. CalendarScreen 에서 옮김
import type { ReadonlyURLSearchParams } from "next/navigation";
import { useCallback, useEffect } from "react";
import { type CalView, withCalView } from "@/lib/calendar-view";
import { withSelection } from "@/lib/calendar-url";
import type { DateKey } from "@/lib/date";
import { CALENDAR_PATH } from "@/lib/routes";
import { onEventRoute, writeUrl } from "./calendar-history";

type Args = {
  selected: DateKey;
  today: DateKey;
  y: number;
  m: number;
  view: CalView;
  /** 뒤로가기로 주소가 바뀐 뒤에도 다시 맞추도록 같이 본다 */
  searchParams: ReadonlyURLSearchParams;
  pathname: string;
};

/** @returns calendarSearch: 달력 쿼리의 바탕 (일정 상세 경로 위에서는 지금 선택 날짜와 보는 달로 만든다) */
export function useCalendarQuerySync({ selected, today, y, m, view, searchParams, pathname }: Args) {
  // 선택 날짜와 보던 달을 URL 에 남긴다 (새로고침, 공유, 뒤로가기 복원 #81, + 버튼의 기준 날짜 #57)
  // router.replace 대신 history.replaceState 를 쓴다. router.replace 는 날짜를 누를 때마다 서버 렌더를 다시 받는다.
  // 뒤로가기로 주소가 바뀐 뒤에도 다시 맞추도록 searchParams 를 같이 본다. day, add 는 건드리지 않는다.
  // 일정 상세 경로(/events/<코드>) 위에서는 쓰지 않는다 (그 주소에는 달력 쿼리가 없다)
  useEffect(() => {
    if (onEventRoute()) return;
    const next = withSelection(window.location.search, selected, today, { y, m });
    if (next !== null) writeUrl(`${CALENDAR_PATH}${next}`, "replace");
  }, [selected, today, y, m, searchParams, pathname]);

  // (#192) 보기를 주소에 남긴다 (저장값으로 주 보기가 된 경우도 새로고침, 공유가 같은 보기로 열리게). 일정 상세 경로 위에서는 쓰지 않는다
  useEffect(() => {
    if (onEventRoute()) return;
    const next = withCalView(window.location.search, view);
    if (next !== null) writeUrl(`${CALENDAR_PATH}${next}`, "replace");
  }, [view, searchParams, pathname]);

  /** 달력 쿼리의 바탕. 일정 상세 경로 위에서는 주소에 없으니 지금 선택 날짜와 보는 달로 만든다 */
  return useCallback(() => (onEventRoute() ? (withSelection("", selected, today, { y, m }) ?? "") : window.location.search), [selected, today, y, m]);
}
