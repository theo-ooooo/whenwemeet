// 반복 설명 문구 (#187, 기획 3-5, 설계 5장). React 를 import 하지 않는다 (단위 테스트 대상)
//   "매주 목요일" "격주 목요일" "매월 31일" "매년 5월 5일", 종료가 있으면 "12월 31일까지"
// 기준은 반복 기준 날짜(repeatAnchor, D-71), 없으면 첫 회차의 KST 날짜다. 매월 31일은 짧은 달에 말일로 가지만 설명은 기준 날짜 그대로 "매월 31일"
import { dateKeyOf, dowOf, parseKey, WEEKDAYS, type DateKey } from "./date";
import { formatLunar, solarToLunar } from "./lunar";
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
    case "YEARLY_LUNAR": {
      // (#562) "매년 음력 3월 15일" (윤달 기준이면 "음력 윤4월 15일"). 변환 범위 밖이면 이름만
      const l = solarToLunar(firstDate);
      return l ? `매년 ${formatLunar(l.month, l.day, l.leap)}` : REPEAT_NAME.YEARLY_LUNAR;
    }
  }
}

/** 반복 종료 줄 "12월 31일까지". 올해가 아니면 연도를 붙인다 ("2027년 1월 31일까지") */
export function repeatUntilLabel(until: DateKey, today: DateKey): string {
  const u = parseKey(until);
  const year = u.y !== parseKey(today).y ? `${u.y}년 ` : "";
  return `${year}${u.m}월 ${u.d}일까지`;
}

type SeriesLike = { repeat: Repeat | null; seriesStartsAt: string | null; startsAt: string; repeatAnchor?: string | null };

/**
 * 반복 설명의 기준 날짜 (D-71). 매월/매년은 repeatAnchor, 없거나 주간이면 첫 회차(seriesStartsAt) 의 KST 날짜.
 * seriesStartsAt 이 없으면 회차 날짜로 대신한다
 */
export function ruleDateKey(ev: SeriesLike): DateKey {
  if (ev.repeatAnchor && (ev.repeat === "MONTHLY" || ev.repeat === "YEARLY" || ev.repeat === "YEARLY_LUNAR")) return ev.repeatAnchor;
  return dateKeyOf(ev.seriesStartsAt ?? ev.startsAt);
}

/** 일정 상세의 반복 줄. 한 번짜리면 null */
export function recurrenceLines(ev: SeriesLike & { repeatUntil: string | null }, today: DateKey): { rule: string; until: string | null } | null {
  if (!ev.repeat) return null;
  return { rule: repeatLabel(ev.repeat, ruleDateKey(ev)), until: ev.repeatUntil ? repeatUntilLabel(ev.repeatUntil, today) : null };
}

/**
 * 일정 폼 "반복" 줄과 반복 시트 항목의 설명 날짜 (QA3-M3).
 * 반복 일정을 고치면서 주기를 그대로 두고 날짜도 그대로면(시각을 안 건드렸거나 원래 회차 날짜 그대로) 서버가 규칙을 이어받으므로
 * 원본 기준 날짜로, 아니면 폼의 시작 날짜(새 시작이 기준) 로 설명한다
 */
export function formRuleDate(series: (SeriesLike & { occurrence: string | null }) | null, repeat: Repeat, startDate: DateKey, timesKept: boolean): DateKey {
  if (!series || repeat !== series.repeat) return startDate;
  return timesKept || startDate === series.occurrence ? ruleDateKey(series) : startDate;
}
