// (#199) 일정 장소: 초안 값, 보낼 본문, 길찾기 주소, 메모 링크. React 를 import 하지 않는다 (단위 테스트 대상).
// 카카오 정책(D-242): 카카오가 준 이름, 주소, 좌표는 저장하지 않는다. 네이버로 고른 장소도 같다 (D-259). 저장은 직접 적은 글자(text) 또는
// 고른 장소의 식별자(카카오 ID, 네이버 키) + 고를 때 사용자가 적은 검색어(query) 뿐. 이름, 주소, 좌표는 보일 때 고른 출처에서 다시 찾는다(usePlaceResolve).
// 지도는 다시 찾은 좌표가 있을 때만 그린다(좌표는 WGS84 라 출처와 상관없이 고른 지도에 그린다). 내 위치(기기 위치)는 쓰지 않는다 (D-244)
import { charCount, clampChars } from "./chars";
import type { MapApp } from "./map-app";
import type { Place, PlaceCandidate, PlaceInput, PlaceProvider } from "./types";

/** 서버와 같은 상한 (코드포인트) */
export const PLACE_MAX = 100;

/**
 * 고른 장소. 보내는 것은 식별자(id: 카카오면 장소 ID, 네이버면 키)와 query 뿐. name, address 는 고른 그 자리에서 보여 주려고 들고 있는 값(보내지 않음),
 * 불러온 일정이면 null 이고 화면이 다시 찾는다
 */
export type PickedPlace = { provider: PlaceProvider; id: string; query: string; name: string | null; address: string | null };

/** 고른 장소의 (출처, 식별자). 직접 적은 장소나 옛 응답의 빈 값은 null */
export function placeRef(place: Pick<Place, "kakaoPlaceId" | "naverKey"> | null | undefined): { provider: PlaceProvider; id: string } | null {
  if (place?.kakaoPlaceId) return { provider: "kakao", id: place.kakaoPlaceId };
  if (place?.naverKey) return { provider: "naver", id: place.naverKey };
  return null;
}

/** 초안의 장소. picked 가 없으면 text 가 직접 적은 장소 (비면 장소 없음) */
export type DraftPlace = { text: string; picked: PickedPlace | null };

export const NO_PLACE: DraftPlace = { text: "", picked: null };

/** 불러온 일정의 장소 → 초안 */
export function draftPlaceOf(place: Place | null | undefined): DraftPlace {
  if (!place) return NO_PLACE;
  const ref = placeRef(place);
  if (ref && place.query) return { text: "", picked: { ...ref, query: place.query, name: null, address: null } };
  return { text: place.text ?? place.query ?? "", picked: null };
}

/** 검색 후보를 고른다. query 는 그때 입력칸에 적혀 있던 사용자 검색어. 식별자가 없는 후보면 직접 적은 글자로 */
export function pickPlace(c: PlaceCandidate, query: string): DraftPlace {
  const id = c.provider === "naver" ? c.naverKey : c.kakaoPlaceId;
  if (!id) return typePlace(query);
  return { text: "", picked: { provider: c.provider, id, query: clampChars(query.trim(), PLACE_MAX), name: c.name, address: c.address } };
}

/** 후보의 목록 키 (출처 + 식별자) */
export function candidateKey(c: PlaceCandidate): string {
  return `${c.provider}:${c.kakaoPlaceId ?? c.naverKey ?? c.name}`;
}

/** 입력칸에 적는다 (직접 적은 장소) */
export function typePlace(value: string): DraftPlace {
  return { text: clampChars(value, PLACE_MAX), picked: null };
}

/** 이탈 확인용 요약. 앞뒤 공백은 보지 않는다 */
export function placeSnapshot(d: DraftPlace): string {
  if (d.picked) return JSON.stringify([d.picked.provider, d.picked.id, d.picked.query]);
  return d.text.trim();
}

/** 보낼 place. 비었으면 새 일정은 생략, 수정은 null(지우기) */
export function placeBody(d: DraftPlace, editing: boolean): PlaceInput | null | undefined {
  if (d.picked) return d.picked.provider === "naver" ? { naverKey: d.picked.id, query: d.picked.query } : { kakaoPlaceId: d.picked.id, query: d.picked.query };
  const text = d.text.trim();
  if (!text) return editing ? null : undefined;
  return { text };
}

/** 글자 수 표시 "12/100" */
export function placeHint(d: DraftPlace): string {
  return `${charCount(d.text)}/${PLACE_MAX}`;
}

/** 사용자 글자: 직접 적은 것, 없으면 고를 때 검색어 */
export function placeLabel(place: Pick<Place, "text" | "query"> | null | undefined): string | null {
  return place?.text || place?.query || null;
}

/** 지도 앱 공유 링크를 장소 칸에 붙여 넣은 경우. 그 주소를 그대로 연다 */
const MAP_SHARE = /^https:\/\/(kko\.to|naver\.me|map\.kakao\.com|place\.map\.kakao\.com|map\.naver\.com|m\.place\.naver\.com|maps\.app\.goo\.gl)\/\S*$/i;

export function mapShareUrlOf(text: string): string | null {
  const t = text.trim();
  return MAP_SHARE.test(t) ? t : null;
}

/**
 * 길찾기 링크 (https 웹 주소만, 앱 셸이 OS 로 넘긴다. 지도 앱이 깔려 있으면 OS 가 앱으로 연다).
 * 다시 찾은 좌표가 있으면 그곳까지 길찾기, 카카오 ID 만 있으면(못 찾음) 장소 보기, 공유 링크면 그 링크, 아니면 글자로 검색.
 * 좌표는 장소의 출처와 상관없이 쓴다 (네이버로 고른 장소도 카카오맵 길찾기로, D-259).
 * app: 내 정보의 지도 선택 (lib/map-app.ts, 기본 네이버 지도)
 * - 카카오맵: https://apis.map.kakao.com/web/guide/#routeurl
 * - 네이버 지도: `map.naver.com/index.nhn?menu=route&elng&elat&etext` 는 PC 에서 지도 길찾기(도착지 채움), 모바일에서 네이버 빠른길찾기로
 *   넘어간다 (2026-11-13 확인). 카카오 ID 는 네이버에서 쓸 수 없어 못 찾은 장소는 사용자 글자로 검색
 */
export function directionsUrl(
  place: Pick<Place, "text" | "query" | "kakaoPlaceId">,
  resolved: Pick<PlaceCandidate, "name" | "lat" | "lng"> | null = null,
  app: MapApp = "naver",
): string {
  if (app === "naver") {
    if (resolved) {
      const q = new URLSearchParams({ menu: "route", elng: String(resolved.lng), elat: String(resolved.lat), etext: resolved.name.trim() || "도착", pathType: "0" });
      return `https://map.naver.com/index.nhn?${q.toString()}`;
    }
    const label = placeLabel(place) ?? "";
    return mapShareUrlOf(label) ?? `https://map.naver.com/p/search/${encodeURIComponent(label.trim())}`;
  }
  if (resolved) {
    // 이름의 쉼표는 주소 구분자라 빈칸으로
    const name = encodeURIComponent(resolved.name.replace(/,/g, " ").trim() || "도착");
    return `https://map.kakao.com/link/to/${name},${resolved.lat},${resolved.lng}`;
  }
  if (place.kakaoPlaceId) return `https://place.map.kakao.com/${place.kakaoPlaceId}`;
  const label = placeLabel(place) ?? "";
  return mapShareUrlOf(label) ?? `https://map.kakao.com/link/search/${encodeURIComponent(label.trim())}`;
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
