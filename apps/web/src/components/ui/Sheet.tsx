"use client";
import { useEffect, useId, useRef } from "react";
import { IconClose } from "../icons";
import { useEscape } from "./useEscape";

/* ---------- 시트 / 다이얼로그 ---------- */

/** 시트, 패널 머리 오른쪽 닫기 ✕ (32 칸, 누르는 영역 44 는 hit) */
export function CloseButton({ onClick, className = "" }: { onClick: () => void; className?: string }) {
  return (
    <button type="button" onClick={onClick} aria-label="닫기" className={`hit grid size-8 place-items-center rounded-sm text-ink-2 hover:bg-hover hover:text-ink ${className}`}>
      <IconClose size={18} />
    </button>
  );
}

/** 바텀 시트 머리: 제목 18/700 + 닫기. 아래 여백은 시트마다 다르다 (Sheet mb-2, 피커 mb-1) */
export function SheetHeader({ titleId, title, onClose, className = "mb-2" }: { titleId: string; title: string; onClose: () => void; className?: string }) {
  return (
    <div className={`flex h-10 items-center justify-between ${className}`}>
      <h2 id={titleId} className="text-[18px] font-bold leading-6 tracking-[-0.02em]">
        {title}
      </h2>
      <CloseButton onClick={onClose} />
    </div>
  );
}

export function Sheet({
  open,
  onClose,
  title,
  tone = "tile",
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  /** (#378) "bg" 면 시트 면을 바탕색으로 두고 안에 흰 카드(RowGroup)를 쌓는다 (입력 시트: 기념일, 목록, 투표, 생일) */
  tone?: "tile" | "bg";
  children: React.ReactNode;
}) {
  useEscape(open, onClose);
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => {
    if (open) panel.current?.focus();
  }, [open]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center lg:items-center">
      <button
        type="button"
        aria-label="닫기"
        onClick={onClose}
        className="anim-fade absolute inset-0 bg-[var(--scrim)]"
        tabIndex={-1}
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`anim-sheet relative w-full fold:max-w-[480px] rounded-t-2xl ${tone === "bg" ? "bg-surface" : "bg-paper"} px-4 pb-[calc(24px+var(--sab))] pt-2 outline-none lg:max-w-[400px] lg:rounded-lg lg:border lg:border-line lg:pb-5 lg:pt-3 lg:shadow-[var(--pop-shadow)]`}
      >
        <div aria-hidden="true" className="mx-auto mb-2 h-1 w-9 rounded-full bg-[var(--grab)] lg:hidden" />
        <SheetHeader titleId={titleId} title={title} onClose={onClose} />
        <div className="max-h-[70dvh] overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}
