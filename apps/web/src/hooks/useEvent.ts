"use client";
import type { EventDetailData } from "@/lib/types";
import { qs } from "./_error";
import { useQuery, type QueryOptions } from "./_useQuery";

/**
 * 일정 하나 GET /groups/:id/events/:eventId?occurrence=. eventId 가 없으면(새 일정) 요청하지 않는다.
 * 반복 일정은 occurrence(회차 날짜) 회차를, 없으면 첫 회차를 준다 (#187)
 */
export function useEvent(groupId: number, eventId: number | undefined, occurrence?: string | null, opts?: QueryOptions<EventDetailData>) {
  return useQuery<EventDetailData>(eventId ? `/groups/${groupId}/events/${eventId}${qs({ occurrence: occurrence ?? undefined })}` : null, opts);
}
