"use client";
import { useCallback } from "react";
import { api } from "@/lib/api";
import type { Anniversary } from "@/lib/types";
import { useMutation, type MutationOptions } from "./_useMutation";

/** 기념일 수정 PATCH /groups/:id/anniversaries/:id */
export function useUpdateAnniversary(groupId: number, opts?: MutationOptions) {
  const fn = useCallback(
    ({ id, input }: { id: number; input: { name: string; date: string } }) =>
      api<Anniversary>(`/groups/${groupId}/anniversaries/${id}`, { method: "PATCH", body: input }),
    [groupId],
  );
  return useMutation(fn, opts);
}
