// 길찾기 지도 앱 선택 (네이버 지도 / 카카오맵). 기본은 네이버 지도.
// 화면 테마, 사이드바 접힘처럼 기기 취향이라 이 브라우저(앱 셸 웹뷰 포함)의 localStorage 에만 둔다. 서버에 저장하지 않는다.
// 장소 칸의 작은 지도는 바꾸지 않는다 (카카오 지도. 장소 ID 와 좌표가 카카오 것이다). 바뀌는 것은 "길찾기", "지도에서 보기" 버튼이 여는 곳뿐.
// React 를 import 하지 않는다 (단위 테스트 대상)

export type MapApp = "naver" | "kakao";

export const MAP_APP_KEY = "wwm_map_app";
export const DEFAULT_MAP_APP: MapApp = "naver";

export const MAP_APP_NAMES: Record<MapApp, string> = { naver: "네이버 지도", kakao: "카카오맵" };

type Store = Pick<Storage, "getItem" | "setItem"> | null;

/** 저장값. 모르는 값이나 저장소가 막혔으면 기본값 */
export function readMapApp(store: Store): MapApp {
  try {
    const v = store?.getItem(MAP_APP_KEY);
    return v === "naver" || v === "kakao" ? v : DEFAULT_MAP_APP;
  } catch {
    return DEFAULT_MAP_APP;
  }
}

export function writeMapApp(store: Store, value: MapApp): void {
  try {
    store?.setItem(MAP_APP_KEY, value);
  } catch {}
}

/** 버튼 글자 "네이버 지도로 길찾기" / "카카오맵으로 길찾기" / "…에서 보기" ("지도"는 받침 없음 "로", "카카오맵"은 받침 ㅂ "으로") */
const ROUTE_LABELS: Record<MapApp, string> = { naver: "네이버 지도로 길찾기", kakao: "카카오맵으로 길찾기" };

export function directionsLabel(app: MapApp, kind: "route" | "view"): string {
  return kind === "route" ? ROUTE_LABELS[app] : `${MAP_APP_NAMES[app]}에서 보기`;
}
