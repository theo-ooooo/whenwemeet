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

// 일정 수정, 복제 주소는 lib/routes.ts eventEditHref, eventCopyHref (#311)

/**
 * "이후 모두" 저장 때 시작, 종료를 불러온 회차 값 그대로 두었는지 (같은 순간이면 같다). 그대로면 본문에서 빼서
 * 서버가 그 회차의 규칙 자리(옮기기 전, 말일 보정된 날짜) 에서 잇게 한다. 보내면 옮긴 회차의 요일, 날짜가 새 기준이 된다 (QA3-M3)
 */
export function keepsLoadedTimes(payload: { startsAt: string; endsAt: string }, loaded: { startsAt: string; endsAt: string }): boolean {
  return Date.parse(payload.startsAt) === Date.parse(loaded.startsAt) && Date.parse(payload.endsAt) === Date.parse(loaded.endsAt);
}

/**
 * 폼에 채울 반복 값. 복제(copy) 는 회차 하나를 한 번짜리 새 일정으로 만든다 (QA3-L2): 반복 안 함, 종료 없음.
 * 수정은 불러온 값 그대로
 */
export function formRepeatOf(ev: { repeat: Repeat | null; repeatUntil: string | null }, copying: boolean): { repeat: Repeat | null; until: string | null } {
  return copying ? { repeat: null, until: null } : { repeat: ev.repeat, until: ev.repeatUntil };
}

/**
 * "이후 모두" 저장 때 보낼 repeatUntil. 종료 날짜를 원본 값 그대로 두었으면 undefined(보내지 않음).
 * 서버가 원본 값을 이어받고, 회차를 그 종료 날짜 뒤로 옮겼으면 새 시작 날짜까지 늘린다 (QA3-L1).
 * 그대로 보내면 사용자가 건드리지 않은 종료 날짜 때문에 "종료 날짜는 시작 날짜 뒤여야 해요" 로 막힌다
 */
export function followingUntil(until: string | null, seriesUntil: string | null): string | null | undefined {
  return until !== null && until === seriesUntil ? undefined : until;
}
