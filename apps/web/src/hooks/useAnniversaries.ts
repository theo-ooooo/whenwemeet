"use client";
import type { Anniversary } from "@/lib/types";
import { useQuery, type QueryOptions } from "./_useQuery";

/** 기념일 목록 GET /groups/:id/anniversaries */
export function useAnniversaries(groupId: string, opts?: QueryOptions<Anniversary[]>) {
  return useQuery<Anniversary[]>(`/groups/${groupId}/anniversaries`, opts);
}
