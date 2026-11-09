"use client";
// 화면 폭이 PC 배치(≥1024px, Tailwind lg) 인지. 일정 상세를 시트(모바일)로 열지 우측 패널(PC)로 열지 고를 때 쓴다
import { useSyncExternalStore } from "react";

const QUERY = "(min-width: 1024px)";

function subscribe(cb: () => void) {
  const mq = window.matchMedia(QUERY);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}

export function useIsDesktop(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => false,
  );
}
