"use client";
import type { Event } from "@/lib/types";
import { useQuery, type QueryOptions } from "./_useQuery";

/** 일정 하나 GET /groups/:id/events/:eventId. eventId 가 없으면(새 일정) 요청하지 않는다 */
export function useEvent(groupId: number, eventId: number | undefined, opts?: QueryOptions<Event>) {
  return useQuery<Event>(eventId ? `/groups/${groupId}/events/${eventId}` : null, opts);
}
