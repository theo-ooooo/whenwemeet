"use client";
// 마지막으로 본 팀을 기억하는 쿠키 (민감정보 아님, JS 에서 읽고 쓴다)
import { GROUP_COOKIE, GROUP_MAX_AGE } from "./auth";

export function rememberGroup(groupId: number) {
  if (typeof document === "undefined") return;
  document.cookie = `${GROUP_COOKIE}=${groupId}; Path=/; Max-Age=${GROUP_MAX_AGE}; SameSite=Lax`;
}

/** 브라우저에 남은 마지막 팀 ID. 숫자가 아니거나 없으면 null (서버 컴포넌트는 next/headers cookies() 로 읽는다) */
export function readGroupCookie(): number | null {
  if (typeof document === "undefined") return null;
  const raw = document.cookie
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${GROUP_COOKIE}=`))
    ?.slice(GROUP_COOKIE.length + 1);
  return raw && /^[1-9]\d*$/.test(raw) ? Number(raw) : null;
}

export function forgetGroup() {
  if (typeof document === "undefined") return;
  document.cookie = `${GROUP_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
}
