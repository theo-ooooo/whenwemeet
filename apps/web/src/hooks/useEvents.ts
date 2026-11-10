"use client";
import type { Event } from "@/lib/types";
import { qs } from "./_error";
import { useQuery, type QueryOptions } from "./_useQuery";

/** 기간 안 일정 목록 GET /groups/:id/events?from&to (ISO) */
export function useEvents(groupId: number, range: { from: string; to: string }, opts?: QueryOptions<Event[]>) {
  return useQuery<Event[]>(`/groups/${groupId}/events${qs(range)}`, opts);
}
