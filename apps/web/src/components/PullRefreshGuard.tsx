"use client";
// (#419) 앱 셸 안에서만: 손가락을 댈 때마다 이번 손짓에서 당겨서 새로고침을 막을지 셸에 알린다 (lib/pull-refresh-guard.ts).
// 값이 바뀔 때만 보낸다. 옛 셸은 모르는 메시지라 버린다
import { useEffect } from "react";
import { isInApp, postToApp } from "@/lib/app-bridge";
import { blocksPullRefresh, type GuardNode } from "@/lib/pull-refresh-guard";

export function PullRefreshGuard() {
  useEffect(() => {
    if (!isInApp()) return;
    let last: boolean | null = null;
    const onTouchStart = (e: TouchEvent) => {
      const target = e.target instanceof Element ? e.target : null;
      const modal = document.querySelector('[aria-modal="true"]') !== null;
      const allow = !blocksPullRefresh(target as unknown as GuardNode | null, (n) => getComputedStyle(n as unknown as Element).overflowY, modal);
      if (allow === last) return;
      last = allow;
      postToApp({ type: "pullRefresh", allow });
    };
    document.addEventListener("touchstart", onTouchStart, { capture: true, passive: true });
    return () => document.removeEventListener("touchstart", onTouchStart, { capture: true });
  }, []);
  return null;
}
