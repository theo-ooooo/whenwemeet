"use client";
// 지도 선택 훅 (lib/map-app.ts). 다른 탭에서 바꿔도 따른다. 서버 렌더와 첫 하이드레이션은 기본값(네이버 지도)
import { useCallback, useSyncExternalStore } from "react";
import { DEFAULT_MAP_APP, MAP_APP_KEY, readMapApp, writeMapApp, type MapApp } from "./map-app";

const CHANGE_EVENT = "wwm:map-app";
/** 저장소가 막혔을 때 이번 방문 동안만 기억하는 값 */
let memory: MapApp | null = null;

const storage = () => {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
};

function subscribe(cb: () => void) {
  const onStorage = (e: StorageEvent) => {
    if (e.key === MAP_APP_KEY) cb();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(CHANGE_EVENT, cb);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(CHANGE_EVENT, cb);
  };
}

function snapshot(): MapApp {
  const s = storage();
  return s?.getItem(MAP_APP_KEY) ? readMapApp(s) : (memory ?? DEFAULT_MAP_APP);
}

export function useMapApp(): [MapApp, (next: MapApp) => void] {
  const app = useSyncExternalStore(subscribe, snapshot, () => DEFAULT_MAP_APP);
  const set = useCallback((next: MapApp) => {
    memory = next;
    writeMapApp(storage(), next);
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, []);
  return [app, set];
}
