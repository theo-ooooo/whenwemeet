"use client";
import { useCallback } from "react";
import { api } from "@/lib/api";
import { useMutation, type MutationOptions } from "./_useMutation";

/** 회원 탈퇴 DELETE /me (카카오 연결 해제 포함). 세션 쿠키는 /auth/logout 으로 따로 지운다 */
export function useDeleteMe(opts?: MutationOptions) {
  const fn = useCallback(() => api<void>("/me", { method: "DELETE" }), []);
  return useMutation<void, void>(fn, opts);
}
