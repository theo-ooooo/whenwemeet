// (#199) 카카오 지도 JS SDK 지연 로더. 지도가 필요한 화면(일정 상세의 장소 칸)이 처음 그려질 때만 스크립트를 붙인다.
// 키는 지도 전용 카카오 앱(무료 쿼터가 있는 앱)의 공개 JavaScript 키 NEXT_PUBLIC_KAKAO_MAP_JS_KEY. 로그인, 공유 앱 키(NEXT_PUBLIC_KAKAO_JS_KEY)와 다르다.
// 그 앱의 [카카오맵] 사용 설정과 JavaScript 키 도메인에 웹 주소를 등록해야 지도가 뜬다 (docs/운영/카카오-개발자센터.md). 키가 없거나, 받지 못하거나,
// 8초 안에 준비되지 않으면 null: 화면은 장소 글자와 길찾기 버튼만 남긴다 (D-244). 받는 틀은 lib/map-sdk.ts (네이버 지도와 같이 쓴다, D-259)
import { createSdkLoader } from "./map-sdk";

/** 빌드 때 박히는 지도 전용 공개 JS 키. 없으면(프리뷰, 목) 지도를 그리지 않는다 */
export function kakaoMapJsKey(): string | null {
  return process.env.NEXT_PUBLIC_KAKAO_MAP_JS_KEY?.trim() || null;
}

export const KAKAO_MAP_SDK_BASE = "https://dapi.kakao.com/v2/maps/sdk.js";

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
  Map: new (
    el: HTMLElement,
    opts: { center: KakaoLatLng; level: number; draggable?: boolean; scrollwheel?: boolean; disableDoubleClickZoom?: boolean },
  ) => KakaoMapInstance;
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

/** SDK 를 받아 `kakao.maps.load` 까지 마친 객체. 실패하면 null 이고 다음 호출에 다시 시도한다 */
export const loadKakaoMaps: () => Promise<KakaoMaps | null> = createSdkLoader<KakaoMaps>({
  url: () => {
    const key = kakaoMapJsKey();
    return key ? kakaoMapSdkUrl(key) : null;
  },
  current: currentMaps,
  init: (done) => {
    const base = (window as unknown as { kakao?: { maps?: { load?: (cb: () => void) => void } } }).kakao?.maps;
    if (!base || typeof base.load !== "function") return done(null);
    base.load(() => done(currentMaps()));
  },
});
