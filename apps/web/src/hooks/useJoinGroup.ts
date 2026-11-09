"use client";
import { useCallback } from "react";
import { api } from "@/lib/api";
import type { GroupDetail } from "@/lib/types";
import { useMutation, type MutationOptions } from "./_useMutation";

/** 초대 코드로 합류 POST /groups/join */
export function useJoinGroup(opts?: MutationOptions) {
  const fn = useCallback(
    (code: string) => api<GroupDetail>("/groups/join", { method: "POST", body: { code } }),
    [],
  );
  return useMutation(fn, opts);
}
