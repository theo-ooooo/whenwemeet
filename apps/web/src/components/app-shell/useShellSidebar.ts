"use client";
// (#490) 넓은 화면 여부와 사이드바 접기, 접기 전환 애니메이션 켜기. AppShell 에서 옮김
import { useEffect, useState } from "react";
import { useLayout } from "@/lib/useLayout";
import { useSidebarFold } from "@/lib/useSidebarFold";

export function useShellSidebar() {
  const wide = useLayout() !== "phone";
  // (#315) 사이드바 접기. 처음 그린 뒤에만 너비 전환을 켠다 (저장값을 읽어 첫 화면이 바로 접힌 폭이 될 때 애니메이션이 보이지 않게)
  const fold = useSidebarFold();
  const [animate, setAnimate] = useState(false);
  useEffect(() => {
    const id = window.requestAnimationFrame(() => setAnimate(true));
    return () => window.cancelAnimationFrame(id);
  }, []);
  return { wide, fold, animate };
}
