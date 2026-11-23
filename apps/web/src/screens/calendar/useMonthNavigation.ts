"use client";
// (#484) 달력의 선택 날짜와 보는 달. ‹ ›, 오늘, 날짜 고르기 (CalendarScreen 에서 옮김)
import type { ReadonlyURLSearchParams } from "next/navigation";
import { useState } from "react";
import { dateParam, type EventRouteTarget, monthParam } from "@/lib/calendar-url";
import { addDays, parseKey, shiftMonth, type DateKey } from "@/lib/date";

type Args = {
  initialEvent: EventRouteTarget | null;
  searchParams: ReadonlyURLSearchParams;
  today: DateKey;
  /** (#192) 주 보기면 ‹ › 가 선택 날짜를 7일씩 옮긴다 */
  week: boolean;
};

export function useMonthNavigation({ initialEvent, searchParams, today, week }: Args) {
  // 처음 값은 서버 props 가 아니라 지금 주소에서 읽는다 (#81). 뒤로가기는 Next 가 캐시해 둔 처음 렌더(쿼리 없는 주소)를
  // 다시 쓰므로 서버가 넘긴 날짜는 오늘로 돌아가지만, useSearchParams 는 replaceState 로 바꿔 둔 주소를 돌려준다
  const [selected, setSelected] = useState(() => initialEvent?.date ?? dateParam(searchParams.get("date")) ?? today);
  const [{ y, m }, setMonth] = useState(() => monthParam(searchParams.get("month")) ?? parseKey(selected));

  function go(n: number) {
    // (#192) 주 보기는 선택 날짜를 n 주 옮긴다 (보는 달은 그 날짜를 따라간다)
    if (week) pick(addDays(selected, n * 7));
    else setMonth(shiftMonth(y, m, n));
  }
  function goToday() {
    const p = parseKey(today);
    setMonth({ y: p.y, m: p.m });
    setSelected(today);
  }
  function pick(key: string) {
    setSelected(key);
    const p = parseKey(key);
    if (p.y !== y || p.m !== m) setMonth({ y: p.y, m: p.m });
  }

  return { selected, setSelected, y, m, setMonth, go, goToday, pick };
}
