"use client";
import type { GroupDetail } from "@/lib/types";
import { useQuery, type QueryOptions } from "./_useQuery";

/** 팀 상세 GET /groups/:id. (#311) 팀이 아직 정해지지 않았으면(null) 요청하지 않는다 */
export function useGroup(groupId: number | null, opts?: QueryOptions<GroupDetail>) {
  return useQuery<GroupDetail>(groupId === null ? null : `/groups/${groupId}`, opts);
}
