import { describe, expect, it } from "vitest";
import {
  directionsUrl,
  draftPlaceOf,
  hasCoords,
  linkify,
  mapShareUrlOf,
  NO_PLACE,
  pickPlace,
  placeBody,
  placeHint,
  placeLine,
  placeSnapshot,
  typePlace,
} from "../place";
import type { Place, PlaceCandidate } from "../types";

// (#199) 장소 초안, 보낼 본문, 길찾기 주소, 메모 링크
const CAND: PlaceCandidate = { kakaoPlaceId: "8209184", name: "서울숲", address: "서울 성동구 뚝섬로 273", lat: 37.5444, lng: 127.0374, category: "공원" };
const PLACE: Place = { name: "서울숲", address: "서울 성동구 뚝섬로 273", lat: 37.5444, lng: 127.0374, kakaoPlaceId: "8209184", url: "https://place.map.kakao.com/8209184" };

describe("장소 초안", () => {
  it("불러오기: 좌표와 ID 가 다 있으면 고른 장소, 이름만이면 직접 적은 장소, 없으면 빈 값", () => {
    expect(draftPlaceOf(PLACE)).toEqual({ name: "서울숲", picked: { address: PLACE.address, lat: PLACE.lat, lng: PLACE.lng, kakaoPlaceId: "8209184" } });
    expect(draftPlaceOf({ ...PLACE, lat: null, lng: null })).toEqual({ name: "서울숲", picked: null });
    expect(draftPlaceOf(null)).toBe(NO_PLACE);
    expect(draftPlaceOf(undefined)).toBe(NO_PLACE);
  });

  it("고르면 picked, 이름을 고치면 직접 적은 장소가 된다. 같은 이름이면 유지. 100자에서 자른다", () => {
    const picked = pickPlace(CAND);
    expect(picked.picked?.kakaoPlaceId).toBe("8209184");
    expect(typePlace(picked, "서울숲").picked).not.toBeNull();
    expect(typePlace(picked, "서울숲 입구")).toEqual({ name: "서울숲 입구", picked: null });
    expect(typePlace(NO_PLACE, "가".repeat(120)).name).toHaveLength(100);
    expect(placeHint({ name: "서울숲", picked: null })).toBe("3/100");
  });

  it("본문: 새 일정은 비면 생략, 수정은 null. 직접 적은 장소는 이름만, 고른 장소는 다섯 값", () => {
    expect(placeBody(NO_PLACE, false)).toBeUndefined();
    expect(placeBody({ name: "  ", picked: null }, true)).toBeNull();
    expect(placeBody({ name: " 할머니 댁 ", picked: null }, false)).toEqual({ name: "할머니 댁" });
    expect(placeBody(pickPlace(CAND), true)).toEqual({ name: "서울숲", address: CAND.address, lat: CAND.lat, lng: CAND.lng, kakaoPlaceId: "8209184" });
  });

  it("요약: 앞뒤 공백 무시, 고른 장소와 직접 적은 같은 이름은 다르다", () => {
    expect(placeSnapshot({ name: " 집 ", picked: null })).toBe(placeSnapshot({ name: "집", picked: null }));
    expect(placeSnapshot(pickPlace(CAND))).not.toBe(placeSnapshot({ name: "서울숲", picked: null }));
    expect(placeSnapshot(NO_PLACE)).toBe("");
  });
});

describe("길찾기, 표시", () => {
  it("좌표가 있으면 카카오맵 길찾기(이름의 쉼표는 빈칸), ID 만 있으면 장소 상세, 아니면 이름 검색 (인코딩)", () => {
    expect(directionsUrl(PLACE)).toBe(`https://map.kakao.com/link/to/${encodeURIComponent("서울숲")},37.5444,127.0374`);
    expect(directionsUrl({ ...PLACE, name: "카페, 성수" })).toContain(encodeURIComponent("카페  성수"));
    expect(directionsUrl({ ...PLACE, lat: null, lng: null })).toBe("https://place.map.kakao.com/8209184");
    expect(directionsUrl({ name: "강남역 #2 출구/앞?", lat: null, lng: null, kakaoPlaceId: null })).toBe(
      `https://map.kakao.com/link/search/${encodeURIComponent("강남역 #2 출구/앞?")}`,
    );
  });

  it("지도 공유 링크를 붙여 넣었으면 그 링크를 연다 (https 지도 주소만)", () => {
    expect(mapShareUrlOf(" https://kko.to/AbC123 ")).toBe("https://kko.to/AbC123");
    expect(mapShareUrlOf("https://naver.me/xyz")).toBe("https://naver.me/xyz");
    expect(mapShareUrlOf("http://kko.to/x")).toBeNull();
    expect(mapShareUrlOf("https://evil.example/x")).toBeNull();
    expect(directionsUrl({ name: "https://naver.me/xyz", lat: null, lng: null, kakaoPlaceId: null })).toBe("https://naver.me/xyz");
  });

  it("hasCoords, placeLine", () => {
    expect(hasCoords(PLACE)).toBe(true);
    expect(hasCoords({ lat: null, lng: 1 })).toBe(false);
    expect(hasCoords(null)).toBe(false);
    expect(placeLine(PLACE)).toBe("서울숲, 서울 성동구 뚝섬로 273");
    expect(placeLine({ name: "집", address: null })).toBe("집");
    expect(placeLine(null)).toBeNull();
  });
});

describe("linkify", () => {
  it("http(s) 주소만 링크, 끝 문장 부호는 뺀다", () => {
    expect(linkify("예약: https://a.kr/x?y=1. 끝")).toEqual([{ text: "예약: " }, { text: "https://a.kr/x?y=1", href: "https://a.kr/x?y=1" }, { text: ". 끝" }]);
    expect(linkify("(http://b.com)")).toEqual([{ text: "(" }, { text: "http://b.com", href: "http://b.com" }, { text: ")" }]);
  });

  it("javascript: 나 주소 없는 글은 글자 그대로, 줄바꿈 유지", () => {
    expect(linkify("javascript:alert(1)")).toEqual([{ text: "javascript:alert(1)" }]);
    expect(linkify("첫 줄\n둘째 줄")).toEqual([{ text: "첫 줄\n둘째 줄" }]);
    expect(linkify("https://")).toEqual([{ text: "https://" }]);
  });
});
