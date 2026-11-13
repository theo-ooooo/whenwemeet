/**
 * (#199) 일정 장소 (설계 api.md 2.3 장소, D-242 ~ D-244). 순수 함수: 본문 검사, 비교, 응답 모양, DB 열 변환.
 * 카카오 정책: 로컬 API 가 준 이름, 주소, 좌표는 저장하지 않는다. 저장하는 것은
 *   - kakaoPlaceId: 고른 카카오 장소 ID (저장 허용)
 *   - query: 고를 때 사용자가 적은 검색어 (사용자 입력)
 *   - text: 고르지 않고 적은 장소 글자 (사용자 입력)
 * 보일 때마다 query 로 다시 찾아 ID 가 같은 결과의 이름, 주소, 좌표를 쓴다 (places 모듈 resolve, 메모리 캐시만).
 * 반복 회차 예외는 메모와 같은 규칙: 셋 다 null 이면 원본 장소, text 가 '' 이고 나머지가 null 이면 이 회차만 장소 없음
 */

export const PLACE_TEXT_MAX = 100;
/** 카카오 장소 ID 는 숫자 문자열 */
export const KAKAO_PLACE_ID_PATTERN = /^\d{1,20}$/;
/** 카카오맵 장소 상세 주소 (ID 로 만든다, D-243) */
export const KAKAO_PLACE_URL = 'https://place.map.kakao.com/';

/** 저장되는 장소 값. text 만 있으면 직접 적은 장소, kakaoPlaceId + query 면 고른 장소 */
export interface PlaceValue {
  text: string | null;
  query: string | null;
  kakaoPlaceId: string | null;
}

/** 응답 모양. url 은 카카오 ID 가 있을 때만 (이름, 주소, 좌표는 웹이 보일 때 다시 찾는다) */
export interface PlaceView extends PlaceValue {
  url: string | null;
}

/** 본문의 place (검사 전) */
export type PlaceInput = { text?: unknown; query?: unknown; kakaoPlaceId?: unknown } | null;

/** 예외의 "이 회차만 장소 없음" 표시 (text '') */
export const CLEARED_PLACE: PlaceValue = { text: '', query: null, kakaoPlaceId: null };

const ALLOWED_KEYS = new Set(['text', 'query', 'kakaoPlaceId']);

const length = (value: string) => Array.from(value).length;
const filled = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;

/** 본문 place 의 형식 오류 문구. 맞으면 null. undefined(생략)와 null(지우기)은 맞다 */
export function placeProblem(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) return '장소 형식이 올바르지 않아요';
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some((key) => !ALLOWED_KEYS.has(key))) return '장소에 알 수 없는 값이 있어요';
  for (const key of ['text', 'query'] as const) {
    const v = input[key];
    if (v === undefined || v === null) continue;
    if (typeof v !== 'string') return '장소는 문자열이어야 해요';
    if (length(v.trim()) > PLACE_TEXT_MAX) return `장소는 ${PLACE_TEXT_MAX}자 이하여야 해요`;
  }
  const id = input.kakaoPlaceId;
  if (id !== undefined && id !== null) {
    if (typeof id !== 'string' || !KAKAO_PLACE_ID_PATTERN.test(id)) return '카카오 장소 ID 가 올바르지 않아요';
    if (!filled(input.query)) return '고른 장소는 검색어(query)와 함께 보내야 해요';
    return null;
  }
  if (!filled(input.text)) return '장소 이름을 입력해 주세요';
  return null;
}

/** 검사를 통과한 본문 → 저장 값. undefined 는 그대로(생략), null 은 지우기. 앞뒤 공백을 자르고 빈 글자는 null */
export function parsePlace(value: PlaceInput | undefined): PlaceValue | null | undefined {
  if (value === undefined || value === null) return value;
  const trimmed = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  const kakaoPlaceId = typeof value.kakaoPlaceId === 'string' ? value.kakaoPlaceId : null;
  return { text: trimmed(value.text), query: kakaoPlaceId ? trimmed(value.query) : null, kakaoPlaceId };
}

const isEmpty = (p: PlaceValue | null | undefined) => !p || (!p.text && !p.query && !p.kakaoPlaceId);

/** 두 장소가 같은지. null 과 CLEARED_PLACE 는 같은 "장소 없음" */
export function samePlace(a: PlaceValue | null | undefined, b: PlaceValue | null | undefined): boolean {
  if (isEmpty(a) || isEmpty(b)) return isEmpty(a) === isEmpty(b);
  return a!.text === b!.text && a!.query === b!.query && a!.kakaoPlaceId === b!.kakaoPlaceId;
}

/** 응답 모양. 없음, 이 회차만 없음은 null */
export function toPlaceView(place: PlaceValue | null | undefined): PlaceView | null {
  if (isEmpty(place)) return null;
  return { ...place!, url: place!.kakaoPlaceId ? `${KAKAO_PLACE_URL}${place!.kakaoPlaceId}` : null };
}

/** 사용자 글자 (직접 적은 글자, 없으면 고를 때 적은 검색어) */
export function placeLabel(place: PlaceValue | null | undefined): string | null {
  return place?.text || place?.query || null;
}

/** DB 열 세 개 */
export interface PlaceColumns {
  placeId: string | null;
  placeQuery: string | null;
  placeText: string | null;
}

/** 원본 일정 열 → 값 */
export function placeFromColumns(row: PlaceColumns): PlaceValue | null {
  const place = { text: row.placeText, query: row.placeQuery, kakaoPlaceId: row.placeId };
  return isEmpty(place) ? null : place;
}

/** 예외 열 → 값. 셋 다 null 은 원본 장소(null), text '' 만 있으면 이 회차만 없음(CLEARED_PLACE) */
export function exceptionPlaceFromColumns(row: PlaceColumns): PlaceValue | null {
  if (row.placeId === null && row.placeQuery === null && row.placeText === null) return null;
  if (row.placeId === null && row.placeQuery === null && row.placeText === '') return CLEARED_PLACE;
  return { text: row.placeText, query: row.placeQuery, kakaoPlaceId: row.placeId };
}

/** 값 → DB 열. null 이면 모두 null */
export function placeColumns(place: PlaceValue | null): PlaceColumns {
  return { placeId: place?.kakaoPlaceId ?? null, placeQuery: place?.query ?? null, placeText: place?.text ?? null };
}

/** 원본 일정 열의 select */
export const PLACE_SELECT = { placeId: true, placeQuery: true, placeText: true } as const;
