"use client";
import { useState } from "react";

/** 카카오 로그인 버튼. 카카오 디자인 가이드: 배경 #FEE500, 글자 #191919, 심볼 왼쪽. 색 변경 금지 */
export function KakaoButton({ next, label = "카카오로 시작하기" }: { next: string; label?: string }) {
  const [going, setGoing] = useState(false);
  const href = `/auth/kakao?next=${encodeURIComponent(next)}`;
  return (
    <a
      href={href}
      aria-disabled={going || undefined}
      onClick={(e) => {
        if (going) {
          e.preventDefault();
          return;
        }
        setGoing(true);
      }}
      className={`flex h-13 w-full items-center justify-center gap-2.5 rounded-sm bg-kakao px-4 text-[16px] font-bold text-kakao-ink ${going ? "pointer-events-none opacity-70" : "hover:brightness-95"}`}
    >
      <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" className="shrink-0">
        <path
          fill="#191919"
          d="M12 3C6.48 3 2 6.58 2 10.9c0 2.78 1.84 5.22 4.62 6.6l-.94 3.48c-.08.3.26.54.52.37l4.15-2.76c.54.07 1.09.11 1.65.11 5.52 0 10-3.58 10-7.9S17.52 3 12 3z"
        />
      </svg>
      <span>{going ? "카카오로 이동 중…" : label}</span>
    </a>
  );
}
