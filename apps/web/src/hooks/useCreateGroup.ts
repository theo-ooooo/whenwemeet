"use client";
import { useCallback } from "react";
import { api } from "@/lib/api";
import type { PresetKey } from "@/lib/team-preset";
import type { GroupDetail } from "@/lib/types";
import { useMutation, type MutationOptions } from "./_useMutation";

/** 팀 만들기 POST /groups. (#278) preset 은 서버가 로그만 남기고 저장하지 않는다 (D-250) */
export function useCreateGroup(opts?: MutationOptions) {
  const fn = useCallback((input: { name: string; preset?: PresetKey }) => api<GroupDetail>("/groups", { method: "POST", body: input }), []);
  return useMutation(fn, opts);
}
