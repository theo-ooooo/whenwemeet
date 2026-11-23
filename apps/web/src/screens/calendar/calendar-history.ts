// 달력 화면의 주소 기록 도우미 (#484). CalendarScreen 과 날짜 상세 단계 훅(useCalendarSteps, useStepNavigation)이 같이 쓴다
import type { StepTarget } from "@/lib/calendar-url";
import type { DateKey } from "@/lib/date";
import { routeInfo } from "@/lib/routes";

/** 일정 상세를 여는 데 필요한 것. 반복 회차는 회차 날짜까지 (#187). 주소에는 공개 코드가 실린다 (#311) */
export type EventRef = { publicCode: string; occurrence: DateKey | null };
export const eventStep = (date: DateKey, ev: EventRef): StepTarget => ({ step: "event", date, code: ev.publicCode, occurrence: ev.occurrence ?? null });
export const routeKey = (code: string, occurrence: DateKey | null) => `${code}:${occurrence ?? ""}`;

/** 주소(경로 + search)를 기록에 쓴다. state 는 null (#57: Next 가 내부 state 를 붙이고 usePathname, useSearchParams 를 맞춘다) */
export function writeUrl(url: string, mode: "push" | "replace") {
  const full = `${url}${window.location.hash}`;
  if (mode === "push") window.history.pushState(null, "", full);
  else window.history.replaceState(null, "", full);
}

/** 지금 일정 상세 경로(`/events/<코드>`) 위에 있는가. 그러면 달력 쿼리(date, month)는 주소에 없다 */
export const onEventRoute = () => routeInfo(window.location.pathname).eventDetail;
