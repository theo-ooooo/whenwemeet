// 빈 시간 표시 규칙 하나 (#136). 달력 개요의 "오늘 모두 비는 시간" 과 빈 시간 찾기가 같은 값을 보여야 한다.
// 규칙은 api.md 2.5 free-slots: from 이 과거면 지금을 다음 30분 경계로 올려 자른다 (14:37 → 15:00, 14:00 은 그대로, D-30).
// 서버(apps/api free-slots/slots.ts ceilToSlotStep)와 목(mocks/handler.ts)이 이미 그렇게 계산하지만,
// 응답을 받은 뒤 시간이 흘러 경계를 넘으면 화면에서 한 번 더 같은 규칙으로 자른다
import type { FreeSlots } from "./types";

export const SLOT_STEP_MINUTES = 30;

/** 다음 step 분 경계로 올림 (경계 위면 그대로) */
export function ceilToStep(ms: number, stepMinutes: number = SLOT_STEP_MINUTES): number {
  const step = stepMinutes * 60_000;
  return Math.ceil(ms / step) * step;
}

/** 지금(30분 올림) 이후로 자르고, 잘린 뒤 minMinutes 보다 짧아진 구간은 뺀다 */
export function upcomingSlots(
  slots: FreeSlots["slots"] | undefined,
  minMinutes: number,
  now: number = Date.now(),
): FreeSlots["slots"] {
  const from = ceilToStep(now);
  return (slots ?? [])
    .map((s) => (Date.parse(s.startsAt) >= from ? s : { startsAt: new Date(from).toISOString(), endsAt: s.endsAt }))
    .filter((s) => Date.parse(s.endsAt) - Date.parse(s.startsAt) >= minMinutes * 60_000);
}
