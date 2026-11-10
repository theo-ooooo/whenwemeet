// 새 소식 문구 (#187, 설계 4-3, 기획 3-6). React 를 import 하지 않는다 (단위 테스트 대상)
// 화면은 "{이름}님이 '{제목}' " 뒤에 newsPhrase 를 붙인다
import { dateKeyOf, formatDateKo, parseKey, type DateKey } from "./date";
import { REPEAT_NAME } from "./recurrence";
import type { NewsItem } from "./types";

type Item = Pick<NewsItem, "action" | "repeat" | "scope" | "occurrence" | "eventId">;

const md = (key: string) => {
  const { m, d } = parseKey(key);
  return `${m}월 ${d}일`;
};

/** 제목 뒤 문구. 반복이 아닌 일정(또는 범위 정보가 없는 기록)은 예전 그대로 "일정을 추가했어요" 형태 */
export function newsPhrase(item: Item): string {
  const { action, repeat, scope, occurrence } = item;
  if (action === "CREATED") return repeat && !scope ? `${REPEAT_NAME[repeat]} 반복 일정을 추가했어요` : "일정을 추가했어요";
  if (scope && occurrence) {
    const day = md(occurrence);
    if (action === "UPDATED") return scope === "THIS" ? `${day} 일정만 수정했어요` : `${day}부터 반복 일정을 수정했어요`;
    return scope === "THIS" ? `${day} 일정을 삭제했어요` : `${day}부터 반복을 삭제했어요`;
  }
  return action === "UPDATED" ? "일정을 수정했어요" : "일정을 삭제했어요";
}

/**
 * 누르면 갈 주소. 일정이 없거나 삭제 기록이면 null (지금 규칙).
 * "이 일정만" 은 그 회차로(occurrence 는 원래 날짜라 옮긴 회차도 찾는다).
 * "이후 모두" 는 그 회차가 (새) 원본의 첫 회차가 되므로 occurrence 없이 연다. 시작 날짜를 옮겼으면
 * 원래 날짜가 새 규칙의 회차가 아니라 occurrence 를 붙이면 404 가 난다
 */
export function newsHref(groupId: number, item: Item): string | null {
  if (!item.eventId || item.action === "DELETED") return null;
  const base = `/g/${groupId}/events/${item.eventId}`;
  return item.scope === "THIS" && item.occurrence ? `${base}?occurrence=${item.occurrence}` : base;
}

/** 시각 줄 앞 날짜 "2월 29일 (목)". 올해(KST) 가 아닌 회차는 연도를 붙인다 ("2024년 2월 29일 (목)", QA3-L6) */
export function newsDateLabel(startsAt: string, today: DateKey): string {
  const key = dateKeyOf(startsAt);
  return formatDateKo(key, parseKey(key).y !== parseKey(today).y);
}
