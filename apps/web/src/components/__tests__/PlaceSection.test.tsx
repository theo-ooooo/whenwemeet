// @vitest-environment happy-dom
// (#199) 일정 상세의 장소 칸과 메모 칸: 글자, 길찾기 링크, 지도(키가 없거나 SDK 실패면 숨김), 크게 보기 창, 메모 이름과 링크
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Place } from "@/lib/types";

let inApp = false;
const loadKakaoMaps = vi.fn<() => Promise<unknown>>();
vi.mock("@/lib/useInApp", () => ({ useInApp: () => inApp }));
vi.mock("@/lib/kakao-map", () => ({ loadKakaoMaps: () => loadKakaoMaps() }));

const { PlaceSection } = await import("../PlaceSection");
const { MemoSection } = await import("../MemoSection");

const PICKED: Place = { name: "서울숲", address: "서울 성동구 뚝섬로 273", lat: 37.5444, lng: 127.0374, kakaoPlaceId: "8209184", url: "https://place.map.kakao.com/8209184" };
const FREE: Place = { name: "할머니 댁", address: null, lat: null, lng: null, kakaoPlaceId: null, url: null };

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
  vi.stubEnv("NEXT_PUBLIC_KAKAO_JS_KEY", "js-key");
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
    const link = screen.getByRole("link", { name: "카카오맵으로 길찾기" });
    expect(link.getAttribute("href")).toBe(`https://map.kakao.com/link/search/${encodeURIComponent("할머니 댁")}`);
    expect(link.getAttribute("target")).toBe("_blank");
    expect(screen.queryByRole("button", { name: /크게 보기/ })).toBeNull();
    expect(loadKakaoMaps).not.toHaveBeenCalled();
  });

  it("고른 장소: 주소, 작은 지도(끌기 끔) + 핀. 누르면 크게 보기 창(끌기, 확대 단추), Esc 로 닫는다. 앱 셸은 target 없음", async () => {
    inApp = true;
    const { calls, maps } = fakeMaps();
    loadKakaoMaps.mockResolvedValue(maps);
    render(<PlaceSection place={PICKED} />);
    expect(screen.getByText("서울 성동구 뚝섬로 273")).toBeTruthy();
    await act(async () => {});
    expect(calls.map[0]).toMatchObject({ draggable: false, scrollwheel: false });
    expect(calls.markers).toBe(1);
    expect(screen.getByRole("link", { name: "카카오맵으로 길찾기" }).getAttribute("target")).toBeNull();
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
    expect(screen.getByRole("link", { name: "카카오맵으로 길찾기" }).getAttribute("href")).toContain("https://map.kakao.com/link/to/");
  });

  it("키가 없으면(로컬, 목) SDK 를 부르지 않는다", () => {
    vi.stubEnv("NEXT_PUBLIC_KAKAO_JS_KEY", "");
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
