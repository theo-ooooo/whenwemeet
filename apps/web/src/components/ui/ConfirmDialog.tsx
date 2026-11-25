"use client";
import { useEffect, useId, useRef } from "react";
import { Button } from "./Button";
import { useEscape } from "./useEscape";

export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  cancelLabel = "취소",
  danger = false,
  neutral = false,
  loading = false,
  confirmDisabled = false,
  onConfirm,
  onCancel,
  children,
}: {
  open: boolean;
  title: string;
  body?: string;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
  /** 위험은 아니지만 주 버튼(코랄) 대신 먹색으로 (#174 L10) */
  neutral?: boolean;
  loading?: boolean;
  /** (#515) 입력이 모자랄 때 확인 버튼을 끈다 (사유, 이름 확인) */
  confirmDisabled?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  children?: React.ReactNode;
}) {
  useEscape(open, onCancel);
  const titleId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (open) cancelRef.current?.focus();
  }, [open]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-6">
      <button type="button" aria-label="닫기" onClick={onCancel} className="anim-fade absolute inset-0 bg-[var(--scrim)]" tabIndex={-1} />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="anim-sheet relative w-full max-w-[320px] rounded-lg bg-paper p-5"
      >
        <h2 id={titleId} className="text-[18px] font-bold leading-6 tracking-[-0.02em]">
          {title}
        </h2>
        {body && <p className="mt-1.5 text-[14px] leading-5 text-soft">{body}</p>}
        {children}
        <div className="mt-4 flex gap-2">
          <Button ref={cancelRef} variant="secondary" full onClick={onCancel} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button variant={danger ? "dangerFill" : neutral ? "ink" : "primary"} full onClick={onConfirm} loading={loading} disabled={confirmDisabled}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
