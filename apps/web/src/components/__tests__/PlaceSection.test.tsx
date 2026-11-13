// @vitest-environment happy-dom
// (#199) 일정 상세의 장소 칸과 메모 칸: 글자, 길찾기 링크, 지도(키가 없거나 SDK 실패면 숨김), 크게 보기 창, 메모 이름과 링크
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Place } from "@/lib/types";

let inApp = false;
let resolved: { data: { place: unknown } | null; error: unknown } = { data: null, error: null };
const resolveCalls = vi.fn();
const loadKakaoMaps = vi.fn<() => Promise<unknown>>();
vi.mock("@/lib/useInApp", () => ({ useInApp: () => inApp }));
vi.mock("@/lib/kakao-map", () => ({ loadKakaoMaps: () => loadKakaoMaps(), kakaoMapJsKey: () => process.env.NEXT_PUBLIC_KAKAO_MAP_JS_KEY || null }));
vi.mock("@/hooks", () => ({
  usePlaceResolve: (p: { kakaoPlaceId: string | null } | null) => {
    resolveCalls(p);
    return p?.kakaoPlaceId ? resolved : { data: null, error: null };
  },
}));

const { PlaceSection } = await import("../PlaceSection");
const { MemoSection } = await import("../MemoSection");

const PICKED: Place = { text: null, query: "숲", kakaoPlaceId: "8209184", url: "https://place.map.kakao.com/8209184" };
const FREE: Place = { text: "할머니 댁", query: null, kakaoPlaceId: null, url: null };
const LIVE = { kakaoPlaceId: "8209184", name: "서울숲", address: "서울 성동구 뚝섬로 273", lat: 37.5444, lng: 127.0374, category: "공원" };

/** 가짜 카카오 지도 SDK */
function fakeMaps() {
  const calls: { map: Record<string, unknown>[]; markers: number; controls: number } = { map: [], markers: 0, controls: 0 };
  class LatLng {
    constructor(
      public lat: number,
      public lng: number,
    ) {}
  }
  class Map {
    constructor(_el: HTMLElement, opts: Record<string, unknown>) {
      calls.map.push(opts);
    }
    setZoomable() {}
    setCenter() {}
    relayout() {}
    addControl() {
      calls.controls += 1;
    }
  }
  class Marker {
    constructor() {
      calls.markers += 1;
    }
  }
  return { calls, maps: { LatLng, Map, Marker, ZoomControl: class {}, ControlPosition: { RIGHT: 1 }, load: (cb: () => void) => cb() } };
}

beforeEach(() => {
  inApp = false;
  resolved = { data: { place: LIVE }, error: null };
  vi.stubEnv("NEXT_PUBLIC_KAKAO_MAP_JS_KEY", "map-key");
  globalThis.ResizeObserver ??= class {
    observe() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  loadKakaoMaps.mockReset();
});

describe("PlaceSection", () => {
  it("장소가 없으면 칸이 없다", () => {
    const { container } = render(<PlaceSection place={null} />);
    expect(container.innerHTML).toBe("");
  });

  it("직접 적은 장소: 이름과 길찾기(이름 검색)만, 지도 없음. 브라우저는 새 탭", () => {
    render(<PlaceSection place={FREE} />);
    expect(screen.getByRole("region", { name: "장소" })).toBeTruthy();
    expect(screen.getByText("할머니 댁")).toBeTruthy();
    const link = screen.getByRole("link", { name: "네이버 지도로 길찾기" });
    expect(link.getAttribute("href")).toBe(`https://map.naver.com/p/search/${encodeURIComponent("할머니 댁")}`);
    expect(link.getAttribute("target")).toBe("_blank");
    expect(screen.queryByRole("button", { name: /크게 보기/ })).toBeNull();
    expect(loadKakaoMaps).not.toHaveBeenCalled();
  });

  it("고른 장소: 저장된 ID + 검색어로 다시 찾은 이름, 주소, 작은 지도(끌기 끔) + 핀. 누르면 크게 보기 창(끌기, 확대 단추), Esc 로 닫는다. 앱 셸은 target 없음", async () => {
    inApp = true;
    const { calls, maps } = fakeMaps();
    loadKakaoMaps.mockResolvedValue(maps);
    render(<PlaceSection place={PICKED} />);
    expect(resolveCalls).toHaveBeenLastCalledWith(PICKED);
    expect(screen.getByText("서울숲")).toBeTruthy();
    expect(screen.getByText("서울 성동구 뚝섬로 273")).toBeTruthy();
    await act(async () => {});
    expect(calls.map[0]).toMatchObject({ draggable: false, scrollwheel: false });
    expect(calls.markers).toBe(1);
    expect(screen.getByRole("link", { name: "네이버 지도로 길찾기" }).getAttribute("target")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /크게 보기/ }));
    await act(async () => {});
    const dialog = screen.getByRole("dialog", { name: "서울숲" });
    expect(dialog).toBeTruthy();
    expect(calls.map[1]).toMatchObject({ draggable: true, scrollwheel: true });
    expect(calls.controls).toBe(1);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("SDK 를 못 받으면 지도 칸을 숨기고 글자와 길찾기만 남는다", async () => {
    loadKakaoMaps.mockResolvedValue(null);
    render(<PlaceSection place={PICKED} />);
    await act(async () => {});
    expect(screen.queryByRole("button", { name: /크게 보기/ })).toBeNull();
    expect(screen.getByRole("link", { name: "네이버 지도로 길찾기" }).getAttribute("href")).toContain("https://map.naver.com/index.nhn?menu=route");
  });

  it("못 찾으면(카카오 오류, 결과에서 사라짐) 사용자 글자 + ID 장소 상세 링크, 지도 없음", () => {
    resolved = { data: { place: null }, error: null };
    render(<PlaceSection place={PICKED} />);
    expect(screen.getByText("숲")).toBeTruthy();
    // 네이버 지도(기본)는 카카오 ID 를 못 쓰므로 고를 때 검색어로 찾는다
    expect(screen.getByRole("link", { name: "네이버 지도에서 보기" }).getAttribute("href")).toBe(`https://map.naver.com/p/search/${encodeURIComponent("숲")}`);
    expect(loadKakaoMaps).not.toHaveBeenCalled();
    cleanup();
    resolved = { data: null, error: { code: "PLACE_SEARCH_FAILED" } };
    render(<PlaceSection place={PICKED} />);
    expect(screen.getByRole("link", { name: "네이버 지도에서 보기" })).toBeTruthy();
  });

  it("내 정보에서 카카오맵을 골랐으면 카카오맵으로 (좌표 길찾기, 못 찾으면 ID 장소 상세)", () => {
    window.localStorage.setItem("wwm_map_app", "kakao");
    loadKakaoMaps.mockResolvedValue(null);
    try {
      render(<PlaceSection place={PICKED} />);
      expect(screen.getByRole("link", { name: "카카오맵으로 길찾기" }).getAttribute("href")).toContain("https://map.kakao.com/link/to/");
      cleanup();
      resolved = { data: { place: null }, error: null };
      render(<PlaceSection place={PICKED} />);
      expect(screen.getByRole("link", { name: "카카오맵에서 보기" }).getAttribute("href")).toBe("https://place.map.kakao.com/8209184");
    } finally {
      window.localStorage.removeItem("wwm_map_app");
    }
  });

  it("지도 키가 없으면(로컬, 목, 공유 키만 있음) SDK 를 부르지 않는다", () => {
    vi.stubEnv("NEXT_PUBLIC_KAKAO_MAP_JS_KEY", "");
    vi.stubEnv("NEXT_PUBLIC_KAKAO_JS_KEY", "share-key");
    render(<PlaceSection place={PICKED} />);
    expect(loadKakaoMaps).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /크게 보기/ })).toBeNull();
  });
});

describe("MemoSection", () => {
  it("메모 이름이 있는 칸, 줄바꿈 유지, http(s) 주소는 링크", () => {
    render(<MemoSection memo={"준비물: 우산\n예약 https://a.kr/x 확인"} />);
    const region = screen.getByRole("region", { name: "메모" });
    expect(region.textContent).toContain("준비물: 우산\n예약");
    const link = screen.getByRole("link", { name: "https://a.kr/x" });
    expect(link.getAttribute("href")).toBe("https://a.kr/x");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("비었거나 공백뿐이면 칸이 없다", () => {
    const { container } = render(
      <>
        <MemoSection memo={null} />
        <MemoSection memo={"  \n "} />
      </>,
    );
    expect(container.innerHTML).toBe("");
  });
});
