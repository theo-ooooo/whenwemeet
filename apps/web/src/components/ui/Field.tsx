"use client";
import { useId } from "react";

/* ---------- 입력 ---------- */

export const inputClass =
  "w-full min-h-11 rounded-sm border-0 bg-surface px-3.5 py-3 text-[14px] leading-5 font-normal text-ink placeholder:text-ink-2 focus:outline-2 focus:outline-ink focus:outline-offset-0 disabled:opacity-60";

/** 입력 위 작은 이름 12/500 (시작, 종료, 기념일 종류 등). Field 의 label 과 같은 모양 */
export const captionClass = "mb-1.5 block text-[12px] font-medium leading-4 text-ink-2";

/** 입력 아래 오류 한 줄 12 `--danger` (role=alert). 여백은 자리마다 className 으로 */
export function InlineError({ id, className = "", children }: { id?: string; className?: string; children: React.ReactNode }) {
  return (
    <p id={id} role="alert" className={`text-[12px] text-danger ${className}`}>
      {children}
    </p>
  );
}

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
      <label htmlFor={id} className={captionClass}>
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
