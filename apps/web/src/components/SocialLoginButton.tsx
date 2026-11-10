"use client";
// 카카오, 애플 로그인 버튼의 공통 틀. 크기(높이 48, 폭 100%), 모서리 12, 글자 15/700, 아이콘 20 칸, 간격 8 을 한곳에서 정해
// 두 버튼이 화면마다 다르게 보이지 않게 한다 (/login, /join/<코드>). 색만 버튼마다 넘긴다
import { useState } from "react";
import { postToApp } from "@/lib/app-bridge";

export function SocialLoginButton({
  href,
  next,
  label,
  goingLabel,
  colorClass,
  icon,
}: {
  href: string;
  next: string;
  label: string;
  goingLabel: string;
  /** 바탕, 글자 색 (예: "bg-kakao text-kakao-ink") */
  colorClass: string;
  icon: React.ReactNode;
}) {
  const [going, setGoing] = useState(false);
  return (
    <a
      href={href}
      aria-disabled={going || undefined}
      data-social-login
      onClick={(e) => {
        if (going) {
          e.preventDefault();
          return;
        }
        // 앱 안이면 웹 로그인 대신 네이티브 로그인 화면 (앱.md 4.3). 셸이 없으면 기존처럼 이동
        if (postToApp({ type: "login", next })) {
          e.preventDefault();
          return;
        }
        setGoing(true);
      }}
      className={`flex h-12 w-full items-center justify-center gap-2 rounded-md px-4 text-[15px] font-bold leading-5 ${colorClass} ${going ? "pointer-events-none opacity-70" : "hover:brightness-95"}`}
    >
      <span aria-hidden="true" className="grid size-5 shrink-0 place-items-center">
        {icon}
      </span>
      <span className="truncate">{going ? goingLabel : label}</span>
    </a>
  );
}
