"use client";
import { useCallback } from "react";
import { api } from "@/lib/api";
import type { CalendarFeed } from "@/lib/types";
import { useMutation, type MutationOptions } from "./_useMutation";
import { useQuery, type QueryOptions } from "./_useQuery";

export type CalendarFeedSettings = { includeMemo?: boolean; includeAnniversaries?: boolean };

/** (#193) 내 구독 주소 GET /groups/:id/calendar-feed. 없으면 data = null (꺼짐) */
export function useCalendarFeed(groupId: number, opts?: QueryOptions<CalendarFeed | null>) {
  return useQuery<CalendarFeed | null>(`/groups/${groupId}/calendar-feed`, opts);
}

/** (#193) 만들기와 설정 PUT /groups/:id/calendar-feed. 없으면 만들고 있으면 설정만 (주소 그대로) */
export function useSaveCalendarFeed(groupId: number, opts?: MutationOptions) {
  const fn = useCallback((input: CalendarFeedSettings) => api<CalendarFeed>(`/groups/${groupId}/calendar-feed`, { method: "PUT", body: input }), [groupId]);
  return useMutation(fn, opts);
}

/** (#193) 주소 다시 만들기 POST /groups/:id/calendar-feed/rotate. 이전 주소는 바로 끊긴다 */
export function useRotateCalendarFeed(groupId: number, opts?: MutationOptions) {
  const fn = useCallback(() => api<CalendarFeed>(`/groups/${groupId}/calendar-feed/rotate`, { method: "POST" }), [groupId]);
  return useMutation<void, CalendarFeed>(fn, opts);
}

/** (#193) 끄기 DELETE /groups/:id/calendar-feed */
export function useDeleteCalendarFeed(groupId: number, opts?: MutationOptions) {
  const fn = useCallback(() => api<{ ok: true }>(`/groups/${groupId}/calendar-feed`, { method: "DELETE" }), [groupId]);
  return useMutation<void, { ok: true }>(fn, opts);
}
