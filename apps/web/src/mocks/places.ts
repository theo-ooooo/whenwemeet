// (#199) API_MOCK=1 의 장소: 본문 검사(API place.ts 와 같은 규칙과 문구), 응답 모양, 가짜 장소 검색 (API FakePlaceProvider, FakeNaverPlaceProvider 와 같은 목록).
// 네이버 키는 API 가 sha256 으로 만들지만 목은 동기 FNV-1a 로 같은 모양(16진 16자)만 맞춘다
import type { PlaceCandidate, PlaceProvider } from "@/lib/types";
import type { MockPlace } from "./recurrence";

const kakao = (kakaoPlaceId: string, name: string, address: string, lat: number, lng: number, category: string | null): PlaceCandidate => ({
  provider: "kakao",
  kakaoPlaceId,
  naverKey: null,
  name,
  address,
  lat,
  lng,
  category,
});

/** 목의 네이버 키 (이름 + 주소 → 16진 16자) */
export function mockNaverKey(name: string, address: string | null): string {
  const bytes = new TextEncoder().encode(`${name}\n${address ?? ""}`);
  // FNV-1a 32비트 두 번 (시작값만 다르게) → 16진 16자
  const fnv = (seed: number) => {
    let h = seed >>> 0;
    for (const b of bytes) h = Math.imul(h ^ b, 0x01000193) >>> 0;
    return h.toString(16).padStart(8, "0");
  };
  return fnv(0x811c9dc5) + fnv(0x050c5d1f);
}

const naver = (name: string, address: string, lat: number, lng: number, category: string | null): PlaceCandidate => ({
  provider: "naver",
  kakaoPlaceId: null,
  naverKey: mockNaverKey(name, address),
  name,
  address,
  lat,
  lng,
  category,
});

export const FAKE_PLACES: readonly PlaceCandidate[] = [
  kakao("27531028", "카페 온화 성수점", "서울 성동구 연무장길 12", 37.5428, 127.0565, "카페"),
  kakao("8209184", "서울숲", "서울 성동구 뚝섬로 273", 37.5444, 127.0374, "공원"),
  kakao("10808237", "미소치과의원", "서울 마포구 양화로 160", 37.5569, 126.9237, "치과"),
  kakao("17733090", "을지로 노가리골목", "서울 중구 을지로13길 19", 37.5662, 126.9915, "술집"),
  kakao("11043640", "롯데월드", "서울 송파구 올림픽로 240", 37.5111, 127.0982, "테마파크"),
];

/** 가짜 네이버 목록 (같은 곳, 네이버처럼 시도 전체 이름) */
export const FAKE_NAVER_PLACES: readonly PlaceCandidate[] = FAKE_PLACES.map((p) => naver(p.name, p.address!.replace(/^서울 /, "서울특별시 "), p.lat, p.lng, p.category));

/** 이름이나 분류가 맞는 것, 없으면 "<검색어> 본점" 하나. 네이버는 5개까지 */
export function fakePlaceSearch(query: string, provider: PlaceProvider = "kakao"): PlaceCandidate[] {
  const q = query.toLowerCase();
  const list = provider === "naver" ? FAKE_NAVER_PLACES : FAKE_PLACES;
  const hits = list.filter((p) => p.name.toLowerCase().includes(q) || (p.category ?? "").includes(query));
  const name = `${query.slice(0, 90)} 본점`;
  if (hits.length > 0) return provider === "naver" ? hits.slice(0, 5) : [...hits];
  return [provider === "naver" ? naver(name, "서울특별시 중구 세종대로 110", 37.5663, 126.9779, null) : kakao("99999999", name, "서울 중구 세종대로 110", 37.5663, 126.9779, null)];
}

const KEYS = new Set(["text", "query", "kakaoPlaceId", "naverKey"]);
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
  if (o.kakaoPlaceId != null && o.naverKey != null) return "카카오 장소와 네이버 장소 중 하나만 보내야 해요";
  if (o.kakaoPlaceId != null) {
    if (typeof o.kakaoPlaceId !== "string" || !/^\d{1,20}$/.test(o.kakaoPlaceId)) return "카카오 장소 ID 가 올바르지 않아요";
    return filled(o.query) ? null : "고른 장소는 검색어(query)와 함께 보내야 해요";
  }
  if (o.naverKey != null) {
    if (typeof o.naverKey !== "string" || !/^[0-9a-f]{16}$/.test(o.naverKey)) return "네이버 장소 키가 올바르지 않아요";
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
  const naverKey = !kakaoPlaceId && typeof o.naverKey === "string" ? o.naverKey : null;
  return { text: t(o.text), query: kakaoPlaceId || naverKey ? t(o.query) : null, kakaoPlaceId, naverKey };
}

const empty = (p: MockPlace | null | undefined) => !p || (!p.text && !p.query && !p.kakaoPlaceId && !p.naverKey);

/** 같은 장소인지. null 과 "이 회차만 없음"(text '') 은 같은 "없음" */
export function samePlace(a: MockPlace | null | undefined, b: MockPlace | null | undefined): boolean {
  if (empty(a) || empty(b)) return empty(a) === empty(b);
  return a!.text === b!.text && a!.query === b!.query && a!.kakaoPlaceId === b!.kakaoPlaceId && (a!.naverKey ?? null) === (b!.naverKey ?? null);
}

/** 응답 모양 */
export function placeOut(p: MockPlace | null | undefined) {
  if (empty(p)) return null;
  const naverKey = p!.naverKey ?? null;
  const provider = p!.kakaoPlaceId ? "kakao" : naverKey ? "naver" : null;
  const url =
    provider === "kakao" ? `https://place.map.kakao.com/${p!.kakaoPlaceId}` : provider === "naver" && p!.query ? `https://map.naver.com/p/search/${encodeURIComponent(p!.query)}` : null;
  return { text: p!.text, query: p!.query, kakaoPlaceId: p!.kakaoPlaceId, naverKey, provider, url };
}

/** "이 회차만 장소 없음" */
export const CLEARED: MockPlace = { text: "", query: null, kakaoPlaceId: null, naverKey: null };

/** 대소문자 무시 포함 (검색 일치 필드) */
export function contains(v: string | null | undefined, q: string): boolean {
  return Boolean(v) && (v as string).toLocaleLowerCase("ko").includes(q.toLocaleLowerCase("ko"));
}
