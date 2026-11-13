// (#199) 카카오 지도 JS SDK 지연 로더. 지도가 필요한 화면(일정 상세의 장소 칸)이 처음 그려질 때만 스크립트를 붙인다.
// 키는 카카오 공유와 같은 공개 JavaScript 키(NEXT_PUBLIC_KAKAO_JS_KEY). 카카오 개발자 콘솔에서 [카카오맵] 사용 설정과
// [JavaScript SDK 도메인] 에 웹 주소를 등록해야 지도가 뜬다 (docs/운영/장소-검색.md). 키가 없거나, 받지 못하거나,
// 8초 안에 준비되지 않으면 null: 화면은 장소 글자와 길찾기 버튼만 남긴다 (D-244)
import { kakaoJsKey } from "./kakao-share";

export const KAKAO_MAP_SDK_BASE = "https://dapi.kakao.com/v2/maps/sdk.js";
const SDK_TIMEOUT_MS = 8_000;

/** 쓰는 만큼만 적은 SDK 모양 */
export type KakaoLatLng = object;
export type KakaoMapInstance = {
  setCenter: (latlng: KakaoLatLng) => void;
  setLevel: (level: number) => void;
  setDraggable: (on: boolean) => void;
  setZoomable: (on: boolean) => void;
  relayout: () => void;
  addControl: (control: object, position: unknown) => void;
};
export type KakaoMaps = {
  load: (cb: () => void) => void;
  LatLng: new (lat: number, lng: number) => KakaoLatLng;
  Map: new (el: HTMLElement, opts: { center: KakaoLatLng; level: number; draggable?: boolean; scrollwheel?: boolean; disableDoubleClickZoom?: boolean }) => KakaoMapInstance;
  Marker: new (opts: { position: KakaoLatLng; map: KakaoMapInstance }) => object;
  ZoomControl: new () => object;
  ControlPosition: { RIGHT: unknown };
};

export function kakaoMapSdkUrl(key: string): string {
  return `${KAKAO_MAP_SDK_BASE}?${new URLSearchParams({ appkey: key, autoload: "false" }).toString()}`;
}

function currentMaps(): KakaoMaps | null {
  const maps = (window as unknown as { kakao?: { maps?: KakaoMaps } }).kakao?.maps;
  return maps && typeof maps.Map === "function" ? maps : null;
}

let loading: Promise<KakaoMaps | null> | null = null;

/** SDK 를 받아 `kakao.maps.load` 까지 마친 객체. 실패하면 null 이고 다음 호출에 다시 시도한다 */
export function loadKakaoMaps(): Promise<KakaoMaps | null> {
  if (typeof window === "undefined") return Promise.resolve(null);
  const key = kakaoJsKey();
  if (!key) return Promise.resolve(null);
  const ready = currentMaps();
  if (ready) return Promise.resolve(ready);
  if (loading) return loading;
  const p = new Promise<KakaoMaps | null>((resolve) => {
    const s = document.createElement("script");
    s.src = kakaoMapSdkUrl(key);
    s.async = true;
    const timer = setTimeout(() => done(null), SDK_TIMEOUT_MS);
    function done(v: KakaoMaps | null) {
      clearTimeout(timer);
      if (!v) s.remove();
      resolve(v);
    }
    s.onload = () => {
      const base = (window as unknown as { kakao?: { maps?: { load?: (cb: () => void) => void } } }).kakao?.maps;
      if (!base || typeof base.load !== "function") return done(null);
      base.load(() => done(currentMaps()));
    };
    s.onerror = () => done(null);
    document.head.appendChild(s);
  });
  loading = p;
  void p.then((v) => {
    if (loading === p && v === null) loading = null;
  });
  return p;
}
