"use client";
// 팀 접근 권한이 사라졌을 때(403) lib/api 가 쏘는 이벤트를 받는다 (#18). AppShell 이 안내 화면으로 바꾸는 데 쓴다
import { useEffect } from "react";
import { GROUP_GONE_EVENT } from "@/lib/api";

export function useGroupGone(onGone: () => void) {
  useEffect(() => {
    window.addEventListener(GROUP_GONE_EVENT, onGone);
    return () => window.removeEventListener(GROUP_GONE_EVENT, onGone);
  }, [onGone]);
}
