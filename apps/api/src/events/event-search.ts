/**
 * (#199) 일정 검색 순수 함수 (설계 api.md 2.3 "일정 검색", D-245, D-246). 검색어 검사, 반복 원본의 대표 회차, 일치 필드, 정렬.
 */
import { ApiException } from '../common/errors.js';
import type { PlaceValue } from './place.js';
import {
  DAY_MS,
  type ExceptionRule,
  expand,
  kstMidnight,
  type Occurrence,
  type SeriesRule,
} from './recurrence.js';

export const SEARCH_QUERY_MAX = 50;
export const SEARCH_LIMIT_DEFAULT = 30;
export const SEARCH_LIMIT_MAX = 50;
/** 반복 원본과 예외 회차 후보 상한 (각각). 팀 규모가 작아 넉넉하다 */
export const SEARCH_SERIES_CAP = 200;
/** 다음(또는 마지막) 회차를 찾는 창. 매년 반복도 한 번은 들어가게 */
export const SEARCH_WINDOW_DAYS = 400;

export type MatchedField = 'title' | 'memo' | 'place';

export interface SearchQuery {
  q: string;
  groupId: number | null;
  limit: number;
}

function invalid(field: string, message: string): ApiException {
  return new ApiException('VALIDATION_FAILED', message, [{ field, message }]);
}

/** 쿼리 원문 검사. q 는 앞뒤 공백을 자르고 1~50자, groupId 는 양의 정수, limit 는 1~50 (기본 30) */
export function parseSearchQuery(raw: {
  q?: unknown;
  groupId?: unknown;
  limit?: unknown;
}): SearchQuery {
  const q = typeof raw.q === 'string' ? raw.q.trim() : '';
  if (q.length === 0 || Array.from(q).length > SEARCH_QUERY_MAX)
    throw invalid('q', `검색어는 1~${SEARCH_QUERY_MAX}자여야 해요`);
  let groupId: number | null = null;
  if (raw.groupId !== undefined && raw.groupId !== '') {
    const value =
      typeof raw.groupId === 'string' && /^\d{1,9}$/.test(raw.groupId)
        ? Number(raw.groupId)
        : NaN;
    if (!Number.isInteger(value) || value < 1)
      throw invalid('groupId', 'groupId 는 양의 정수여야 해요');
    groupId = value;
  }
  let limit = SEARCH_LIMIT_DEFAULT;
  if (raw.limit !== undefined && raw.limit !== '') {
    const value =
      typeof raw.limit === 'string' && /^\d{1,3}$/.test(raw.limit)
        ? Number(raw.limit)
        : NaN;
    if (!(value >= 1 && value <= SEARCH_LIMIT_MAX))
      throw invalid('limit', `limit 는 1~${SEARCH_LIMIT_MAX} 사이여야 해요`);
    limit = value;
  }
  return { q, groupId, limit };
}

/** 대소문자 무시 포함 검사 (DB 콜레이션과 같은 결, 화면 강조와 일치 필드 계산용) */
export function containsText(
  value: string | null | undefined,
  q: string,
): boolean {
  return (
    Boolean(value) &&
    (value as string)
      .toLocaleLowerCase('ko')
      .includes(q.toLocaleLowerCase('ko'))
  );
}

/** 회차 값에서 검색어가 들어 있는 필드. 장소는 사용자 글자(직접 적은 것, 고를 때 검색어)만 */
export function matchedFields(
  values: { title: string; memo: string | null; place: PlaceValue | null },
  q: string,
): MatchedField[] {
  const fields: MatchedField[] = [];
  if (containsText(values.title, q)) fields.push('title');
  if (containsText(values.memo, q)) fields.push('memo');
  if (
    values.place &&
    (containsText(values.place.text, q) || containsText(values.place.query, q))
  )
    fields.push('place');
  return fields;
}

/**
 * 반복 원본이 맞았을 때 보여 줄 회차 하나 (D-246): 끝이 now 뒤인 첫 회차, 없으면 마지막 회차.
 * skip 에 든 회차(예외가 따로 맞아 제 줄이 있는 회차)와 취소된 회차는 건너뛴다. 하나도 없으면 null
 */
export function representativeOccurrence(
  rule: SeriesRule,
  exceptions: readonly ExceptionRule[],
  now: Date,
  skip: ReadonlySet<string> = new Set(),
): Occurrence | null {
  const window = SEARCH_WINDOW_DAYS * DAY_MS;
  const usable = (occurrence: Occurrence) => !skip.has(occurrence.occurrence);
  // 아직 시작 전인 반복(첫 회차가 400일 넘게 뒤)도 찾게 창은 지금과 첫 회차 중 늦은 쪽에서 연다
  const from = Math.max(now.getTime(), rule.startsAt.getTime());
  const next = expand(
    rule,
    exceptions,
    new Date(from),
    new Date(from + window),
  ).find(
    (occurrence) =>
      occurrence.endsAt.getTime() > now.getTime() && usable(occurrence),
  );
  if (next) return next;
  // 끝난 반복: 종료일 다음 날까지를 끝으로 거꾸로 창 하나
  const until =
    rule.repeatUntil === null
      ? now.getTime()
      : Math.min(
          now.getTime(),
          kstMidnight(rule.repeatUntil).getTime() + 2 * DAY_MS,
        );
  const past = expand(
    rule,
    exceptions,
    new Date(until - window),
    new Date(until),
  ).filter(
    (occurrence) =>
      occurrence.endsAt.getTime() <= now.getTime() && usable(occurrence),
  );
  return past.length > 0 ? past[past.length - 1] : null;
}

/** 정렬 키 */
export interface SortableItem {
  upcoming: boolean;
  startsAt: Date;
  id: number;
  occurrence: string | null;
}

/** 다가오는 일정 먼저(시작 오름차순), 그다음 지난 일정(시작 내림차순). 같으면 id, 회차 날짜 */
export function compareSearchItems(a: SortableItem, b: SortableItem): number {
  if (a.upcoming !== b.upcoming) return a.upcoming ? -1 : 1;
  const diff = a.startsAt.getTime() - b.startsAt.getTime();
  if (diff !== 0) return a.upcoming ? diff : -diff;
  return a.id - b.id || (a.occurrence ?? '').localeCompare(b.occurrence ?? '');
}
