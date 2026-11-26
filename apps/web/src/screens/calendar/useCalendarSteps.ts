"use client";
// (#484) 날짜 상세 단계 (주소가 원본, 5-5). 주소(경로 + day, add)를 읽어 지금 단계(urlStep)와 닫힘 상태를 정한다.
// 단계를 바꾸는 동작(열기, 닫기, 한 단계 더)은 useStepNavigation. CalendarScreen 에서 옮김
import type { ReadonlyURLSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { type EventRouteTarget, parseDayStep, parseRouteStep, stepDepth, withDayStep } from "@/lib/calendar-url";
import { dateKeyOf, parseKey, todayKey, type DateKey } from "@/lib/date";
import { CALENDAR_PATH } from "@/lib/routes";
import type { Event } from "@/lib/types";
import { onEventRoute, routeKey, writeUrl } from "./calendar-history";

type Args = {
  initialEvent: EventRouteTarget | null;
  pathname: string;
  searchParams: ReadonlyURLSearchParams;
  today: DateKey;
  /** 보는 달(주) 일정과 다가오는 일정. 일정 상세 주소의 날짜를 찾는 데 쓴다 */
  events: Event[] | null;
  upcomingData: Event[] | null;
  selected: DateKey;
  y: number;
  m: number;
  setSelected: (date: DateKey) => void;
  setMonth: (month: { y: number; m: number }) => void;
};

export function useCalendarSteps({ initialEvent, pathname, searchParams, today, events, upcomingData, selected, y, m, setSelected, setMonth }: Args) {
  // 일정 상세 주소(/events/<코드>)에는 날짜가 없다. 연 순간 기억한 날짜(뒤로가기, 앞으로가기 복원) → 서버가 넘긴 자리 → 받아 둔 목록의 그 회차 순
  // (상태로 둔 Map. 연 순간 기록하고 렌더에서 읽기만 한다. 바뀐다고 다시 그릴 필요는 없다)
  const [routeDates] = useState(() => new Map<string, DateKey>());

  const rawStep = useMemo(() => {
    const dateOf = (code: string, occurrence: DateKey | null): DateKey | null => {
      const remembered = routeDates.get(routeKey(code, occurrence));
      if (remembered) return remembered;
      if (initialEvent && initialEvent.code === code) return initialEvent.date;
      const found = [...(events ?? []), ...(upcomingData ?? [])].find((e) => e.publicCode === code && (e.occurrence ?? null) === occurrence);
      return found ? dateKeyOf(found.startsAt) : null;
    };
    const step = parseRouteStep(pathname, searchParams, today, dateOf);
    // 반복 일정을 `?occurrence=` 없이 열면(공유, 알림) 서버가 알아낸 첫 회차
    if (step.open && step.step === "event" && step.occurrence === null && initialEvent?.code === step.code && initialEvent.occurrence) {
      return { ...step, occurrence: initialEvent.occurrence };
    }
    return step;
  }, [pathname, searchParams, today, initialEvent, events, upcomingData, routeDates]);
  // 새로고침, 공유 주소로 add=1 에 들어오면 빈 폼을 띄우지 않고 날짜 상세로 본다 (5-5). 주소는 아래 효과가 고친다.
  // Next 가 history 를 붙잡기 전의 replaceState 는 useSearchParams 에 안 잡히므로 화면은 이 값으로 정한다
  const [ignoreAdd, setIgnoreAdd] = useState(() => rawStep.open && rawStep.step === "add");
  const urlStep = useMemo<typeof rawStep>(
    () => (ignoreAdd && rawStep.open && rawStep.step === "add" ? { open: true, date: rawStep.date, step: "day" } : rawStep),
    [ignoreAdd, rawStep],
  );
  // 우리가 pushState 로 쌓지 않은 칸 수 (새로고침, 공유 주소로 day=1 에 바로 들어온 경우). 닫을 때 그만큼은 replaceState 로 뗀다
  // add=1 은 새로고침 시 무시하므로(아래 효과가 뗀다) 날짜 상세 한 칸으로 센다
  const [foreign, setForeign] = useState(() => (urlStep.open && urlStep.step === "add" ? 1 : stepDepth(urlStep)));
  // 닫기를 눌렀고 history.go(-n) 결과를 기다리는 중. 그동안 표면은 바로 숨긴다
  const [closing, setClosing] = useState(false);
  if (!urlStep.open && (closing || foreign !== 0)) {
    // 렌더 중 상태 맞추기 (주소가 닫힘이 되면 둘 다 처음으로)
    setClosing(false);
    setForeign(0);
  }
  const visible = urlStep.open && !closing;
  const ownDepth = Math.max(0, stepDepth(urlStep) - foreign);

  // phone 일 상세에서 고른 다른 날. replaceState 가 useSearchParams 에 닿기 전에도 화면이 그날을 그리게 (스와이프 중 옛 주가 비치지 않게)
  const [dayTarget, setDayTarget] = useState<DateKey | null>(null);
  if (dayTarget !== null && (!urlStep.open || urlStep.date === dayTarget)) setDayTarget(null);
  const openDate = urlStep.open ? (dayTarget ?? urlStep.date) : null;

  // 열린 상세의 날짜를 선택 날짜로 (앞으로가기, 새로고침으로 들어온 경우)
  if (visible && openDate && openDate !== selected) {
    setSelected(openDate);
    const p = parseKey(openDate);
    if (p.y !== y || p.m !== m) setMonth({ y: p.y, m: p.m });
  }

  // 새로고침으로 add=1 에 들어오면 빈 폼을 띄우지 않고 날짜 상세로 (5-5). 주소에서도 뗀다.
  // 자식 효과는 Next 앱 라우터의 효과보다 먼저 돌아서, 바로 replaceState 하면 Next 가 그 칸을 모른다. 한 틱 미룬다
  useEffect(() => {
    const t = setTimeout(() => {
      if (onEventRoute()) return;
      const first = parseDayStep(new URLSearchParams(window.location.search), todayKey());
      if (first.open && first.step === "add")
        writeUrl(`${CALENDAR_PATH}${withDayStep(window.location.search, { step: "day", date: first.date }, todayKey())}`, "replace");
    }, 0);
    return () => clearTimeout(t);
  }, []);

  /** 일정 상세를 연 날짜를 기억한다 (위 routeDates) */
  function rememberRoute(code: string, occurrence: DateKey | null, date: DateKey) {
    routeDates.set(routeKey(code, occurrence), date);
  }

  return { urlStep, visible, ownDepth, closing, setClosing, setForeign, setIgnoreAdd, setDayTarget, openDate, rememberRoute };
}

export type CalendarSteps = ReturnType<typeof useCalendarSteps>;
