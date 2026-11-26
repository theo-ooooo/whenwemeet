"use client";
// (#192) 달력 보기 저장값 훅. 저장값(localStorage wwm_cal_view)을 외부 저장소로 읽어 다른 탭의 변경(storage 이벤트)도 따른다.
// 서버 렌더와 첫 하이드레이션은 저장값 없음(월)으로 본다 (useSidebarFold 와 같은 방식)
import { useCallback, useSyncExternalStore } from "react";
import { CAL_VIEW_KEY, readCalView, writeCalView, type CalView } from "./calendar-view";

const CHANGE_EVENT = "wwm:cal-view";
/** 저장소가 막혔을 때(사생활 보호 모드 등) 이번 방문 동안만 기억하는 값 */
let memory: CalView | null = null;

const storage = () => {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
};

function subscribe(cb: () => void) {
  const onStorage = (e: StorageEvent) => {
    if (e.key === CAL_VIEW_KEY) cb();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(CHANGE_EVENT, cb);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(CHANGE_EVENT, cb);
  };
}

export function useCalendarViewPref(): { pref: CalView | null; save: (v: CalView) => void } {
  const pref = useSyncExternalStore<CalView | null>(
    subscribe,
    () => readCalView(storage()) ?? memory,
    () => null,
  );
  const save = useCallback((v: CalView) => {
    memory = v;
    writeCalView(storage(), v);
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, []);
  return { pref, save };
}
