"use client";
import { useCallback } from "react";
import { api } from "@/lib/api";
import type { GroupDetail } from "@/lib/types";
import { useMutation, type MutationOptions } from "./_useMutation";

/** 팀 만들기 POST /groups */
export function useCreateGroup(opts?: MutationOptions) {
  const fn = useCallback(
    (input: { name: string }) => api<GroupDetail>("/groups", { method: "POST", body: input }),
    [],
  );
  return useMutation(fn, opts);
}
