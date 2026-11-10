"use client";
import { useCallback } from "react";
import { api } from "@/lib/api";
import { useMutation, type MutationOptions } from "./_useMutation";

/** 프로필 사진을 기본(이니셜) 으로 DELETE /me/avatar */
export function useDeleteAvatar(opts?: MutationOptions) {
  const fn = useCallback(() => api<{ profileImageUrl: null }>("/me/avatar", { method: "DELETE" }), []);
  return useMutation<void, { profileImageUrl: null }>(fn, opts);
}
