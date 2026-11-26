"use client";
import { useCallback } from "react";
import { api } from "@/lib/api";
import type { GroupDetail } from "@/lib/types";
import { useMutation, type MutationOptions } from "./_useMutation";

/** 팀 이름 바꾸기 PATCH /groups/:id */
export function useUpdateGroup(groupId: number, opts?: MutationOptions) {
  const fn = useCallback((input: { name: string }) => api<GroupDetail>(`/groups/${groupId}`, { method: "PATCH", body: input }), [groupId]);
  return useMutation(fn, opts);
}
