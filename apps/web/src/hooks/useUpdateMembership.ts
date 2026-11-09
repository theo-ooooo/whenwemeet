"use client";
import { useCallback } from "react";
import { api } from "@/lib/api";
import type { Member } from "@/lib/types";
import { useMutation, type MutationOptions } from "./_useMutation";

/** 이 팀에서 내 표시(색, 이름) PATCH /groups/:id/me. displayName null 이면 카카오 닉네임 */
export function useUpdateMembership(groupId: string, opts?: MutationOptions) {
  const fn = useCallback(
    (input: { color: string; displayName: string | null }) =>
      api<Member>(`/groups/${groupId}/me`, { method: "PATCH", body: input }),
    [groupId],
  );
  return useMutation(fn, opts);
}
