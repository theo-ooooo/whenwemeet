// (#269) 기념일 알림 시점 (기획 푸시-알림.md 3-7, 설계 api.md 2.4, 결정 D-144, D-145).
// 칩 4개: 당일 / 하루 전 / 일주일 전 / 없음. 앞 셋은 여러 개, "없음" 은 셋을 끈다. 순수 함수 (단위 테스트 대상)
import type { Anniversary, AnniversaryKind, AnniversaryReminder } from "./types";

export const REMINDER_ORDER: readonly AnniversaryReminder[] = ["DAY_OF", "DAY_BEFORE", "WEEK_BEFORE"];

/** 칩 값. NONE = 알림 없음 (API 로는 빈 배열) */
export type ReminderChoice = AnniversaryReminder | "NONE";

export const REMINDER_CHOICES: { value: ReminderChoice; label: string }[] = [
  { value: "DAY_OF", label: "당일" },
  { value: "DAY_BEFORE", label: "하루 전" },
  { value: "WEEK_BEFORE", label: "일주일 전" },
  { value: "NONE", label: "없음" },
];

/** 추가 시트 기본값 (서버 기본과 같음) */
export const DEFAULT_REMINDERS: readonly AnniversaryReminder[] = ["DAY_OF"];

/** 당일, 하루 전, 일주일 전 순으로 중복 없이 */
export function normalizeReminders(list: readonly AnniversaryReminder[]): AnniversaryReminder[] {
  return REMINDER_ORDER.filter((r) => list.includes(r));
}

/** 응답에 칸이 없으면(#269 전 API) 서버 기본과 같은 당일만 */
export function remindersOf(a: Pick<Anniversary, "reminders">): AnniversaryReminder[] {
  return Array.isArray(a.reminders) ? normalizeReminders(a.reminders) : [...DEFAULT_REMINDERS];
}

/** 칩이 켜져 있는가. "없음" 은 셋 다 꺼졌을 때 */
export function isChoiceOn(list: readonly AnniversaryReminder[], choice: ReminderChoice): boolean {
  return choice === "NONE" ? list.length === 0 : list.includes(choice);
}

/** 칩 누르기. "없음" 은 전부 끄고, 나머지는 켜고 끄기 (마지막 하나를 끄면 "없음") */
export function toggleReminder(list: readonly AnniversaryReminder[], choice: ReminderChoice): AnniversaryReminder[] {
  if (choice === "NONE") return [];
  return list.includes(choice) ? normalizeReminders(list.filter((r) => r !== choice)) : normalizeReminders([...list, choice]);
}

/** 함께한 날 세기에서 일주일 전을 켜면 100일 단위는 하루 전까지만 온다 (D-145) */
export function reminderHint(kind: AnniversaryKind, list: readonly AnniversaryReminder[]): string | null {
  return kind === "COUNT_UP" && list.includes("WEEK_BEFORE") ? "100일 단위는 하루 전까지만 알려 드려요" : null;
}

export function sameReminders(a: readonly AnniversaryReminder[], b: readonly AnniversaryReminder[]): boolean {
  const x = normalizeReminders(a);
  const y = normalizeReminders(b);
  return x.length === y.length && x.every((r, i) => r === y[i]);
}

/** (#378) 알림 줄 값 "당일, 하루 전" (없으면 "없음"). 순서는 당일, 하루 전, 일주일 전 */
export function reminderSummary(list: readonly AnniversaryReminder[]): string {
  const on = normalizeReminders(list);
  if (on.length === 0) return "없음";
  return on.map((r) => REMINDER_CHOICES.find((c) => c.value === r)?.label ?? r).join(", ");
}
