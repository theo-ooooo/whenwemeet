"use client";
// 피커 공통 틀 (#67). 모바일은 바텀 시트(body 포털), PC(≥1024px) 는 입력 칸 아래 팝오버.
// - Esc 로 피커만 닫는다. 바깥 다이얼로그(빠른 추가, 기념일 시트) 는 document keydown 으로 Esc 를 받으므로
//   네이티브 이벤트의 stopImmediatePropagation 으로 그쪽까지 가지 않게 막는다
// - Tab 은 피커 안에 가둔다. 닫히면 입력 칸(트리거) 으로 포커스를 돌린다
// - PC 팝오버는 포털을 쓰지 않는다. 빠른 추가 팝오버가 "패널 밖 pointerdown 이면 닫기" 라서 DOM 안에 있어야 한다
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { IconClose } from "../icons";
import { useIsDesktop } from "@/lib/useIsDesktop";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const MARGIN = 12;
const GAP = 6;

type Props = {
  open: boolean;
  onClose: () => void;
  trigger: React.RefObject<HTMLElement | null>;
  /** 시트 제목, 다이얼로그 이름 */
  title: string;
  /** PC 팝오버 폭 */
  width: number;
  children: React.ReactNode;
};

export function PickerShell({ open, onClose, trigger, title, width, children }: Props) {
  const desktop = useIsDesktop();
  if (!open) return null;
  return desktop ? (
    <Popover onClose={onClose} trigger={trigger} title={title} width={width}>
      {children}
    </Popover>
  ) : (
    <BottomSheet onClose={onClose} trigger={trigger} title={title}>
      {children}
    </BottomSheet>
  );
}

type InnerProps = Omit<Props, "open" | "width">;

/** Esc 닫기 + Tab 가두기. 패널의 onKeyDown 에 붙인다 */
function usePanelKeys(panel: React.RefObject<HTMLDivElement | null>, onClose: () => void) {
  return (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      e.nativeEvent.stopImmediatePropagation();
      onClose();
      return;
    }
    if (e.key !== "Tab" || !panel.current) return;
    // 바깥 다이얼로그의 Tab 가두기가 포커스를 빼앗지 않게 여기서 끝낸다
    e.nativeEvent.stopImmediatePropagation();
    const items = Array.from(panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null);
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && active === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  };
}

/** 닫힐 때 트리거로 포커스를 돌린다 */
function useReturnFocus(trigger: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = trigger.current;
    return () => {
      if (el && document.contains(el)) el.focus({ preventScroll: true });
    };
  }, [trigger]);
}

function BottomSheet({ onClose, trigger, title, children }: InnerProps) {
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const onKeyDown = usePanelKeys(panel, onClose);
  useReturnFocus(trigger);
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <button type="button" aria-label="닫기" tabIndex={-1} onClick={onClose} className="anim-fade absolute inset-0 bg-[var(--scrim)]" />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={onKeyDown}
        className="anim-sheet relative max-h-[86dvh] w-full max-w-[480px] overflow-y-auto rounded-t-2xl bg-paper px-4 pb-[calc(20px+env(safe-area-inset-bottom))] pt-2"
      >
        <div aria-hidden="true" className="mx-auto mb-2 h-1 w-9 rounded-full bg-[var(--grab)]" />
        <div className="mb-1 flex h-10 items-center justify-between px-1">
          <h2 id={titleId} className="text-[18px] font-bold leading-6 tracking-[-0.02em]">
            {title}
          </h2>
          <button type="button" onClick={onClose} aria-label="닫기" className="grid size-8 place-items-center rounded-sm text-ink-2 hover:bg-hover hover:text-ink">
            <IconClose size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

function Popover({ onClose, trigger, title, width, children }: InnerProps & { width: number }) {
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const onKeyDown = usePanelKeys(panel, onClose);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useReturnFocus(trigger);

  // 트리거 아래, 자리가 없으면 위. 좌우는 화면 안으로
  useLayoutEffect(() => {
    const place = () => {
      const a = trigger.current?.getBoundingClientRect();
      const h = panel.current?.offsetHeight ?? 0;
      if (!a) return;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const left = Math.max(MARGIN, Math.min(a.left, vw - MARGIN - width));
      let top = a.bottom + GAP;
      if (top + h > vh - MARGIN) top = Math.max(MARGIN, a.top - GAP - h);
      setPos({ left, top });
    };
    place();
    const ro = new ResizeObserver(place);
    if (panel.current) ro.observe(panel.current);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [trigger, width]);

  // 피커와 트리거 밖을 누르면 닫는다
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (panel.current?.contains(t) || trigger.current?.contains(t)) return;
      onClose();
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [onClose, trigger]);

  return (
    <div
      ref={panel}
      role="dialog"
      aria-labelledby={titleId}
      onKeyDown={onKeyDown}
      style={{ left: pos?.left ?? -9999, top: pos?.top ?? 0, width, boxShadow: "var(--pop-shadow)" }}
      className={`fixed z-50 rounded-xl border border-line bg-paper p-2.5 ${pos ? "anim-fade" : "opacity-0"}`}
    >
      <h2 id={titleId} className="sr-only">
        {title}
      </h2>
      {children}
    </div>
  );
}

/** 피커 트리거 버튼 모양 (기존 inputClass 와 같은 면, 높이) */
export const triggerClass =
  "flex min-h-11 w-full items-center justify-between gap-2 rounded-sm bg-surface px-3 text-left text-[14px] font-medium text-ink tabular-nums focus:outline-2 focus:outline-ink focus:outline-offset-0 disabled:opacity-60";
