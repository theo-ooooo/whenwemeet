// 반복 일정(#187) 화면 공통 규칙. React 를 import 하지 않는다 (단위 테스트 대상)
// 규칙 원본은 docs/설계/반복-일정.md 4-1, 서버는 apps/api/src/events/recurrence.ts
import type { Repeat } from "./types";

const DAY_MS = 86_400_000;

/** 목록 항목 키. 반복 회차는 같은 id 가 여러 번 나오므로 회차 날짜를 붙인다 (api.md 2.3) */
export function eventKey(ev: { id: number; occurrence?: string | null }): string {
  return `${ev.id}:${ev.occurrence ?? ""}`;
}

/** 주기별 일정 길이 상한 (이 값 이상이면 거부) */
export const REPEAT_PERIOD_DAYS: Record<Repeat, number> = { WEEKLY: 7, BIWEEKLY: 14, MONTHLY: 28, YEARLY: 365 };

export const REPEATS: readonly Repeat[] = ["WEEKLY", "BIWEEKLY", "MONTHLY", "YEARLY"];

/** 주기 이름 "매주" "격주" "매월" "매년" */
export const REPEAT_NAME: Record<Repeat, string> = { WEEKLY: "매주", BIWEEKLY: "격주", MONTHLY: "매월", YEARLY: "매년" };

/**
 * 반복 규칙 클라이언트 검증 (설계 4-1 앞 두 줄). 문제 없으면 null.
 * startDate 는 첫 회차 KST 날짜(폼의 시작 날짜), until 은 'YYYY-MM-DD' 또는 null(계속)
 */
export function repeatRuleError(
  repeat: Repeat | null,
  startsAtMs: number,
  endsAtMs: number,
  startDate: string,
  until: string | null,
): string | null {
  if (!repeat) return null;
  if (endsAtMs - startsAtMs >= REPEAT_PERIOD_DAYS[repeat] * DAY_MS) return "반복 간격보다 긴 일정은 반복할 수 없어요";
  if (until !== null && until < startDate) return "종료 날짜는 시작 날짜 뒤여야 해요";
  return null;
}

/** 일정 수정 화면 주소. 반복 회차면 ?occurrence= 를 붙인다 */
export function eventEditHref(groupId: number, ev: { id: number; occurrence?: string | null }): string {
  return `/g/${groupId}/events/${ev.id}${ev.occurrence ? `?occurrence=${ev.occurrence}` : ""}`;
}

/** 일정 복제 주소. 반복 회차면 그 회차 값으로 채우게 occurrence 를 같이 */
export function eventCopyHref(groupId: number, ev: { id: number; occurrence?: string | null }): string {
  return `/g/${groupId}/events/new?copy=${ev.id}${ev.occurrence ? `&occurrence=${ev.occurrence}` : ""}`;
}
