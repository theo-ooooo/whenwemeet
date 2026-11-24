"use client";
import { memberColor } from "@/lib/colors";

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
