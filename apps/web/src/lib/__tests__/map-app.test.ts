import { describe, expect, it } from "vitest";
import { DEFAULT_MAP_APP, directionsLabel, MAP_APP_KEY, readMapApp, writeMapApp } from "../map-app";

function memoryStore(init: Record<string, string> = {}) {
  const m = new Map(Object.entries(init));
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
}

describe("길찾기 지도 선택", () => {
  it("기본은 네이버 지도. 저장값이 없거나 모르는 값, 저장소가 막혔으면 기본값", () => {
    expect(DEFAULT_MAP_APP).toBe("naver");
    expect(readMapApp(null)).toBe("naver");
    expect(readMapApp(memoryStore())).toBe("naver");
    expect(readMapApp(memoryStore({ [MAP_APP_KEY]: "google" }))).toBe("naver");
    const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    expect(readMapApp(broken)).toBe("naver");
    expect(() => writeMapApp(broken, "kakao")).not.toThrow();
  });

  it("저장하고 다시 읽는다", () => {
    const s = memoryStore();
    writeMapApp(s, "kakao");
    expect(readMapApp(s)).toBe("kakao");
    writeMapApp(s, "naver");
    expect(readMapApp(s)).toBe("naver");
  });

  it("버튼 글자", () => {
    expect(directionsLabel("naver", "route")).toBe("네이버 지도로 길찾기");
    expect(directionsLabel("kakao", "route")).toBe("카카오맵으로 길찾기");
    expect(directionsLabel("naver", "view")).toBe("네이버 지도에서 보기");
    expect(directionsLabel("kakao", "view")).toBe("카카오맵에서 보기");
  });
});
