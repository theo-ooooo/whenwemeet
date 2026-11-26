"use client";
import { forwardRef } from "react";

/* ---------- 버튼 ---------- */

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "tile" | "ghost" | "danger" | "dangerFill" | "outline" | "ink" | "kakao";
  size?: "xl" | "lg" | "md" | "sm";
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
  // 페이지 바탕(--bg) 위 보조 버튼. --hover 면은 라이트에서 바탕과 같은 색이라 안 보이므로 타일 면 + 1px 선 (#166)
  outline: "border border-line bg-paper text-ink hover:brightness-95 disabled:text-ink-2",
  // 되돌릴 수 있지만 무게가 있는 확인(코드 재발급). 위험 빨강과 헷갈리지 않게 먹색 면 (#174 L10)
  ink: "bg-ink text-paper hover:brightness-110 disabled:bg-line disabled:text-ink-2",
  // (#195) 카카오톡 공유. 카카오 디자인 가이드 색 그대로(#FEE500, 글자 #000 85%), 색 변경 금지
  kakao: "bg-kakao text-kakao-ink hover:brightness-95 disabled:opacity-70",
};
const sizeClass: Record<NonNullable<ButtonProps["size"]>, string> = {
  // 카카오, 애플 버튼(SocialLoginButton)과 같은 줄에 쌓이는 버튼: 48, 모서리 12, 15/700 (#166)
  xl: "h-12 rounded-md px-5 text-[15px] font-bold",
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
  return <span aria-hidden="true" className={`inline-block size-4 animate-spin rounded-full border-2 border-current border-t-transparent ${className}`} />;
}
