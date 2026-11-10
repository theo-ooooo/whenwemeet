"use client";
// 작성 중(active)일 때 화면 이탈을 한 번 묻는다 (#137).
//   - 앱 안 링크 클릭(독, 레일, 사이드바, 상단 바): 문서 캡처 단계에서 가로채 확인 창을 띄운다
//   - 링크가 아닌 이동(팀 전환): lib/leave-guard confirmLeave 를 거친다
//   - 새로고침, 탭 닫기, 주소 이동: beforeunload (브라우저 기본 확인 창)
// 브라우저 뒤로 가기(popstate)는 막지 않는다. 기록을 조작하면 Next 라우터 상태와 어긋난다
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isInternalNavClick, setLeaveGuard } from "./leave-guard";

export function useLeaveGuard(active: boolean) {
  const router = useRouter();
  const [pendingGo, setPendingGo] = useState<(() => void) | null>(null);
  const activeRef = useRef(active);
  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  const request = useCallback((go: () => void) => {
    if (activeRef.current) setPendingGo(() => go);
    else go();
  }, []);

  const confirm = useCallback(() => {
    const go = pendingGo;
    setPendingGo(null);
    // 확인했으면 이동이 끝날 때까지 다시 묻지 않는다
    activeRef.current = false;
    go?.();
  }, [pendingGo]);

  const cancel = useCallback(() => setPendingGo(null), []);

  useEffect(() => {
    if (!active) return;
    setLeaveGuard(request);

    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!activeRef.current) return;
      e.preventDefault();
      // 일부 브라우저는 returnValue 가 있어야 확인 창을 띄운다
      e.returnValue = "";
    };
    const onClick = (e: MouseEvent) => {
      if (!activeRef.current) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a) return;
      const internal = isInternalNavClick(
        e,
        { href: a.href, target: a.target, hasDownload: a.hasAttribute("download") },
        { origin: window.location.origin, href: window.location.href },
      );
      if (!internal) return;
      e.preventDefault();
      e.stopPropagation();
      const url = new URL(a.href);
      request(() => router.push(url.pathname + url.search + url.hash));
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      setLeaveGuard(null);
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [active, request, router]);

  return useMemo(() => ({ pending: pendingGo !== null, request, confirm, cancel }), [pendingGo, request, confirm, cancel]);
}
