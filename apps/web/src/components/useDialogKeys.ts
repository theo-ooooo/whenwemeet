"use client";
// 날짜 상세(시트, 팝오버) 공통 키 처리. 원래 QuickAdd(#46) 에 있던 것을 옮겼다
import { useEffect, useState } from "react";

/** 창 안 포커스 가능한 요소 */
export const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * 열려 있는 동안 Tab 을 창 안에 가두고 Esc 로 닫는다. 닫히면(언마운트) 열기 전 포커스(누른 날짜 칸)로 돌려준다.
 * paused 이면(삭제 확인 창이 위에 떠 있을 때) 키를 건드리지 않는다
 */
export function useDialogKeys(ref: React.RefObject<HTMLElement | null>, onClose: () => void, paused = false) {
  // 렌더 시점에 잡아야 한다. 효과가 돌 때는 이미 제목 입력(autoFocus)으로 포커스가 옮겨가 있다
  const [prev] = useState(() => (typeof document === "undefined" ? null : (document.activeElement as HTMLElement | null)));
  useEffect(() => {
    if (paused) return;
    const onKey = (e: KeyboardEvent) => {
      // 안쪽(펼친 시각 목록, 피커 등)이 Esc 를 먼저 처리했으면 창은 닫지 않는다
      if (e.defaultPrevented) return;
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab" || !ref.current) return;
      const items = Array.from(ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null);
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !ref.current.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !ref.current.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [ref, onClose, paused]);

  useEffect(() => {
    return () => {
      // 닫은 뒤 원래 자리(날짜 칸, 다가오는 일정 행)로 포커스를 돌린다
      if (prev && prev !== document.body && document.contains(prev)) prev.focus({ preventScroll: true });
    };
  }, [prev]);
}
