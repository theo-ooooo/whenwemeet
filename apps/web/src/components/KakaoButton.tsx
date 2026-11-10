"use client";
import { SocialLoginButton } from "./SocialLoginButton";

/** 카카오 로그인 버튼. 카카오 디자인 가이드: 배경 #FEE500, 심볼 #000000, 글자 #000000 85%, 심볼 왼쪽. 색 변경 금지.
 *  크기는 SocialLoginButton. 앱 네이티브 로그인 화면(apps/mobile LoginScreen)과 같은 값 (#145) */
export function KakaoButton({ next, label = "카카오로 계속하기" }: { next: string; label?: string }) {
  return (
    <SocialLoginButton
      href={`/auth/kakao?next=${encodeURIComponent(next)}`}
      next={next}
      label={label}
      goingLabel="카카오로 이동 중…"
      colorClass="bg-kakao text-kakao-ink"
      icon={
        <svg width="20" height="20" viewBox="0 0 24 24">
          <path
            fill="#000000"
            d="M12 3C6.48 3 2 6.58 2 10.9c0 2.78 1.84 5.22 4.62 6.6l-.94 3.48c-.08.3.26.54.52.37l4.15-2.76c.54.07 1.09.11 1.65.11 5.52 0 10-3.58 10-7.9S17.52 3 12 3z"
          />
        </svg>
      }
    />
  );
}
