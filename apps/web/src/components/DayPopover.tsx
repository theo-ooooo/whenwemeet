"use client";
// 넓은 화면(fold ≥600, pc) 날짜 상세 팝오버 (docs/설계/폴더블.md 5-4). 자리 규칙은 #46 빠른 추가 팝오버 그대로:
// 날짜 칸 오른쪽, 자리가 없으면 왼쪽, 위아래는 화면 안으로. 배경은 어둡게 하지 않고 포커스만 가둔다.
// 바깥을 누르거나 Esc 로 닫는다. 날짜 칸을 누른 경우는 CalendarScreen 이 "닫고 그 날짜로 다시 열기" 로 처리한다
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useDialogKeys } from "./useDialogKeys";

const POP_W = 300;
const GAP = 10;
const MARGIN = 16;

/** 날짜 칸 옆(오른쪽, 자리가 없으면 왼쪽)에 붙인다. 위아래는 화면 안으로 맞춘다 */
function placeBeside(anchor: DOMRect, h: number): { left: number; top: number } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let left = anchor.right + GAP;
  if (left + POP_W > vw - MARGIN) left = anchor.left - GAP - POP_W;
  left = Math.max(MARGIN, Math.min(left, vw - MARGIN - POP_W));
  const top = Math.max(MARGIN, Math.min(anchor.top, vh - MARGIN - h));
  return { left, top };
}

type Props = {
  /** 붙일 날짜 칸 (data-date). 지금 달력에 없으면 화면 위쪽 가운데 */
  anchorDate: string;
  titleId: string;
  onClose: () => void;
  paused?: boolean;
  /** 스크롤 밖 팝오버 바닥에 고정하는 주 버튼 바 (#175) */
  footer?: React.ReactNode;
  children: React.ReactNode;
};

export function DayPopover({ anchorDate, titleId, onClose, paused = false, footer, children }: Props) {
  const panel = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useDialogKeys(panel, onClose, paused);

  // 그린 뒤 높이를 재서 자리를 잡는다. 단계가 바뀌어 높이가 달라지거나 창 크기가 바뀌면 다시
  useLayoutEffect(() => {
    const place = () => {
      if (!panel.current) return;
      const cell = document.querySelector<HTMLElement>(`[data-date="${anchorDate}"]`);
      const rect = cell?.getBoundingClientRect() ?? new DOMRect(window.innerWidth / 2 - POP_W / 2, 120, 0, 0);
      setPos(placeBeside(rect, panel.current.offsetHeight));
    };
    place();
    const ro = new ResizeObserver(place);
    if (panel.current) ro.observe(panel.current);
    window.addEventListener("resize", place);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", place);
    };
  }, [anchorDate]);

  // 바깥을 누르면 닫는다. 날짜 칸(다른 날 열기)은 칸의 click 이 처리하므로 여기서는 건너뛴다
  useEffect(() => {
    if (paused) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement;
      if (panel.current?.contains(t)) return;
      if (t.closest?.("[data-date]")) return;
      onClose();
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [onClose, paused]);

  return (
    <div
      ref={panel}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      style={{ left: pos?.left ?? -9999, top: pos?.top ?? 0, width: POP_W, boxShadow: "var(--pop-shadow)" }}
      // 자리 잡기 전에는 투명하게만 둔다. visibility:hidden 이면 제목 입력의 autoFocus 가 먹지 않는다
      className={`fixed z-40 flex max-h-[calc(100dvh-32px)] flex-col overflow-hidden rounded-xl border border-line bg-paper ${pos ? "anim-fade" : "opacity-0"}`}
    >
      <div className={`min-h-0 flex-1 overflow-y-auto px-3.5 pt-1.5 ${footer ? "pb-3" : "pb-3.5"}`}>{children}</div>
      {footer && <div className="shrink-0 border-t border-line px-3.5 py-3">{footer}</div>}
    </div>
  );
}
