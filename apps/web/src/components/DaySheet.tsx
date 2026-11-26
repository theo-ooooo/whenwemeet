"use client";
// 폰(<600) 날짜 상세 바텀 시트 (docs/설계/폴더블.md 5-3).
// 처음 높이는 내용만큼, 넘치면 화면의 70%까지(#175), 손잡이나 머리를 위로 끌면 전체, 아래로 끌거나 배경을 누르면 닫힘. 손잡이 버튼으로도 반/전체 전환.
// 빠른 추가에서 키보드가 올라오면 visualViewport 만큼 시트를 올려 저장 버튼이 키보드 위에 남게 한다
import { useEffect, useRef, useState } from "react";
import { useDialogKeys } from "./useDialogKeys";
import { haptic } from "@/lib/app-bridge";
import { sheetSnap, type SheetMode } from "@/lib/day-detail";

type Props = {
  titleId: string;
  onClose: () => void;
  /** 삭제 확인 창이 위에 떠 있으면 키와 포커스 가두기를 멈춘다 */
  paused?: boolean;
  /** 스크롤 밖 시트 바닥에 고정하는 주 버튼 바 (#175). 목록이 길어도 늘 보인다 */
  footer?: React.ReactNode;
  children: React.ReactNode;
};

// 바깥 틀(fixed inset-0) 높이 기준. dvh 는 모바일 에뮬레이션과 일부 WebView 에서 창 높이와 어긋난다
const HALF = "70%";
const FULL = "calc(100% - var(--sat) - 12px)";

export function DaySheet({ titleId, onClose, paused = false, footer, children }: Props) {
  const panel = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<SheetMode>("half");
  const [keyboard, setKeyboard] = useState(0);
  const drag = useRef<{ y: number; h: number; lastY: number; lastT: number; vy: number; moved: boolean } | null>(null);
  useDialogKeys(panel, onClose, paused);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // 키보드 높이 = 창 높이 - 보이는 영역 (iOS Safari, 안드로이드 Chrome 공통)
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const onResize = () => setKeyboard(Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)));
    vv.addEventListener("resize", onResize);
    vv.addEventListener("scroll", onResize);
    return () => {
      vv.removeEventListener("resize", onResize);
      vv.removeEventListener("scroll", onResize);
    };
  }, []);

  function onPointerDown(e: React.PointerEvent) {
    const t = e.target as HTMLElement;
    // 손잡이나 머리(data-drag) 에서만 끈다. 머리 안의 닫기, 뒤로 버튼은 그대로 누르게 둔다
    if (!t.closest("[data-drag]") || (t.closest("button") && !t.closest("[data-grab]"))) return;
    if (!panel.current) return;
    drag.current = { y: e.clientY, h: panel.current.offsetHeight, lastY: e.clientY, lastT: e.timeStamp, vy: 0, moved: false };
    const el = panel.current;
    const fullPx = window.innerHeight - 12;

    const move = (ev: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      const dy = ev.clientY - d.y;
      if (Math.abs(dy) > 4) d.moved = true;
      const dt = Math.max(1, ev.timeStamp - d.lastT);
      d.vy = (ev.clientY - d.lastY) / dt;
      d.lastY = ev.clientY;
      d.lastT = ev.timeStamp;
      el.style.transition = "none";
      if (dy >= 0) {
        el.style.transform = `translateY(${dy}px)`;
      } else {
        el.style.transform = "";
        el.style.maxHeight = "none";
        el.style.height = `${Math.min(fullPx, d.h - dy)}px`;
      }
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      const d = drag.current;
      drag.current = null;
      el.style.transition = "";
      el.style.transform = "";
      el.style.height = "";
      el.style.maxHeight = "";
      if (!d || !d.moved) return;
      const next = sheetSnap(mode, ev.clientY - d.y, d.vy);
      if (next === "close") {
        onClose();
        return;
      }
      if (next !== mode) haptic("light");
      setMode(next);
      // 끌기가 끝난 직후의 click(손잡이 버튼 토글) 은 무시한다
      const swallow = (c: MouseEvent) => {
        c.stopPropagation();
        c.preventDefault();
      };
      window.addEventListener("click", swallow, { capture: true, once: true });
      setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 0);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  }

  const full = mode === "full";
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center">
      <button type="button" aria-label="닫기" tabIndex={-1} onClick={onClose} className="anim-fade absolute inset-0 bg-[var(--scrim)]" />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onPointerDown={onPointerDown}
        style={{
          height: full ? FULL : undefined,
          maxHeight: full ? FULL : `min(${HALF}, calc(100% - ${keyboard}px - 12px))`,
          marginBottom: keyboard || undefined,
        }}
        className="anim-sheet relative flex w-full fold:max-w-[480px] flex-col rounded-t-2xl bg-paper transition-[height,max-height] duration-200 ease-[var(--ease-sheet)] motion-reduce:transition-none"
      >
        <div data-drag className="touch-none px-4">
          <button
            type="button"
            data-grab
            onClick={() => setMode(full ? "half" : "full")}
            aria-expanded={full}
            aria-label={full ? "반으로 줄이기" : "전체로 펼치기"}
            className="hit flex h-6 w-full items-center justify-center"
          >
            <span aria-hidden="true" className="block h-[5px] w-10 rounded-full bg-[var(--grab)]" />
          </button>
        </div>
        <div
          className={`min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 ${footer ? "pb-3" : "pb-[calc(20px+var(--sab))]"}`}
        >
          {children}
        </div>
        {footer && (
          <div className="shrink-0 border-t border-line px-4 pb-[calc(12px+var(--sab))] pt-3">{footer}</div>
        )}
      </div>
    </div>
  );
}
