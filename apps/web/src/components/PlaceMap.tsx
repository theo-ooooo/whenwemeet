"use client";
// (#199) 지도 한 장 + 핀. 내 정보의 지도 선택(D-259)으로 카카오 지도(lib/kakao-map.ts) 또는 네이버 지도(lib/naver-map.ts)를 그린다.
// 좌표는 WGS84 위경도라 장소를 어느 출처에서 골랐든 고른 지도에 그린다. SDK 는 이 칸이 처음 그려질 때 받는다 (lib/map-sdk.ts).
// 미리보기(interactive=false)는 끌기, 확대를 끈 그림, 크게 보기(interactive)는 끌기, 확대 + 확대 단추.
// 키가 없거나 SDK 를 못 받거나 인증에 실패하면 onFail 을 부르고 아무것도 그리지 않는다 (장소 글자와 길찾기 버튼이 남는다, D-244)
import { useEffect, useRef, useState } from "react";
import { kakaoMapJsKey, loadKakaoMaps } from "@/lib/kakao-map";
import type { MapApp } from "@/lib/map-app";
import { loadNaverMaps, naverMapClientId, onNaverAuthFailure } from "@/lib/naver-map";
import { useMapApp } from "@/lib/useMapApp";
import { Skeleton } from "./ui";

type Status = "loading" | "ready" | "failed";

/** 지도를 그릴 수 있는 환경인지 (그 지도의 키가 빌드에 들어 있는지). 없으면 칸 자체를 만들지 않는다 */
export function canShowMap(app: MapApp): boolean {
  return app === "naver" ? naverMapClientId() !== null : kakaoMapJsKey() !== null;
}

type DrawOptions = { lat: number; lng: number; interactive: boolean; level: number };
/** 그린 지도. dispose 로 관찰을 푼다 */
type Drawn = { dispose: () => void };

/** 크기가 바뀌면(시트가 열릴 때) 다시 맞춘다 */
function watchSize(el: HTMLElement, fit: () => void): () => void {
  const observer = new ResizeObserver(fit);
  observer.observe(el);
  return () => observer.disconnect();
}

async function drawKakao(el: HTMLElement, o: DrawOptions): Promise<Drawn | null> {
  const maps = await loadKakaoMaps();
  if (!maps) return null;
  const center = new maps.LatLng(o.lat, o.lng);
  const map = new maps.Map(el, { center, level: o.level, draggable: o.interactive, scrollwheel: o.interactive, disableDoubleClickZoom: !o.interactive });
  map.setZoomable(o.interactive);
  new maps.Marker({ position: center, map });
  if (o.interactive) map.addControl(new maps.ZoomControl(), maps.ControlPosition.RIGHT);
  const stop = watchSize(el, () => {
    map.relayout();
    map.setCenter(center);
  });
  return { dispose: stop };
}

/** 카카오 level 3(약 50m 축척) ≈ 네이버 zoom 16 */
const naverZoom = (level: number) => Math.min(21, Math.max(6, 19 - level));

async function drawNaver(el: HTMLElement, o: DrawOptions): Promise<Drawn | null> {
  const maps = await loadNaverMaps();
  if (!maps) return null;
  // 네이버 지도는 넘긴 요소에 position: relative 를 박아 absolute inset-0 칸이 높이 0 이 된다. 칸을 채우는 안쪽 요소에 그린다
  const inner = document.createElement("div");
  inner.style.width = "100%";
  inner.style.height = "100%";
  el.appendChild(inner);
  const center = new maps.LatLng(o.lat, o.lng);
  const map = new maps.Map(inner, {
    center,
    zoom: naverZoom(o.level),
    draggable: o.interactive,
    pinchZoom: o.interactive,
    scrollWheel: o.interactive,
    keyboardShortcuts: o.interactive,
    disableDoubleClickZoom: !o.interactive,
    disableDoubleTapZoom: !o.interactive,
    disableTwoFingerTapZoom: !o.interactive,
    zoomControl: o.interactive,
    ...(o.interactive ? { zoomControlOptions: { position: maps.Position.TOP_RIGHT } } : {}),
    scaleControl: false,
    mapDataControl: false,
    // 오른쪽 아래는 "크게 보기" 단추 자리라 네이버 로고(이용 조건상 가리면 안 된다)를 왼쪽 아래로
    logoControlOptions: { position: maps.Position.BOTTOM_LEFT },
  });
  new maps.Marker({ position: center, map });
  const stop = watchSize(el, () => {
    map.setSize(new maps.Size(inner.clientWidth, inner.clientHeight));
    map.setCenter(center);
  });
  return {
    dispose: () => {
      stop();
      map.destroy?.();
    },
  };
}

const DRAW: Record<MapApp, (el: HTMLElement, o: DrawOptions) => Promise<Drawn | null>> = { kakao: drawKakao, naver: drawNaver };

export function PlaceMap({
  lat,
  lng,
  interactive = false,
  level = 3,
  className = "",
  label,
  onFail,
}: {
  lat: number;
  lng: number;
  interactive?: boolean;
  level?: number;
  className?: string;
  /** 지도 그림의 이름 (스크린 리더) */
  label: string;
  onFail?: () => void;
}) {
  const [app] = useMapApp();
  const box = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<{ app: MapApp; status: Status }>({ app, status: "loading" });
  const status = state.app === app ? state.status : "loading";
  const failRef = useRef(onFail);
  useEffect(() => {
    failRef.current = onFail;
  }, [onFail]);

  useEffect(() => {
    let alive = true;
    let drawn: Drawn | null = null;
    const el = box.current;
    const fail = () => {
      if (!alive) return;
      setState({ app, status: "failed" });
      failRef.current?.();
    };
    // 네이버는 인증 실패가 그린 뒤에 올 수 있다 (window.navermap_authFailure)
    const unlisten = app === "naver" ? onNaverAuthFailure(fail) : () => {};
    if (el) {
      // 다른 지도로 바뀌면 그 SDK 가 남긴 그림을 비운다
      el.replaceChildren();
      void DRAW[app](el, { lat, lng, interactive, level })
        .then((d) => {
          if (!alive) return d?.dispose();
          if (!d) return fail();
          drawn = d;
          setState({ app, status: "ready" });
        })
        .catch(fail);
    }
    return () => {
      alive = false;
      unlisten();
      drawn?.dispose();
    };
  }, [app, lat, lng, interactive, level]);

  if (status === "failed") return null;
  return (
    <div className={`relative overflow-hidden ${className}`}>
      <div ref={box} role="img" aria-label={label} className="absolute inset-0" />
      {status === "loading" && <Skeleton className="absolute inset-0 rounded-none" />}
    </div>
  );
}
