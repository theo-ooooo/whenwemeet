"use client";
// 지금 배치(phone | fold | pc). 날짜 상세를 일 상세 화면으로 열지 오른쪽 패널(#331)로 열지, 피커를 시트로 열지 고를 때 쓴다 (폴더블.md 3장)
// 서버 렌더와 첫 하이드레이션은 phone 으로 본다 (모바일 우선)
import { useSyncExternalStore } from "react";
import { FOLD_QUERY, layoutFromMatches, PC_QUERY, type Layout } from "./layout";

function subscribe(cb: () => void) {
  const a = window.matchMedia(FOLD_QUERY);
  const b = window.matchMedia(PC_QUERY);
  a.addEventListener("change", cb);
  b.addEventListener("change", cb);
  return () => {
    a.removeEventListener("change", cb);
    b.removeEventListener("change", cb);
  };
}

export function useLayout(): Layout {
  return useSyncExternalStore(
    subscribe,
    () => layoutFromMatches(window.matchMedia(FOLD_QUERY).matches, window.matchMedia(PC_QUERY).matches),
    () => "phone",
  );
}
