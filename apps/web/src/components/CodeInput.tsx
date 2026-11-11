"use client";
// 초대 코드 6칸 입력 (#56). 실제 입력은 칸 위에 겹친 투명 input 하나라 붙여넣기, 지우기, 화면 읽기 프로그램이 그대로 동작한다.
// 소문자는 대문자로, 글자/숫자 외는 버린다. 초대 링크 전체를 붙여넣어도 /join/ 뒤 코드만 남긴다.
// (#245) kind="otp" 는 이메일 로그인 6자리 코드: 숫자만, 숫자 키패드, 메일 코드 자동 채움, 링크 해석 없음 (이메일-로그인.md 6-3)
import { useState } from "react";
import { normalizeOtp } from "@/lib/email-login";

export const CODE_LENGTH = 6;

/** 입력값을 코드 모양으로: 링크면 /join/ 뒤만, 대문자, 영문/숫자만, 6자까지 */
export function normalizeCode(raw: string): string {
  const fromLink = /\/join\/([A-Za-z0-9]+)/.exec(raw);
  const s = fromLink ? fromLink[1] : raw;
  return s.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, CODE_LENGTH);
}

type Props = {
  id: string;
  value: string;
  onChange: (code: string) => void;
  describedBy?: string;
  invalid?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
  /** invite: 초대 코드(영문, 숫자) / otp: 로그인 코드(숫자) */
  kind?: "invite" | "otp";
  inputRef?: React.Ref<HTMLInputElement>;
  /** 화면 읽기 프로그램용 이름 (라벨 요소가 없을 때) */
  ariaLabel?: string;
};

export function CodeInput({ id, value, onChange, describedBy, invalid, disabled, autoFocus, kind = "invite", inputRef, ariaLabel }: Props) {
  const otp = kind === "otp";
  const [focused, setFocused] = useState(false);
  const cells = Array.from({ length: CODE_LENGTH }, (_, i) => value[i] ?? "");
  // 다음에 채울 칸 (다 찼으면 마지막 칸)
  const active = Math.min(value.length, CODE_LENGTH - 1);

  return (
    <div className="relative">
      <div aria-hidden="true" className="grid grid-cols-6 gap-2">
        {cells.map((ch, i) => {
          const on = focused && i === active;
          return (
            <span
              key={i}
              className={`grid h-12 place-items-center rounded-sm bg-surface text-[22px] font-bold transition-[box-shadow] ${
                invalid ? "shadow-[inset_0_0_0_1.5px_var(--holiday)]" : on ? "shadow-[inset_0_0_0_2px_var(--ink)]" : ""
              } ${disabled ? "opacity-60" : ""}`}
            >
              {ch || (on ? <span className="h-6 w-[2px] animate-pulse rounded-full bg-ink" /> : "")}
            </span>
          );
        })}
      </div>
      <input
        ref={inputRef}
        id={id}
        value={value}
        onChange={(e) => onChange(otp ? normalizeOtp(e.target.value) : normalizeCode(e.target.value))}
        aria-label={ariaLabel}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        aria-describedby={describedBy}
        aria-invalid={invalid || undefined}
        disabled={disabled}
        autoFocus={autoFocus}
        // 링크 전체를 붙여넣을 수 있게 길이 제한은 normalizeCode, normalizeOtp 가 한다
        inputMode={otp ? "numeric" : "text"}
        pattern={otp ? "[0-9]*" : undefined}
        autoCapitalize={otp ? "off" : "characters"}
        autoComplete={otp ? "one-time-code" : "off"}
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="go"
        className="absolute inset-0 h-full w-full cursor-text rounded-sm bg-transparent text-transparent caret-transparent opacity-0 focus:outline-none"
      />
    </div>
  );
}
