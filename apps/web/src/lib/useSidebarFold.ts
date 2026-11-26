"use client";
// (#315) 사이드바 접힘 상태 훅. 저장값(localStorage wwm_sidebar)을 외부 저장소로 읽어 다른 탭의 변경(storage 이벤트)도 따른다.
// 서버 렌더와 첫 하이드레이션은 저장값 없음으로 본다 (useLayout 도 phone 으로 시작하니 사이드바는 그때 그려지지 않는다)
import { useCallback, useSyncExternalStore } from "react";
import { isCollapsed, readSidebarPref, SIDEBAR_KEY, writeSidebarPref, type SidebarPref } from "./sidebar-fold";
import { useLayout } from "./useLayout";

const CHANGE_EVENT = "wwm:sidebar";
/** 저장소가 막혔을 때(사생활 보호 모드 등) 이번 방문 동안만 기억하는 값 */
let memory: SidebarPref | null = null;

const storage = () => {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
};

function subscribe(cb: () => void) {
  const onStorage = (e: StorageEvent) => {
    if (e.key === SIDEBAR_KEY) cb();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(CHANGE_EVENT, cb);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(CHANGE_EVENT, cb);
  };
}

export function useSidebarFold(): { collapsed: boolean; toggle: () => void } {
  const layout = useLayout();
  const pref = useSyncExternalStore<SidebarPref | null>(
    subscribe,
    () => readSidebarPref(storage()) ?? memory,
    () => null,
  );
  const collapsed = isCollapsed(pref, layout);
  const toggle = useCallback(() => {
    const next: SidebarPref = collapsed ? "expanded" : "collapsed";
    memory = next;
    writeSidebarPref(storage(), next);
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, [collapsed]);
  return { collapsed, toggle };
}
