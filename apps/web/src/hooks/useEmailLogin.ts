"use client";
// (#245) 이메일 로그인 변경 훅 (이메일-로그인.md 6-1). 화면은 이 훅만 쓴다.
// 성공 뒤 화면 이동이 따라오는 코드, 가입은 이동 중 재클릭을 막으려고 isPending 을 유지한다
import { useCallback } from "react";
import { authEmailPost } from "@/lib/api";
import { useMutation } from "./_useMutation";

export type EmailRequestResult = { cooldownSec?: number; expiresInSec?: number };

/** 로그인 메일 보내기 (처음, 다시 보내기) */
export function useRequestEmailLogin() {
  const fn = useCallback((input: { email: string; next: string }) => authEmailPost<EmailRequestResult>("request", input), []);
  return useMutation(fn);
}

/** 6자리 코드로 로그인. 결과의 redirect 로 이동한다 */
export function useVerifyEmailCode() {
  const fn = useCallback((input: { email: string; code: string }) => authEmailPost<{ redirect: string }>("code", input), []);
  return useMutation(fn, { keepPendingAfterSuccess: true });
}

/** 처음 가입 닉네임 제출 */
export function useEmailSignup() {
  const fn = useCallback((nickname: string) => authEmailPost<{ redirect: string }>("signup", { nickname }), []);
  return useMutation(fn, { keepPendingAfterSuccess: true });
}
