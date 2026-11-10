"use client";
import { forwardRef, useEffect, useId, useRef } from "react";
import { IconClose } from "./icons";
import { memberColor } from "@/lib/colors";
import type { Member } from "@/lib/types";

/* ---------- 버튼 ---------- */

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "tile" | "ghost" | "danger" | "accent";
  size?: "lg" | "md" | "sm";
  loading?: boolean;
  full?: boolean;
};

// 알약 버튼. 주 버튼은 코랄(#46, 흰 글자 4.5:1 이상인 --btn), 보조는 바탕색, 위험은 바탕색 위 빨간 글자
const variantClass: Record<NonNullable<ButtonProps["variant"]>, string> = {
  primary: "bg-btn text-on-btn hover:brightness-95 disabled:bg-line disabled:text-ink-2 disabled:opacity-100",
  secondary: "bg-surface text-ink hover:brightness-95 disabled:text-ink-2",
  tile: "bg-paper text-ink hover:brightness-95 disabled:text-ink-2",
  ghost: "bg-transparent text-ink hover:bg-surface disabled:text-ink-2",
  danger: "bg-surface text-danger hover:brightness-95 disabled:text-ink-2",
  accent: "bg-brand text-white hover:brightness-95 disabled:bg-line disabled:text-ink-2",
};
const sizeClass: Record<NonNullable<ButtonProps["size"]>, string> = {
  lg: "h-[52px] px-6 text-[15px] font-bold",
  md: "h-11 px-5 text-[14px] font-bold",
  sm: "h-9 px-4 text-[13px] font-bold",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", loading = false, full = false, className = "", children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`inline-flex items-center justify-center gap-2 rounded-full tracking-[-0.02em] whitespace-nowrap transition-[filter,opacity,background-color] disabled:cursor-not-allowed ${variantClass[variant]} ${sizeClass[size]} ${full ? "w-full" : ""} ${className}`}
      {...rest}
    >
      {loading && <Spinner />}
      {children}
    </button>
  );
});

export function Spinner({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block size-4 animate-spin rounded-full border-2 border-current border-t-transparent ${className}`}
    />
  );
}

/* ---------- 입력 ---------- */

export const inputClass =
  "w-full rounded-sm border-0 bg-surface px-4 py-3 text-[15px] font-semibold text-ink placeholder:font-medium placeholder:text-ink-2 focus:outline-2 focus:outline-ink focus:outline-offset-0 disabled:opacity-60";

type FieldProps = {
  label: string;
  hint?: string;
  error?: string | null;
  children: (id: string, describedBy: string | undefined) => React.ReactNode;
};

export function Field({ label, hint, error, children }: FieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errId = `${id}-err`;
  const describedBy = [hint ? hintId : null, error ? errId : null].filter(Boolean).join(" ") || undefined;
  return (
    <div>
      <label htmlFor={id} className="mb-2 block text-[12px] font-semibold text-ink-2">
        {label}
      </label>
      {children(id, describedBy)}
      {hint && !error && (
        <p id={hintId} className="t-sub mt-1.5">
          {hint}
        </p>
      )}
      {error && (
        <p id={errId} role="alert" className="mt-1.5 text-[13px] text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

/* ---------- 토글 ---------- */

export function Toggle({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  description?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between gap-4 rounded-sm py-1 text-left"
    >
      <span>
        <span className="block text-[15px] font-bold tracking-[-0.02em]">{label}</span>
        {description && <span className="t-sub block">{description}</span>}
      </span>
      <span
        aria-hidden="true"
        className={`anim-pick relative inline-block h-7 w-12 shrink-0 rounded-full ${checked ? "bg-pri" : "bg-faint"}`}
      >
        <span
          className={`absolute top-0.5 size-6 rounded-full bg-paper transition-transform duration-120 ${checked ? "translate-x-[22px]" : "translate-x-0.5"}`}
        />
      </span>
    </button>
  );
}

/* ---------- 칩 ---------- */

export function Chip({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={`anim-pick h-9 shrink-0 rounded-full px-3.5 text-[13px] font-bold ${selected ? "bg-today text-sel-ink" : "border-[1.5px] border-line text-soft hover:text-ink"}`}
    >
      {children}
    </button>
  );
}

/* ---------- 스켈레톤 ---------- */

export function Skeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden="true" className={`skeleton ${className}`} />;
}

export function SkeletonList({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="불러오는 중">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3 rounded-xl bg-paper px-4 py-3.5">
          <Skeleton className="size-3 rounded-[4px]" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-3 w-1/3" />
          </div>
        </div>
      ))}
    </div>
  );
}

/* ---------- 멤버 표시 ---------- */

/** 멤버 색 표시. 목업처럼 둥근 사각(모서리 = 크기의 1/3). 서버 색을 화면 색으로 바꿔 칠한다 */
export function MemberDot({ color, size = 8, className = "", round = false }: { color: string; size?: number; className?: string; round?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block shrink-0 ${className}`}
      style={{ width: size, height: size, backgroundColor: memberColor(color), borderRadius: round ? "50%" : Math.max(2, Math.round(size / 3)) }}
    />
  );
}

/** 프로필: 사진이 있으면 사진, 없으면 먹색 원에 이름 첫 글자 (목업 .av) */
export function Avatar({ member, size = 32 }: { member: Pick<Member, "displayName" | "profileImageUrl">; size?: number }) {
  const initial = member.displayName.trim().slice(0, 1) || "?";
  if (member.profileImageUrl) {
    return (
      // 외부(카카오) 이미지라 next/image 도메인 설정 대신 img 를 쓴다
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={member.profileImageUrl}
        alt=""
        width={size}
        height={size}
        className="shrink-0 rounded-full object-cover"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className="inline-grid shrink-0 place-items-center rounded-full bg-ink text-surface"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.36), fontWeight: 700 }}
    >
      {initial}
    </span>
  );
}

/* ---------- 시트 / 다이얼로그 ---------- */

function useEscape(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);
}

export function Sheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
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
        className="anim-fade absolute inset-0 bg-black/35"
        tabIndex={-1}
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="anim-sheet relative w-full max-w-[480px] rounded-t-2xl bg-paper px-[22px] pb-[calc(34px+env(safe-area-inset-bottom))] pt-3 outline-none lg:rounded-2xl lg:pb-8 lg:pt-6"
      >
        <div aria-hidden="true" className="mx-auto mb-[18px] h-[5px] w-10 rounded-full bg-[var(--grab)] lg:hidden" />
        <div className="mb-4 flex items-center justify-between">
          <h2 id={titleId} className="text-[22px] font-extrabold tracking-[-0.04em]">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="grid size-9 place-items-center rounded-full bg-surface text-ink hover:brightness-95"
          >
            <IconClose size={18} />
          </button>
        </div>
        <div className="max-h-[70dvh] overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  cancelLabel = "취소",
  danger = false,
  loading = false,
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
  loading?: boolean;
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
      <button type="button" aria-label="닫기" onClick={onCancel} className="anim-fade absolute inset-0 bg-black/35" tabIndex={-1} />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="anim-sheet relative w-full max-w-[360px] rounded-xl bg-paper p-6"
      >
        <h2 id={titleId} className="text-[20px] font-extrabold leading-snug tracking-[-0.03em]">
          {title}
        </h2>
        {body && <p className="mt-2 text-[14px] leading-relaxed text-soft">{body}</p>}
        {children}
        <div className="mt-5 flex gap-2">
          <Button ref={cancelRef} variant="secondary" full onClick={onCancel} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button
            variant={danger ? "danger" : "primary"}
            full
            onClick={onConfirm}
            loading={loading}
            className={danger ? "bg-danger! text-white!" : ""}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ---------- 상태 블록 ---------- */

export function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-xl bg-paper px-5 py-8 text-center text-[14px] font-semibold leading-relaxed text-ink-2">{children}</p>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center gap-3 rounded-xl bg-paper px-5 py-8 text-center">
      <p className="text-[14px] font-semibold text-ink">{message}</p>
      {onRetry && (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          다시 시도
        </Button>
      )}
    </div>
  );
}
