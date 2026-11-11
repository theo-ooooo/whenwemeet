"use client";
import { useCallback } from "react";
import { api } from "@/lib/api";
import { useMutation, type MutationOptions } from "./_useMutation";

/** (#196) inviteShareUrl 은 새 코드 + 내 표식 */
type RotatedInvite = { inviteCode: string; inviteUrl: string; inviteShareUrl: string };

/** 초대 코드 재발급 POST /groups/:id/invite-code */
export function useRotateInviteCode(groupId: number, opts?: MutationOptions) {
  const fn = useCallback(
    () => api<RotatedInvite>(`/groups/${groupId}/invite-code`, { method: "POST" }),
    [groupId],
  );
  return useMutation<void, RotatedInvite>(fn, opts);
}
