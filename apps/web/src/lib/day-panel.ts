// (#331) 넓은 화면(fold 이상) 일 상세 오른쪽 패널의 순수 판단. React 를 import 하지 않는다 (단위 테스트 대상)
// 패널 자리(오른쪽 칸 / 덮는 시트)는 본문 폭 MAIN_PANEL(lib/layout.ts, globals.css main-panel) 로 CSS 가 고른다
import { addDays, dowOf, parseKey, WEEKDAYS, type DateKey } from "./date";
import type { DayStep } from "./calendar-url";

/** 패널 폭 (디자인규칙.md 2-2 "일 상세 패널") */
export const PANEL_W = 400;

/** 패널 머리 제목 "11월 14일 토요일" */
export function panelTitle(date: DateKey): string {
  const p = parseKey(date);
  return `${p.m}월 ${p.d}일 ${WEEKDAYS[dowOf(date)]}요일`;
}

/** 머리 "‹ 13 [14] 15 ›" 의 세 날 (전날, 그날, 다음 날). 달, 해를 넘어가도 이어진다 */
export function panelDays(date: DateKey): [DateKey, DateKey, DateKey] {
  return [addDays(date, -1), date, addDays(date, 1)];
}

/**
 * 패널이 열린 채 다른 날(또는 그날의 일정)을 고를 때 주소를 어떻게 옮길지.
 * - open: 닫혀 있다 → 날짜 단계를 한 칸 쌓는다 (예전 팝오버와 같은 pushState)
 * - replace: 날짜 단계 위 → 기록을 더 쌓지 않고 날짜만 바꾼다 (패널 내용만 바뀐다)
 * - back: 우리가 쌓은 일정 상세/빠른 추가 위 → 한 칸 되돌린 뒤 날짜만 바꾼다
 * - rewrite: 새로 고침, 공유 주소로 바로 들어온 일정 상세 위(되돌릴 칸이 없다) → 주소를 날짜 단계로 바꿔 쓴다
 */
export type PanelMove = "open" | "replace" | "back" | "rewrite";

export function panelMove(step: DayStep, ownDepth: number): PanelMove {
  if (!step.open) return "open";
  if (step.step === "day") return "replace";
  return ownDepth >= 1 ? "back" : "rewrite";
}
