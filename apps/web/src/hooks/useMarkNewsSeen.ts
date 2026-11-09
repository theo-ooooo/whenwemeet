"use client";
import { useCallback } from "react";
import { api } from "@/lib/api";
import { useMutation, type MutationOptions } from "./_useMutation";

/** 새 소식 읽음 POST /groups/:id/news/seen. 목록(useNews)을 받은 뒤에 부른다 */
export function useMarkNewsSeen(groupId: number, opts?: MutationOptions) {
  const fn = useCallback(() => api<void>(`/groups/${groupId}/news/seen`, { method: "POST" }), [groupId]);
  return useMutation<void, void>(fn, opts);
}
