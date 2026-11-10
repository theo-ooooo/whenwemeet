"use client";
import type { GroupSummary } from "@/lib/types";
import { useQuery, type QueryOptions } from "./_useQuery";

/** 내 팀 목록 GET /groups */
export function useGroups(opts?: QueryOptions<GroupSummary[]>) {
  return useQuery<GroupSummary[]>("/groups", opts);
}
