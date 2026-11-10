// 반복 설명 문구 (#187, 기획 3-5, 설계 5장). React 를 import 하지 않는다 (단위 테스트 대상)
//   "매주 목요일" "격주 목요일" "매월 31일" "매년 5월 5일", 종료가 있으면 "12월 31일까지"
// 기준은 항상 첫 회차의 KST 날짜다. 매월 31일은 짧은 달에 말일로 가지만 설명은 기준 날짜 그대로 "매월 31일"
import { dateKeyOf, dowOf, parseKey, WEEKDAYS, type DateKey } from "./date";
import type { Repeat } from "./types";
import { REPEAT_NAME } from "./recurrence";

/** 첫 회차 날짜(KST 키) 기준 반복 설명 */
export function repeatLabel(repeat: Repeat, firstDate: DateKey): string {
  const { m, d } = parseKey(firstDate);
  switch (repeat) {
    case "WEEKLY":
    case "BIWEEKLY":
      return `${REPEAT_NAME[repeat]} ${WEEKDAYS[dowOf(firstDate)]}요일`;
    case "MONTHLY":
      return `매월 ${d}일`;
    case "YEARLY":
      return `매년 ${m}월 ${d}일`;
  }
}

/** 반복 종료 줄 "12월 31일까지". 올해가 아니면 연도를 붙인다 ("2027년 1월 31일까지") */
export function repeatUntilLabel(until: DateKey, today: DateKey): string {
  const u = parseKey(until);
  const year = u.y !== parseKey(today).y ? `${u.y}년 ` : "";
  return `${year}${u.m}월 ${u.d}일까지`;
}

/**
 * 일정 상세의 반복 줄. 한 번짜리면 null.
 * seriesStartsAt(첫 회차 시작 ISO) 이 없으면 회차 날짜로 대신한다
 */
export function recurrenceLines(
  ev: { repeat: Repeat | null; repeatUntil: string | null; seriesStartsAt: string | null; startsAt: string },
  today: DateKey,
): { rule: string; until: string | null } | null {
  if (!ev.repeat) return null;
  const first = dateKeyOf(ev.seriesStartsAt ?? ev.startsAt);
  return { rule: repeatLabel(ev.repeat, first), until: ev.repeatUntil ? repeatUntilLabel(ev.repeatUntil, today) : null };
}
