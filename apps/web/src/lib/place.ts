// (#199) 일정 장소: 초안 값, 보낼 본문, 길찾기 주소, 메모 링크. React 를 import 하지 않는다 (단위 테스트 대상).
// 장소는 직접 적은 이름 하나이거나, 장소 검색(카카오 로컬, 우리 API 프록시)에서 고른 값(이름 + 주소 + 좌표 + 카카오 장소 ID)이다.
// 지도는 좌표가 있을 때만 그린다. 내 위치(기기 위치)는 쓰지 않는다 (D-244)
import { charCount, clampChars } from "./chars";
import type { Place, PlaceCandidate, PlaceInput } from "./types";

/** 서버와 같은 상한 (코드포인트) */
export const PLACE_MAX = 100;

/** 고른 장소의 나머지 값. 이름을 고치면 버린다 (다른 곳이 되므로) */
export type PickedPlace = { address: string | null; lat: number; lng: number; kakaoPlaceId: string; category?: string | null };

/** 초안의 장소. name 이 비면 장소 없음 */
export type DraftPlace = { name: string; picked: PickedPlace | null };

export const NO_PLACE: DraftPlace = { name: "", picked: null };

/** 불러온 일정의 장소 → 초안. 좌표와 카카오 ID 가 다 있으면 고른 장소로 본다 */
export function draftPlaceOf(place: Place | null | undefined): DraftPlace {
  if (!place) return NO_PLACE;
  const picked = place.lat !== null && place.lng !== null && place.kakaoPlaceId ? { address: place.address, lat: place.lat, lng: place.lng, kakaoPlaceId: place.kakaoPlaceId } : null;
  return { name: place.name, picked };
}

/** 검색 후보를 고른다 */
export function pickPlace(c: PlaceCandidate): DraftPlace {
  return { name: clampChars(c.name, PLACE_MAX), picked: { address: c.address, lat: c.lat, lng: c.lng, kakaoPlaceId: c.kakaoPlaceId, category: c.category } };
}

/** 입력칸에 적는다. 고른 장소의 이름과 달라지면 고른 값을 버리고 직접 적은 장소가 된다 */
export function typePlace(d: DraftPlace, value: string): DraftPlace {
  const name = clampChars(value, PLACE_MAX);
  return { name, picked: d.picked && name === d.name ? d.picked : null };
}

/** 이탈 확인용 요약. 앞뒤 공백은 보지 않는다 */
export function placeSnapshot(d: DraftPlace): string {
  const name = d.name.trim();
  return name ? JSON.stringify([name, d.picked?.kakaoPlaceId ?? null, d.picked?.lat ?? null, d.picked?.lng ?? null]) : "";
}

/** 보낼 place. 비었으면 새 일정은 생략, 수정은 null(지우기) */
export function placeBody(d: DraftPlace, editing: boolean): PlaceInput | null | undefined {
  const name = d.name.trim();
  if (!name) return editing ? null : undefined;
  if (!d.picked) return { name };
  return { name, address: d.picked.address, lat: d.picked.lat, lng: d.picked.lng, kakaoPlaceId: d.picked.kakaoPlaceId };
}

/** 글자 수 표시 "12/100" */
export function placeHint(d: DraftPlace): string {
  return `${charCount(d.name)}/${PLACE_MAX}`;
}

/** 지도를 그릴 수 있는지 (좌표가 있어야) */
export function hasCoords(place: Pick<Place, "lat" | "lng"> | null | undefined): place is Place & { lat: number; lng: number } {
  return Boolean(place) && typeof place!.lat === "number" && typeof place!.lng === "number";
}

/** 지도 앱 공유 링크를 장소 칸에 붙여 넣은 경우. 그 주소를 그대로 연다 */
const MAP_SHARE = /^https:\/\/(kko\.to|naver\.me|map\.kakao\.com|place\.map\.kakao\.com|map\.naver\.com|m\.place\.naver\.com|maps\.app\.goo\.gl)\/\S*$/i;

export function mapShareUrlOf(name: string): string | null {
  const t = name.trim();
  return MAP_SHARE.test(t) ? t : null;
}

/**
 * "카카오맵으로 길찾기" 주소 (https 웹 주소만, 앱 셸이 OS 로 넘긴다). 좌표가 있으면 그곳까지 길찾기,
 * 카카오 ID 만 있으면 장소 상세, 공유 링크면 그 링크, 아니면 이름으로 검색
 * https://apis.map.kakao.com/web/guide/#routeurl
 */
export function directionsUrl(place: Pick<Place, "name" | "lat" | "lng" | "kakaoPlaceId">): string {
  const shared = mapShareUrlOf(place.name);
  if (shared) return shared;
  if (hasCoords(place)) {
    // 이름의 쉼표는 주소 구분자라 빈칸으로
    const name = encodeURIComponent(place.name.replace(/,/g, " ").trim() || "도착");
    return `https://map.kakao.com/link/to/${name},${place.lat},${place.lng}`;
  }
  if (place.kakaoPlaceId) return `https://place.map.kakao.com/${place.kakaoPlaceId}`;
  return `https://map.kakao.com/link/search/${encodeURIComponent(place.name.trim())}`;
}

/** 검색 결과 줄의 장소 한 줄 "이름 · 주소" 대신 "이름, 주소" (가운데 점 금지) */
export function placeLine(place: Pick<Place, "name" | "address"> | null | undefined): string | null {
  if (!place) return null;
  return place.address && place.address !== place.name ? `${place.name}, ${place.address}` : place.name;
}

/* ---------- 메모 링크 ---------- */

export type TextPart = { text: string; href?: string };

const URL_RE = /https?:\/\/[^\s<>"'`]+/g;
/** 주소 끝에 붙은 문장 부호는 링크에서 뺀다 */
const TRAILING = /[).,!?;:'"\]}>。、]+$/;

/** 메모를 글자와 링크 조각으로. http(s) 만 링크로 (javascript: 같은 것은 글자 그대로) */
export function linkify(text: string): TextPart[] {
  const parts: TextPart[] = [];
  let last = 0;
  for (const m of text.matchAll(URL_RE)) {
    const raw = m[0];
    const tail = raw.match(TRAILING)?.[0] ?? "";
    const url = tail ? raw.slice(0, -tail.length) : raw;
    const start = m.index ?? 0;
    if (url.length <= "https://".length) continue;
    if (start > last) parts.push({ text: text.slice(last, start) });
    parts.push({ text: url, href: url });
    last = start + url.length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}
