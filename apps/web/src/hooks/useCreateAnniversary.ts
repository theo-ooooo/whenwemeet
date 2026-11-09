"use client";
import { useCallback } from "react";
import { api } from "@/lib/api";
import type { Anniversary } from "@/lib/types";
import { useMutation, type MutationOptions } from "./_useMutation";

/** 기념일 추가 POST /groups/:id/anniversaries (삭제 되돌리기도 같은 값으로 다시 POST) */
export function useCreateAnniversary(groupId: string, opts?: MutationOptions) {
  const fn = useCallback(
    (input: { name: string; date: string }) =>
      api<Anniversary>(`/groups/${groupId}/anniversaries`, { method: "POST", body: input }),
    [groupId],
  );
  return useMutation(fn, opts);
}
