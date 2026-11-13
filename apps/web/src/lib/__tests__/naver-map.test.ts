// @vitest-environment happy-dom
// (D-259) 네이버 지도 JS v3 지연 로더 (lib/naver-map.ts, 틀은 lib/map-sdk.ts): 키 없으면 안 부름, ncpKeyId, 한 번만, 실패 뒤 다시, 인증 실패
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// happy-dom 은 바깥 스크립트를 받지 않고 곧바로 오류를 내므로 붙이는 순간 가로챈다 (onload, onerror 는 테스트가 부른다)
let captured: HTMLScriptElement[] = [];
const scripts = () => captured;
type W = { naver?: unknown; navermap_authFailure?: () => void };

async function fresh() {
  vi.resetModules();
  return import("../naver-map");
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_NAVER_MAP_CLIENT_ID", "naver-id");
  captured = [];
  vi.spyOn(document.head, "appendChild").mockImplementation(<T extends Node>(node: T) => {
    captured.push(node as unknown as HTMLScriptElement);
    return node;
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  delete (window as W).naver;
  delete (window as W).navermap_authFailure;
});

const FAKE = { Map: function Map() {}, LatLng: function LatLng() {} };

describe("loadNaverMaps", () => {
  it("키가 없으면 스크립트를 붙이지 않고 null", async () => {
    vi.stubEnv("NEXT_PUBLIC_NAVER_MAP_CLIENT_ID", "");
    const m = await fresh();
    expect(await m.loadNaverMaps()).toBeNull();
    expect(scripts()).toHaveLength(0);
  });

  it("주소 파라미터는 ncpKeyId (ncpClientId 아님). 받으면 naver.maps, 여러 번 불러도 스크립트 하나", async () => {
    const m = await fresh();
    expect(m.naverMapSdkUrl("abc")).toBe("https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=abc");
    const a = m.loadNaverMaps();
    const b = m.loadNaverMaps();
    expect(scripts()).toHaveLength(1);
    expect(scripts()[0].src).toContain("ncpKeyId=naver-id");
    (window as W).naver = { maps: FAKE };
    scripts()[0].onload?.(new Event("load"));
    expect(await a).toBe(FAKE);
    expect(await b).toBe(FAKE);
    expect(await m.loadNaverMaps()).toBe(FAKE);
    expect(scripts()).toHaveLength(1);
  });

  it("받은 뒤 객체가 늦게 생기면 기다린다", async () => {
    vi.useFakeTimers();
    try {
      const m = await fresh();
      const p = m.loadNaverMaps();
      scripts()[0].onload?.(new Event("load"));
      (window as W).naver = { maps: FAKE };
      await vi.advanceTimersByTimeAsync(60);
      expect(await p).toBe(FAKE);
    } finally {
      vi.useRealTimers();
    }
  });

  it("못 받으면 null. 다음 호출은 스크립트를 다시 붙인다", async () => {
    const m = await fresh();
    const p = m.loadNaverMaps();
    scripts()[0].onerror?.(new Event("error"));
    expect(await p).toBeNull();
    void m.loadNaverMaps();
    expect(scripts()).toHaveLength(2);
  });

  it("인증 실패(window.navermap_authFailure)는 듣는 쪽에 알리고, 이후 로드는 null", async () => {
    const m = await fresh();
    const p = m.loadNaverMaps();
    (window as W).naver = { maps: FAKE };
    scripts()[0].onload?.(new Event("load"));
    expect(await p).toBe(FAKE);
    const heard = vi.fn();
    const off = m.onNaverAuthFailure(heard);
    (window as W).navermap_authFailure?.();
    expect(heard).toHaveBeenCalledTimes(1);
    expect(await m.loadNaverMaps()).toBeNull();
    off();
    m.resetNaverAuthForTest();
    expect(await m.loadNaverMaps()).toBe(FAKE);
  });
});

describe("loadKakaoMaps (같은 틀)", () => {
  it("받으면 kakao.maps.load 까지 마친 객체, 키가 없으면 null", async () => {
    vi.stubEnv("NEXT_PUBLIC_KAKAO_MAP_JS_KEY", "kakao-key");
    vi.resetModules();
    const k = await import("../kakao-map");
    const p = k.loadKakaoMaps();
    expect(scripts()[0].src).toContain("appkey=kakao-key");
    const maps = { Map: function Map() {}, load: (cb: () => void) => cb() };
    (window as unknown as { kakao?: unknown }).kakao = { maps };
    scripts()[0].onload?.(new Event("load"));
    expect(await p).toBe(maps);
    delete (window as unknown as { kakao?: unknown }).kakao;
    vi.stubEnv("NEXT_PUBLIC_KAKAO_MAP_JS_KEY", "");
    vi.resetModules();
    expect(await (await import("../kakao-map")).loadKakaoMaps()).toBeNull();
  });
});
