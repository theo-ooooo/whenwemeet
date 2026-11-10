"use client";
import { forwardRef, useEffect, useId, useRef } from "react";
import { IconClose } from "./icons";
import { memberColor } from "@/lib/colors";
import type { Member } from "@/lib/types";

/* ---------- 버튼 ---------- */

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "tile" | "ghost" | "danger" | "dangerFill";
  size?: "lg" | "md" | "sm";
  loading?: boolean;
  full?: boolean;
};

// 버튼 (D-57): 주 버튼만 코랄 면(--btn, 흰 글자 4.9:1), 보조는 --hover 면, 위험은 면 위 --danger 글자. 알약 대신 모서리 12(작은 버튼 10)
const variantClass: Record<NonNullable<ButtonProps["variant"]>, string> = {
  primary: "bg-btn text-on-btn hover:brightness-95 disabled:bg-line disabled:text-ink-2 disabled:opacity-100",
  secondary: "bg-hover text-ink hover:brightness-95 disabled:text-ink-2",
  tile: "bg-paper text-ink hover:brightness-95 disabled:text-ink-2",
  ghost: "bg-transparent text-ink hover:bg-hover disabled:text-ink-2",
  danger: "bg-hover text-danger hover:brightness-95 disabled:text-ink-2",
  // 되돌릴 수 없는 마지막 확인(회원 탈퇴, 삭제 확인 창). 비활성은 주 버튼과 같은 회색 (#134)
  dangerFill: "bg-danger text-on-btn hover:brightness-95 disabled:bg-line disabled:text-ink-2",
};
const sizeClass: Record<NonNullable<ButtonProps["size"]>, string> = {
  lg: "h-11 rounded-md px-5 text-[13.5px] font-bold",
  md: "h-11 rounded-md px-4 text-[13.5px] font-bold",
  sm: "hit h-8 rounded-sm px-3 text-[13px] font-bold",
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
      className={`inline-flex items-center justify-center gap-1.5 leading-5 whitespace-nowrap transition-[filter,opacity,background-color] disabled:cursor-not-allowed ${variantClass[variant]} ${sizeClass[size]} ${full ? "w-full" : ""} ${className}`}
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
  "w-full min-h-11 rounded-sm border-0 bg-surface px-3.5 py-3 text-[14px] leading-5 font-normal text-ink placeholder:text-ink-2 focus:outline-2 focus:outline-ink focus:outline-offset-0 disabled:opacity-60";

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
      <label htmlFor={id} className="mb-1.5 block text-[12px] font-medium leading-4 text-ink-2">
        {label}
      </label>
      {children(id, describedBy)}
      {hint && !error && (
        <p id={hintId} className="t-sub mt-1.5">
          {hint}
        </p>
      )}
      {error && (
        <p id={errId} role="alert" className="mt-1.5 text-[12px] leading-4 text-danger">
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
      className="flex min-h-11 w-full items-center justify-between gap-4 rounded-sm py-1 text-left"
    >
      <span>
        <span className="block text-[14px] font-semibold">{label}</span>
        {description && <span className="t-sub block">{description}</span>}
      </span>
      <span
        aria-hidden="true"
        className={`anim-pick relative inline-block h-6 w-10 shrink-0 rounded-full ${checked ? "bg-pri" : "bg-faint"}`}
      >
        <span
          className={`absolute top-0.5 size-5 rounded-full bg-paper transition-transform duration-120 ${checked ? "translate-x-[18px]" : "translate-x-0.5"}`}
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
      className={`anim-pick hit h-8 shrink-0 rounded-sm px-3 text-[13px] ${selected ? "border-[1.5px] border-acc-ink font-bold text-acc-ink" : "border border-line font-medium text-soft hover:text-ink"}`}
    >
      {children}
    </button>
  );
}

/* ---------- 세그먼트 ---------- */

/** 2~4개 중 하나 고르기 (내 정보 테마, 기념일 종류). 선택 칸은 --seg-on 면 + --seg-edge 테두리 (#135) */
export function Segmented<T extends string>({
  labelledBy,
  value,
  options,
  onChange,
}: {
  labelledBy: string;
  value: T;
  options: { value: T; label: string; icon?: React.ReactNode }[];
  onChange: (v: T) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-labelledby={labelledBy}
      className="grid gap-1 rounded-sm bg-surface p-1"
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {options.map((o) => {
        const on = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.value)}
            className={`anim-pick hit flex h-9 items-center justify-center gap-1.5 rounded-[8px] border px-1 text-[13px] whitespace-nowrap ${
              on
                ? "border-[var(--seg-edge)] bg-[var(--seg-on)] font-bold text-ink shadow-[0_1px_2px_rgba(0,0,0,0.08)]"
                : "border-transparent font-medium text-soft hover:text-ink"
            }`}
          >
            {o.icon}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/* ---------- 스켈레톤 ---------- */

export function Skeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden="true" className={`skeleton ${className}`} />;
}

export function SkeletonList({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-2" aria-busy="true" aria-label="불러오는 중">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex min-h-11 items-center gap-2.5 rounded-xl bg-paper px-3.5 py-2">
          <Skeleton className="h-8 w-[3px] rounded-[2px]" />
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

/** 멤버 색 표시. 기본은 점(원). 서버 색을 화면 색으로 바꿔 칠한다 */
export function MemberDot({ color, size = 8, className = "", round = true }: { color: string; size?: number; className?: string; round?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block shrink-0 ${className}`}
      style={{ width: size, height: size, backgroundColor: memberColor(color), borderRadius: round ? "50%" : Math.max(2, Math.round(size / 3)) }}
    />
  );
}

/** 프로필: 사진이 있으면 사진, 없으면 먹색 원에 이름 첫 글자 (기본 28) */
export function Avatar({ member, size = 28 }: { member: Pick<Member, "displayName" | "profileImageUrl">; size?: number }) {
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
      style={{ width: size, height: size, fontSize: Math.round(size * 0.43), fontWeight: 700 }}
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
        className="anim-fade absolute inset-0 bg-[var(--scrim)]"
        tabIndex={-1}
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="anim-sheet relative w-full fold:max-w-[480px] rounded-t-2xl bg-paper px-4 pb-[calc(24px+env(safe-area-inset-bottom))] pt-2 outline-none lg:max-w-[400px] lg:rounded-lg lg:border lg:border-line lg:pb-5 lg:pt-3 lg:shadow-[var(--pop-shadow)]"
      >
        <div aria-hidden="true" className="mx-auto mb-2 h-1 w-9 rounded-full bg-[var(--grab)] lg:hidden" />
        <div className="mb-2 flex h-10 items-center justify-between">
          <h2 id={titleId} className="text-[18px] font-bold leading-6 tracking-[-0.02em]">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="hit grid size-8 place-items-center rounded-sm text-ink-2 hover:bg-hover hover:text-ink"
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
          <Button variant={danger ? "dangerFill" : "primary"} full onClick={onConfirm} loading={loading}>
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
    <p className="rounded-xl bg-paper px-4 py-6 text-center text-[14px] leading-5 text-ink-2">{children}</p>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center gap-3 rounded-xl bg-paper px-4 py-6 text-center">
      <p className="text-[14px] leading-5 text-ink">{message}</p>
      {onRetry && (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          다시 시도
        </Button>
      )}
    </div>
  );
}
