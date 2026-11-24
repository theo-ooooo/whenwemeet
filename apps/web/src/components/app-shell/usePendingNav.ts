"use client";
// (#490) 메뉴를 누른 순간의 칩 위치. AppShell 에서 옮김
import { useCallback, useEffect, useState } from "react";
import type { PendingNav } from "@/lib/routes";

export function usePendingNav() {
  // (#339) 메뉴(폰 독, 사이드바)를 누른 순간 칩을 옮긴다. 주소가 바뀌면 navTab 이 주소를 따른다
  const [pendingNav, setPendingNav] = useState<PendingNav | null>(null);
  const onMenuNavigate = useCallback((href: string) => setPendingNav({ from: window.location.pathname, to: href }), []);
  // 도착 전에 뒤로 가기 등으로 떠나면 누른 칩을 버린다
  useEffect(() => {
    const drop = () => setPendingNav(null);
    window.addEventListener("popstate", drop);
    return () => window.removeEventListener("popstate", drop);
  }, []);
  return { pendingNav, onMenuNavigate };
}
