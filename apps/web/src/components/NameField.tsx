"use client";
// (#378) 입력 화면의 이름 칸 하나 (디자인규칙.md 8-0 규칙 6, 입력 화면 통일안 규칙 1, 2).
// 카드(RowGroup) 맨 위 큰 칸 17/700. 위에 "이름" 글자를 따로 달지 않고(읽기 이름은 sr-only label) 칸 안 안내 글로 대신한다.
// 글자 수(12/30)는 상한의 80% 를 넘을 때만 칸 오른쪽에 보인다(lib/chars nearLimit). 오류는 칸 아래 한 줄
import { useId } from "react";
import { InlineError } from "./ui";
import { charCount, nearLimit } from "@/lib/chars";

type Props = Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "maxLength" | "className"> & {
  /** 읽기 이름 (sr-only label). 예: "제목", "기념일 이름" */
  label: string;
  value: string;
  onChange: (v: string) => void;
  /** 글자 상한(코드포인트). 주면 80% 부터 "n/max" 를 보인다. input maxLength 는 limitInput 일 때만 건다 */
  max?: number;
  /** maxLength 를 input 에 건다 (기존 폼이 막던 칸만) */
  limitInput?: boolean;
  error?: string | null;
  /** 오류 줄 id (부르는 쪽이 aria 로 가리켜야 할 때) */
  errorId?: string;
};

export function NameField({ label, value, onChange, max, limitInput = false, error, errorId, id, ...rest }: Props) {
  const auto = useId();
  const inputId = id ?? `${auto}-name`;
  const countId = `${auto}-count`;
  const errId = errorId ?? `${auto}-err`;
  const count = charCount(value.trim());
  const showCount = max !== undefined && nearLimit(count, max);
  const describedBy = [rest["aria-describedby"], showCount ? countId : null, error ? errId : null].filter(Boolean).join(" ") || undefined;
  return (
    <div className="py-1">
      <label htmlFor={inputId} className="sr-only">
        {label}
      </label>
      <div className="flex items-center gap-2">
        <input
          {...rest}
          id={inputId}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          maxLength={limitInput ? max : undefined}
          aria-invalid={rest["aria-invalid"] ?? (error ? true : undefined)}
          aria-describedby={describedBy}
          className="-mx-1.5 min-h-12 min-w-0 flex-1 rounded-sm bg-transparent px-1.5 text-[17px] font-bold leading-6 tracking-[-0.01em] text-ink placeholder:font-bold placeholder:text-ink-2 focus:outline-2 focus:outline-ink focus:outline-offset-0"
        />
        {showCount && (
          <span id={countId} className={`shrink-0 text-[12px] tabular-nums ${count > (max ?? 0) ? "font-bold text-danger" : "text-ink-2"}`}>
            {count}/{max}
          </span>
        )}
      </div>
      {error && (
        <InlineError id={errId} className="pb-1.5">
          {error}
        </InlineError>
      )}
    </div>
  );
}
