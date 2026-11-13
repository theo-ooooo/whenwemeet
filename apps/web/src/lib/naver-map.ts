// (D-259) 네이버 지도 JS v3 지연 로더. 내 정보의 지도 선택이 네이버 지도일 때 일정 상세의 장소 칸이 처음 그려질 때만 스크립트를 붙인다 (lib/map-sdk.ts).
// 키는 NCP Maps Application 의 Client ID NEXT_PUBLIC_NAVER_MAP_CLIENT_ID (공개값, 빌드 때 박힌다). 주소 파라미터 이름은 ncpKeyId
// (ncpClientId 는 인증 실패). 허용 도메인(웹 서비스 URL)은 https://whenwemeet.day, http://localhost:3000, http://localhost.
// 키가 없거나, 받지 못하거나, 인증에 실패하면(window.navermap_authFailure) 지도 칸을 숨긴다 (카카오와 같은 처리, D-244)
import { createSdkLoader } from "./map-sdk";

/** 빌드 때 박히는 네이버 지도 Client ID. 없으면(프리뷰, 목) 지도를 그리지 않는다 */
export function naverMapClientId(): string | null {
  return process.env.NEXT_PUBLIC_NAVER_MAP_CLIENT_ID?.trim() || null;
}

export const NAVER_MAP_SDK_BASE = "https://oapi.map.naver.com/openapi/v3/maps.js";

export function naverMapSdkUrl(clientId: string): string {
  return `${NAVER_MAP_SDK_BASE}?${new URLSearchParams({ ncpKeyId: clientId }).toString()}`;
}

/** 쓰는 만큼만 적은 SDK 모양 */
export type NaverLatLng = object;
export type NaverMapInstance = {
  setCenter: (latlng: NaverLatLng) => void;
  setSize: (size: object) => void;
  destroy?: () => void;
};
export type NaverMapOptions = {
  center: NaverLatLng;
  zoom: number;
  draggable: boolean;
  pinchZoom: boolean;
  scrollWheel: boolean;
  keyboardShortcuts: boolean;
  disableDoubleClickZoom: boolean;
  disableDoubleTapZoom: boolean;
  disableTwoFingerTapZoom: boolean;
  zoomControl: boolean;
  zoomControlOptions?: { position: unknown };
  scaleControl: boolean;
  mapDataControl: boolean;
  logoControlOptions?: { position: unknown };
};
export type NaverMaps = {
  LatLng: new (lat: number, lng: number) => NaverLatLng;
  Map: new (el: HTMLElement, opts: NaverMapOptions) => NaverMapInstance;
  Marker: new (opts: { position: NaverLatLng; map: NaverMapInstance }) => object;
  Size: new (width: number, height: number) => object;
  Position: { TOP_RIGHT: unknown; BOTTOM_LEFT: unknown };
};

type AuthWindow = { navermap_authFailure?: () => void; naver?: { maps?: NaverMaps } };

let authFailed = false;
const authListeners = new Set<() => void>();

/** 인증 실패 콜백을 한 번 건다. 실패하면 이후 로드는 null, 그린 지도는 듣는 쪽이 숨긴다 */
function installAuthHook() {
  const w = window as unknown as AuthWindow;
  w.navermap_authFailure = () => {
    authFailed = true;
    for (const l of [...authListeners]) l();
  };
}

/** 인증 실패를 듣는다 (그린 뒤에 늦게 올 수 있다). 해제 함수를 돌려준다 */
export function onNaverAuthFailure(listener: () => void): () => void {
  authListeners.add(listener);
  return () => authListeners.delete(listener);
}

function currentMaps(): NaverMaps | null {
  if (authFailed) return null;
  const maps = (window as unknown as AuthWindow).naver?.maps;
  return maps && typeof maps.Map === "function" && typeof maps.LatLng === "function" ? maps : null;
}

const load = createSdkLoader<NaverMaps>({
  url: () => {
    const id = naverMapClientId();
    return id ? naverMapSdkUrl(id) : null;
  },
  current: currentMaps,
  beforeLoad: installAuthHook,
});

/** SDK 를 받은 객체. 키가 없거나, 실패, 인증 실패면 null */
export function loadNaverMaps(): Promise<NaverMaps | null> {
  if (authFailed) return Promise.resolve(null);
  return load();
}

/** 테스트용: 인증 실패 상태를 지운다 */
export function resetNaverAuthForTest() {
  authFailed = false;
  authListeners.clear();
}
