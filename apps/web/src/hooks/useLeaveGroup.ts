"use client";
import { useCallback } from "react";
import { api } from "@/lib/api";
import { useMutation, type MutationOptions } from "./_useMutation";

/** 팀 나가기 DELETE /groups/:id/me (마지막 멤버면 팀도 삭제) */
export function useLeaveGroup(groupId: number, opts?: MutationOptions) {
  const fn = useCallback(() => api<void>(`/groups/${groupId}/me`, { method: "DELETE" }), [groupId]);
  return useMutation<void, void>(fn, opts);
}
