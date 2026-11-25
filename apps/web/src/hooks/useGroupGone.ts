"use client";
// 팀 접근 권한이 사라졌을 때(403) lib/api 가 쏘는 이벤트를 받는다 (#18). AppShell 이 안내 화면으로 바꾸는 데 쓴다
import { useEffect } from "react";
import { GROUP_GONE_EVENT, GROUP_HIDDEN_EVENT } from "@/lib/api";

export function useGroupGone(onGone: () => void) {
  useEffect(() => {
    window.addEventListener(GROUP_GONE_EVENT, onGone);
    return () => window.removeEventListener(GROUP_GONE_EVENT, onGone);
  }, [onGone]);
}

/** (#515) 팀이 운영 숨김(403 GROUP_HIDDEN)이 됐을 때. AppShell 이 팀 목록을 다시 받는다 */
export function useGroupHidden(onHidden: () => void) {
  useEffect(() => {
    window.addEventListener(GROUP_HIDDEN_EVENT, onHidden);
    return () => window.removeEventListener(GROUP_HIDDEN_EVENT, onHidden);
  }, [onHidden]);
}
