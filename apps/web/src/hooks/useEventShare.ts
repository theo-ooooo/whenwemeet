"use client";
import { useCallback } from "react";
import { api } from "@/lib/api";
import type { EventShareJoin, EventShareLink } from "@/lib/types";
import { qs } from "./_error";
import { useMutation, type MutationOptions } from "./_useMutation";

type ShareTarget = { eventId: number; occurrence?: string | null };

/**
 * (#274) 일정 공유 링크 받기 POST /groups/:id/events/:eventId/share. 살아 있는 링크가 있으면 그것(200), 없으면 새로(201).
 * 반복 일정은 occurrence(회차 날짜) 필수
 */
export function useCreateEventShare(groupId: number, opts?: MutationOptions) {
  const fn = useCallback(
    ({ eventId, occurrence }: ShareTarget) =>
      api<EventShareLink>(`/groups/${groupId}/events/${eventId}/share`, { method: "POST", body: occurrence ? { occurrence } : {} }),
    [groupId],
  );
  return useMutation(fn, opts);
}

/** (#274) 그 일정(회차)의 링크 끊기 DELETE /groups/:id/events/:eventId/share?occurrence= */
export function useRevokeEventShare(groupId: number, opts?: MutationOptions) {
  const fn = useCallback(
    ({ eventId, occurrence }: ShareTarget) =>
      api<{ ok: true }>(`/groups/${groupId}/events/${eventId}/share${qs({ occurrence: occurrence ?? undefined })}`, { method: "DELETE" }),
    [groupId],
  );
  return useMutation(fn, opts);
}

/** (#274) 일정 링크로 팀 합류 POST /event-shares/:token/join. 멱등 */
export function useJoinEventShare(opts?: MutationOptions) {
  const fn = useCallback((token: string) => api<EventShareJoin>(`/event-shares/${token}/join`, { method: "POST" }), []);
  return useMutation(fn, opts);
}
