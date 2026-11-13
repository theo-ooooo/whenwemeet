import { describe, expect, it } from "vitest";
import { directionsUrl, draftPlaceOf, linkify, mapShareUrlOf, NO_PLACE, pickPlace, placeBody, placeHint, placeLabel, placeSnapshot, typePlace } from "../place";
import type { Place, PlaceCandidate } from "../types";

// (#199) 장소 초안, 보낼 본문(카카오 ID + 검색어 또는 글자만, D-242), 길찾기 주소, 메모 링크
const CAND: PlaceCandidate = { kakaoPlaceId: "8209184", name: "서울숲", address: "서울 성동구 뚝섬로 273", lat: 37.5444, lng: 127.0374, category: "공원" };
const PICKED: Place = { text: null, query: "숲", kakaoPlaceId: "8209184", url: "https://place.map.kakao.com/8209184" };
const FREE: Place = { text: "할머니 댁", query: null, kakaoPlaceId: null, url: null };

describe("장소 초안", () => {
  it("불러오기: ID + 검색어면 고른 장소(이름은 다시 찾는다), 글자면 직접 적은 장소, 없으면 빈 값", () => {
    expect(draftPlaceOf(PICKED)).toEqual({ text: "", picked: { kakaoPlaceId: "8209184", query: "숲", name: null, address: null } });
    expect(draftPlaceOf(FREE)).toEqual({ text: "할머니 댁", picked: null });
    expect(draftPlaceOf(null)).toBe(NO_PLACE);
  });

  it("고르면 그때 적은 검색어를 기억하고(이름, 주소는 보여 주기만), 적으면 직접 적은 장소. 100자에서 자른다", () => {
    const picked = pickPlace(CAND, " 숲 ");
    expect(picked.picked).toEqual({ kakaoPlaceId: "8209184", query: "숲", name: "서울숲", address: CAND.address });
    expect(typePlace("가".repeat(120)).text).toHaveLength(100);
    expect(placeHint({ text: "서울숲", picked: null })).toBe("3/100");
  });

  it("본문: 고른 장소는 ID 와 검색어만(카카오 이름, 주소, 좌표 없음), 직접 적은 장소는 글자. 비면 새 일정 생략, 수정 null", () => {
    expect(placeBody(pickPlace(CAND, "숲"), false)).toEqual({ kakaoPlaceId: "8209184", query: "숲" });
    expect(placeBody({ text: " 할머니 댁 ", picked: null }, false)).toEqual({ text: "할머니 댁" });
    expect(placeBody(NO_PLACE, false)).toBeUndefined();
    expect(placeBody({ text: "  ", picked: null }, true)).toBeNull();
  });

  it("요약: 고른 장소는 ID 와 검색어, 글자는 앞뒤 공백 무시", () => {
    expect(placeSnapshot({ text: " 집 ", picked: null })).toBe(placeSnapshot({ text: "집", picked: null }));
    expect(placeSnapshot(pickPlace(CAND, "숲"))).toBe(placeSnapshot(draftPlaceOf(PICKED)));
    expect(placeSnapshot(NO_PLACE)).toBe("");
  });
});

describe("길찾기, 표시", () => {
  it("카카오맵: 다시 찾았으면 좌표로 길찾기(이름의 쉼표는 빈칸), 못 찾았으면 ID 장소 상세, 직접 적은 장소는 글자 검색 (인코딩)", () => {
    expect(directionsUrl(PICKED, CAND, "kakao")).toBe(`https://map.kakao.com/link/to/${encodeURIComponent("서울숲")},37.5444,127.0374`);
    expect(directionsUrl(PICKED, { ...CAND, name: "카페, 성수" }, "kakao")).toContain(encodeURIComponent("카페  성수"));
    expect(directionsUrl(PICKED, null, "kakao")).toBe("https://place.map.kakao.com/8209184");
    expect(directionsUrl({ text: "강남역 #2 출구/앞?", query: null, kakaoPlaceId: null }, null, "kakao")).toBe(
      `https://map.kakao.com/link/search/${encodeURIComponent("강남역 #2 출구/앞?")}`,
    );
  });

  it("네이버 지도(기본): 다시 찾았으면 좌표와 이름으로 길찾기, 못 찾았거나 직접 적은 장소는 글자 검색", () => {
    const u = new URL(directionsUrl(PICKED, CAND));
    expect(u.origin + u.pathname).toBe("https://map.naver.com/index.nhn");
    expect(Object.fromEntries(u.searchParams)).toEqual({ menu: "route", elng: "127.0374", elat: "37.5444", etext: "서울숲", pathType: "0" });
    // 이름의 쉼표, &, # 도 그대로 한 값
    expect(new URL(directionsUrl(PICKED, { ...CAND, name: "카페, A&B #1" })).searchParams.get("etext")).toBe("카페, A&B #1");
    expect(new URL(directionsUrl(PICKED, { ...CAND, name: "  " })).searchParams.get("etext")).toBe("도착");
    // 카카오 ID 는 네이버에서 못 쓰므로 고를 때 검색어로
    expect(directionsUrl(PICKED)).toBe(`https://map.naver.com/p/search/${encodeURIComponent("숲")}`);
    expect(directionsUrl({ text: "강남역 #2 출구/앞?", query: null, kakaoPlaceId: null })).toBe(`https://map.naver.com/p/search/${encodeURIComponent("강남역 #2 출구/앞?")}`);
  });

  it("지도 공유 링크를 붙여 넣었으면 그 링크를 연다 (https 지도 주소만)", () => {
    expect(mapShareUrlOf(" https://kko.to/AbC123 ")).toBe("https://kko.to/AbC123");
    expect(mapShareUrlOf("http://kko.to/x")).toBeNull();
    expect(mapShareUrlOf("https://evil.example/x")).toBeNull();
    expect(directionsUrl({ text: "https://naver.me/xyz", query: null, kakaoPlaceId: null })).toBe("https://naver.me/xyz");
    expect(directionsUrl({ text: "https://kko.to/xyz", query: null, kakaoPlaceId: null }, null, "kakao")).toBe("https://kko.to/xyz");
  });

  it("사용자 글자: 직접 적은 것, 없으면 검색어", () => {
    expect(placeLabel(PICKED)).toBe("숲");
    expect(placeLabel(FREE)).toBe("할머니 댁");
    expect(placeLabel(null)).toBeNull();
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
