"use client";
// (#198) 내 정보 > 로그인 방법 (D-257). 화면은 이 훅만 쓴다
import { useCallback } from "react";
import type { AppLinkCredentials, AppLinkProvider } from "@/lib/account-link";
import { api } from "@/lib/api";
import type { AuthAccount, LinkResult } from "@/lib/types";
import { useMutation } from "./_useMutation";
import { useQuery, type QueryOptions } from "./_useQuery";

/** GET /me/auth-accounts */
export function useAuthAccounts(opts?: QueryOptions<AuthAccount[]>) {
  return useQuery<AuthAccount[]>("/me/auth-accounts", opts);
}

/** 이메일 연결 코드 메일 (POST /auth/email/request purpose LINK, 세션 필요) */
export function useRequestLinkEmail() {
  const fn = useCallback(
    (email: string) => api<{ cooldownSec?: number; expiresInSec?: number }>("/auth/email/request", { method: "POST", body: { email, purpose: "LINK" } }),
    [],
  );
  return useMutation(fn);
}

/** 이메일 코드로 연결 (POST /me/auth-accounts { provider: EMAIL, email, code }) */
export function useLinkEmail() {
  const fn = useCallback(
    (input: { email: string; code: string }) => api<LinkResult>("/me/auth-accounts", { method: "POST", body: { provider: "EMAIL", ...input } }),
    [],
  );
  return useMutation(fn);
}

/**
 * (#198) 앱 연결 앞 확인 (POST /me/auth-accounts/link-start). 최근 로그인(REAUTH_REQUIRED), 이미 연결, 제공자 미설정을
 * 네이티브 로그인 시트를 띄우기 전에 걸러 낸다. 돌려받는 시작 표식은 웹 OAuth 용이라 쓰지 않는다
 */
export function useCheckAppLink() {
  const fn = useCallback(
    (provider: AppLinkProvider) => api<{ intent: string; expiresIn: number }>("/me/auth-accounts/link-start", { method: "POST", body: { provider } }),
    [],
  );
  return useMutation(fn);
}

/** (#198) 앱 셸이 돌려준 네이티브 로그인 결과로 연결 (POST /me/auth-accounts { provider: KAKAO, accessToken } | { provider: APPLE, identityToken, authorizationCode, nonce }) */
export function useLinkAppAccount() {
  const fn = useCallback(
    (input: AppLinkCredentials) => api<LinkResult>("/me/auth-accounts", { method: "POST", body: { provider: input.provider, ...input.credentials } }),
    [],
  );
  return useMutation(fn);
}

/** 해제 (DELETE /me/auth-accounts/:id) */
export function useUnlinkAccount() {
  const fn = useCallback((id: number) => api<{ ok: true }>(`/me/auth-accounts/${id}`, { method: "DELETE" }), []);
  return useMutation(fn);
}
