"use client";
import type { GroupDetail } from "@/lib/types";
import { useQuery, type QueryOptions } from "./_useQuery";

/** 팀 상세 GET /groups/:id */
export function useGroup(groupId: number, opts?: QueryOptions<GroupDetail>) {
  return useQuery<GroupDetail>(`/groups/${groupId}`, opts);
}
