"use client";
import { useCallback } from "react";
import { api } from "@/lib/api";
import { useMutation, type MutationOptions } from "./_useMutation";

/** 기념일 삭제 DELETE /groups/:id/anniversaries/:id */
export function useDeleteAnniversary(groupId: string, opts?: MutationOptions) {
  const fn = useCallback(
    (id: string) => api<void>(`/groups/${groupId}/anniversaries/${id}`, { method: "DELETE" }),
    [groupId],
  );
  return useMutation(fn, opts);
}
