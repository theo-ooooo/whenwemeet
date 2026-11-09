"use client";
import { useCallback } from "react";
import { api } from "@/lib/api";
import { useMutation, type MutationOptions } from "./_useMutation";

/** 초대 코드 재발급 POST /groups/:id/invite-code */
export function useRotateInviteCode(groupId: string, opts?: MutationOptions) {
  const fn = useCallback(
    () => api<{ inviteCode: string; inviteUrl: string }>(`/groups/${groupId}/invite-code`, { method: "POST" }),
    [groupId],
  );
  return useMutation<void, { inviteCode: string; inviteUrl: string }>(fn, opts);
}
