"use client";
import type { Birthday } from "@/lib/types";
import { useQuery, type QueryOptions } from "./_useQuery";

/** (#305) 이 팀 달력에 보이는 멤버 생일 GET /groups/:id/birthdays */
export function useBirthdays(groupId: number, opts?: QueryOptions<Birthday[]>) {
  return useQuery<Birthday[]>(`/groups/${groupId}/birthdays`, opts);
}
