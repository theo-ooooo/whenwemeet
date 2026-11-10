"use client";
import { SocialLoginButton } from "./SocialLoginButton";

/**
 * 애플 로그인 버튼 (웹, 앱.md 3.4). Apple 가이드: 검정(다크 모드는 흰색) 바탕, 반대색 글자, 로고 왼쪽.
 * 색은 먹(ink) 바탕 + 바탕(surface) 글자 토큰이라 테마에 따라 뒤집힌다. 크기와 모양은 카카오 버튼과 같은 SocialLoginButton
 */
export function AppleButton({ next, label = "Apple로 계속하기" }: { next: string; label?: string }) {
  return (
    <SocialLoginButton
      href={`/auth/apple?next=${encodeURIComponent(next)}`}
      next={next}
      label={label}
      goingLabel="Apple로 이동 중…"
      colorClass="bg-ink text-surface"
      icon={
        <svg width="17" height="20" viewBox="0 0 17 20" fill="currentColor">
          <path d="M14.04 10.62c-.02-2.2 1.8-3.26 1.88-3.31-1.03-1.5-2.62-1.7-3.18-1.73-1.35-.14-2.64.8-3.33.8-.69 0-1.74-.78-2.86-.76-1.47.02-2.83.86-3.59 2.17-1.53 2.66-.39 6.59 1.1 8.74.73 1.05 1.6 2.24 2.73 2.2 1.1-.04 1.51-.71 2.84-.71 1.32 0 1.7.71 2.85.69 1.18-.02 1.93-1.07 2.65-2.13.84-1.22 1.18-2.4 1.2-2.46-.03-.01-2.3-.88-2.32-3.5zM11.86 4.17c.6-.73 1.01-1.75.9-2.76-.87.04-1.92.58-2.54 1.31-.56.65-1.05 1.68-.92 2.67.97.08 1.96-.49 2.56-1.22z" />
        </svg>
      }
    />
  );
}
