// (#199) 일정 검색 화면의 순수 함수: 주소, 강조 조각, 미리보기 한 줄, 날짜 글자. React 를 import 하지 않는다 (단위 테스트 대상).
// 검색어는 주소(`/search?q=`)에만 두고 어디에도 저장하지 않는다 (스토어 "검색 기록: 수집 안 함")
import { formatDateKo, formatEventTime, dateKeyOf, parseKey, type DateKey } from "./date";
import { placeLine } from "./place";
import { REPEAT_NAME } from "./recurrence";
import { SEARCH_PATH } from "./routes";
import type { EventSearchItem } from "./types";

/** 서버와 같은 상한 (코드포인트) */
export const SEARCH_MAX = 50;

/** 검색 화면 주소. all 이면 모든 팀 */
export function searchHref(q = "", all = false): string {
  const p = new URLSearchParams();
  if (q.trim()) p.set("q", q);
  if (all) p.set("scope", "all");
  const s = p.toString();
  return `${SEARCH_PATH}${s ? `?${s}` : ""}`;
}

export type Highlight = { text: string; hit: boolean };

/** text 안의 q 를 대소문자 무시로 찾아 조각으로 나눈다. 못 찾으면 통째 하나 */
export function highlight(text: string, q: string): Highlight[] {
  const needle = q.trim().toLocaleLowerCase("ko");
  const hay = text.toLocaleLowerCase("ko");
  // 소문자로 바꾸며 길이가 달라지는 글자(드묾)가 있으면 강조하지 않는다
  if (!needle || hay.length !== text.length) return [{ text, hit: false }];
  const parts: Highlight[] = [];
  let at = 0;
  for (let i = hay.indexOf(needle); i !== -1; i = hay.indexOf(needle, at)) {
    if (i > at) parts.push({ text: text.slice(at, i), hit: false });
    parts.push({ text: text.slice(i, i + needle.length), hit: true });
    at = i + needle.length;
  }
  if (at < text.length) parts.push({ text: text.slice(at), hit: false });
  return parts.length > 0 ? parts : [{ text, hit: false }];
}

/** 메모에서 검색어가 든 곳 앞뒤를 한 줄로 (앞이 잘리면 "…") */
function memoSnippet(memo: string, q: string, around = 18): string {
  const flat = memo.replace(/\s+/g, " ").trim();
  const i = flat.toLocaleLowerCase("ko").indexOf(q.trim().toLocaleLowerCase("ko"));
  if (i <= around) return flat;
  return `…${flat.slice(i - around)}`;
}

/** 결과 줄 아래 한 줄: 메모가 맞았으면 메모의 그 부분, 장소가 맞았으면 장소, 아니면 장소, 메모 첫 줄 순. 없으면 null */
export function searchPreview(item: EventSearchItem, q: string): { kind: "memo" | "place"; text: string } | null {
  const { event: ev, matched } = item;
  const place = placeLine(ev.place);
  if (matched.includes("memo") && ev.memo) return { kind: "memo", text: memoSnippet(ev.memo, q) };
  if (place) return { kind: "place", text: place };
  if (ev.memo) return { kind: "memo", text: ev.memo.replace(/\s+/g, " ").trim() };
  return null;
}

/** 날짜 글자 "1월 5일 (화)". 올해가 아니면 연도 */
export function searchDateText(startsAt: string, today: DateKey): string {
  const key = dateKeyOf(startsAt);
  return formatDateKo(key, parseKey(key).y !== parseKey(today).y);
}

/** 시각 글자 "10:00~11:00", "종일" */
export function searchTimeText(ev: { startsAt: string; endsAt: string; allDay: boolean }): string {
  return formatEventTime(ev.startsAt, ev.endsAt, ev.allDay);
}

/** 반복 표시 "매주" (회차 줄이면 그 회차) */
export function repeatTag(repeat: keyof typeof REPEAT_NAME | null): string | null {
  return repeat ? REPEAT_NAME[repeat] : null;
}
