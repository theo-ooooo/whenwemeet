/**
 * (#199) 일정 장소 (설계 장소-검색.md, D-242 ~ D-244). 순수 함수: 본문 검사, 비교, 응답 모양.
 * 장소는 이름 하나(직접 적은 글자)이거나, 카카오 장소 검색에서 고른 값(이름 + 주소 + 좌표 + 카카오 장소 ID)이다.
 * 반복 회차 예외는 메모와 같은 규칙: 예외 이름이 null 이면 원본 장소, '' 이면 이 회차만 장소 없음 (D-65)
 */

export const PLACE_NAME_MAX = 100;
export const PLACE_ADDRESS_MAX = 200;
/** 카카오 장소 ID 는 숫자 문자열 */
export const KAKAO_PLACE_ID_PATTERN = /^\d{1,20}$/;
/** 카카오맵 장소 상세 주소. 저장은 ID 만 하고 주소는 여기서 만든다 (D-243) */
export const KAKAO_PLACE_URL = 'https://place.map.kakao.com/';

/** 저장되는 장소 값. 이름만 있으면 직접 적은 장소 (지도 없음) */
export interface PlaceValue {
  name: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
  kakaoPlaceId: string | null;
}

/** 응답 모양. url 은 카카오 장소 ID 가 있을 때만 */
export interface PlaceView extends PlaceValue {
  url: string | null;
}

/** 본문의 place (검사 전) */
export type PlaceInput = { name?: unknown; address?: unknown; lat?: unknown; lng?: unknown; kakaoPlaceId?: unknown } | null;

/** 예외의 "이 회차만 장소 없음" 표시 (이름 '') */
export const CLEARED_PLACE: PlaceValue = { name: '', address: null, lat: null, lng: null, kakaoPlaceId: null };

const ALLOWED_KEYS = new Set(['name', 'address', 'lat', 'lng', 'kakaoPlaceId']);

const length = (value: string) => Array.from(value).length;

const isCoordinate = (value: unknown, limit: number): value is number =>
  typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= limit;

/** 본문 place 의 형식 오류 문구. 맞으면 null. undefined(생략)와 null(지우기)은 맞다 */
export function placeProblem(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) return '장소 형식이 올바르지 않아요';
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some((key) => !ALLOWED_KEYS.has(key))) return '장소에 알 수 없는 값이 있어요';
  if (typeof input.name !== 'string' || input.name.trim().length === 0) return '장소 이름을 입력해 주세요';
  if (length(input.name.trim()) > PLACE_NAME_MAX) return `장소는 ${PLACE_NAME_MAX}자 이하여야 해요`;
  if (input.address !== undefined && input.address !== null) {
    if (typeof input.address !== 'string') return '장소 주소는 문자열이어야 해요';
    if (length(input.address.trim()) > PLACE_ADDRESS_MAX) return `장소 주소는 ${PLACE_ADDRESS_MAX}자 이하여야 해요`;
  }
  const hasLat = input.lat !== undefined && input.lat !== null;
  const hasLng = input.lng !== undefined && input.lng !== null;
  if (hasLat !== hasLng) return '장소 좌표는 위도와 경도를 함께 보내야 해요';
  if (hasLat && (!isCoordinate(input.lat, 90) || !isCoordinate(input.lng, 180))) return '장소 좌표가 올바르지 않아요';
  if (input.kakaoPlaceId !== undefined && input.kakaoPlaceId !== null) {
    if (typeof input.kakaoPlaceId !== 'string' || !KAKAO_PLACE_ID_PATTERN.test(input.kakaoPlaceId)) return '카카오 장소 ID 가 올바르지 않아요';
  }
  return null;
}

/** 검사를 통과한 본문 → 저장 값. undefined 는 그대로(생략), null 은 지우기. 이름, 주소는 앞뒤 공백을 자르고 빈 주소는 null */
export function parsePlace(value: PlaceInput | undefined): PlaceValue | null | undefined {
  if (value === undefined || value === null) return value;
  const address = typeof value.address === 'string' ? value.address.trim() : '';
  const hasCoords = typeof value.lat === 'number' && typeof value.lng === 'number';
  return {
    name: String(value.name).trim(),
    address: address || null,
    lat: hasCoords ? (value.lat as number) : null,
    lng: hasCoords ? (value.lng as number) : null,
    kakaoPlaceId: typeof value.kakaoPlaceId === 'string' ? value.kakaoPlaceId : null,
  };
}

/** 두 장소가 같은지. null 과 이름 '' 은 같은 "장소 없음" */
export function samePlace(a: PlaceValue | null | undefined, b: PlaceValue | null | undefined): boolean {
  const x = a && a.name !== '' ? a : null;
  const y = b && b.name !== '' ? b : null;
  if (x === null || y === null) return x === y;
  return x.name === y.name && x.address === y.address && x.lat === y.lat && x.lng === y.lng && x.kakaoPlaceId === y.kakaoPlaceId;
}

/** 응답 모양. null 이나 이름 '' 은 null */
export function toPlaceView(place: PlaceValue | null | undefined): PlaceView | null {
  if (!place || place.name === '') return null;
  return { ...place, url: place.kakaoPlaceId ? `${KAKAO_PLACE_URL}${place.kakaoPlaceId}` : null };
}

/** DB 열 다섯 개 */
export interface PlaceColumns {
  placeName: string | null;
  placeAddress: string | null;
  placeLat: number | null;
  placeLng: number | null;
  placeKakaoId: string | null;
}

/** 원본 일정 열 → 값. 이름이 비면 장소 없음 */
export function placeFromColumns(row: PlaceColumns): PlaceValue | null {
  if (!row.placeName) return null;
  return { name: row.placeName, address: row.placeAddress, lat: row.placeLat, lng: row.placeLng, kakaoPlaceId: row.placeKakaoId };
}

/** 예외 열 → 값. 이름 null 은 원본 장소(null), '' 은 이 회차만 장소 없음(CLEARED_PLACE) */
export function exceptionPlaceFromColumns(row: PlaceColumns): PlaceValue | null {
  if (row.placeName === null) return null;
  if (row.placeName === '') return CLEARED_PLACE;
  return placeFromColumns(row);
}

/** 값 → DB 열. null 이면 모두 null */
export function placeColumns(place: PlaceValue | null): PlaceColumns {
  return {
    placeName: place?.name ?? null,
    placeAddress: place?.address ?? null,
    placeLat: place?.lat ?? null,
    placeLng: place?.lng ?? null,
    placeKakaoId: place?.kakaoPlaceId ?? null,
  };
}

/** 원본 일정 열의 select */
export const PLACE_SELECT = { placeName: true, placeAddress: true, placeLat: true, placeLng: true, placeKakaoId: true } as const;
