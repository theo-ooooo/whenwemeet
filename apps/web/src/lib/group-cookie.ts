"use client";
// 마지막으로 본 팀을 기억하는 쿠키 (민감정보 아님, JS 에서 읽고 쓴다)
import { GROUP_COOKIE, GROUP_MAX_AGE } from "./auth";

export function rememberGroup(groupId: string) {
  if (typeof document === "undefined") return;
  document.cookie = `${GROUP_COOKIE}=${encodeURIComponent(groupId)}; Path=/; Max-Age=${GROUP_MAX_AGE}; SameSite=Lax`;
}

export function forgetGroup() {
  if (typeof document === "undefined") return;
  document.cookie = `${GROUP_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
}
