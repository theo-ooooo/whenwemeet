"use client";
import { useCallback } from "react";
import { api } from "@/lib/api";
import type { Me } from "@/lib/types";
import { useMutation, type MutationOptions } from "./_useMutation";

/** 닉네임 변경 PATCH /me (1~20자, 앞뒤 공백은 서버가 자른다) */
export function useUpdateMe(opts?: MutationOptions) {
  const fn = useCallback((input: { nickname: string }) => api<Me>("/me", { method: "PATCH", body: input }), []);
  return useMutation(fn, opts);
}
