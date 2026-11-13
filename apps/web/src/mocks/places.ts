// (#199) API_MOCK=1 의 장소: 본문 검사(API place.ts 와 같은 규칙과 문구), 응답 모양, 가짜 장소 검색 (API FakePlaceProvider 와 같은 목록)
import type { PlaceCandidate } from "@/lib/types";
import type { MockPlace } from "./recurrence";

export const FAKE_PLACES: readonly PlaceCandidate[] = [
  { kakaoPlaceId: "27531028", name: "카페 온화 성수점", address: "서울 성동구 연무장길 12", lat: 37.5428, lng: 127.0565, category: "카페" },
  { kakaoPlaceId: "8209184", name: "서울숲", address: "서울 성동구 뚝섬로 273", lat: 37.5444, lng: 127.0374, category: "공원" },
  { kakaoPlaceId: "10808237", name: "미소치과의원", address: "서울 마포구 양화로 160", lat: 37.5569, lng: 126.9237, category: "치과" },
  { kakaoPlaceId: "17733090", name: "을지로 노가리골목", address: "서울 중구 을지로13길 19", lat: 37.5662, lng: 126.9915, category: "술집" },
  { kakaoPlaceId: "11043640", name: "롯데월드", address: "서울 송파구 올림픽로 240", lat: 37.5111, lng: 127.0982, category: "테마파크" },
];

/** 이름이나 분류가 맞는 것, 없으면 "<검색어> 본점" 하나 */
export function fakePlaceSearch(query: string): PlaceCandidate[] {
  const q = query.toLowerCase();
  const hits = FAKE_PLACES.filter((p) => p.name.toLowerCase().includes(q) || (p.category ?? "").includes(query));
  if (hits.length > 0) return [...hits];
  return [{ kakaoPlaceId: "99999999", name: `${query.slice(0, 90)} 본점`, address: "서울 중구 세종대로 110", lat: 37.5663, lng: 126.9779, category: null }];
}

const KEYS = new Set(["text", "query", "kakaoPlaceId"]);
const len = (s: string) => Array.from(s).length;
const filled = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;

/** 본문 place 검사 (API place.ts 와 같은 문구). 맞으면 null, 틀리면 문구 */
export function placeProblem(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== "object" || Array.isArray(v)) return "장소 형식이 올바르지 않아요";
  const o = v as Record<string, unknown>;
  if (Object.keys(o).some((k) => !KEYS.has(k))) return "장소에 알 수 없는 값이 있어요";
  for (const k of ["text", "query"]) {
    if (o[k] == null) continue;
    if (typeof o[k] !== "string") return "장소는 문자열이어야 해요";
    if (len((o[k] as string).trim()) > 100) return "장소는 100자 이하여야 해요";
  }
  if (o.kakaoPlaceId != null) {
    if (typeof o.kakaoPlaceId !== "string" || !/^\d{1,20}$/.test(o.kakaoPlaceId)) return "카카오 장소 ID 가 올바르지 않아요";
    return filled(o.query) ? null : "고른 장소는 검색어(query)와 함께 보내야 해요";
  }
  return filled(o.text) ? null : "장소 이름을 입력해 주세요";
}

/** 검사를 통과한 본문 → 저장 값. undefined = 그대로, null = 지우기 */
export function placeValue(v: unknown): MockPlace | null | undefined {
  if (v === undefined || v === null) return v as undefined | null;
  const o = v as Record<string, unknown>;
  const t = (x: unknown) => (typeof x === "string" && x.trim() ? x.trim() : null);
  const kakaoPlaceId = typeof o.kakaoPlaceId === "string" ? o.kakaoPlaceId : null;
  return { text: t(o.text), query: kakaoPlaceId ? t(o.query) : null, kakaoPlaceId };
}

const empty = (p: MockPlace | null | undefined) => !p || (!p.text && !p.query && !p.kakaoPlaceId);

/** 같은 장소인지. null 과 "이 회차만 없음"(text '') 은 같은 "없음" */
export function samePlace(a: MockPlace | null | undefined, b: MockPlace | null | undefined): boolean {
  if (empty(a) || empty(b)) return empty(a) === empty(b);
  return a!.text === b!.text && a!.query === b!.query && a!.kakaoPlaceId === b!.kakaoPlaceId;
}

/** 응답 모양 */
export function placeOut(p: MockPlace | null | undefined) {
  if (empty(p)) return null;
  return { ...p!, url: p!.kakaoPlaceId ? `https://place.map.kakao.com/${p!.kakaoPlaceId}` : null };
}

/** "이 회차만 장소 없음" */
export const CLEARED: MockPlace = { text: "", query: null, kakaoPlaceId: null };

/** 대소문자 무시 포함 (검색 일치 필드) */
export function contains(v: string | null | undefined, q: string): boolean {
  return Boolean(v) && (v as string).toLocaleLowerCase("ko").includes(q.toLocaleLowerCase("ko"));
}
