"use client";
import { useCallback } from "react";
import { api } from "@/lib/api";
import type { Event, EventInput } from "@/lib/types";
import { useMutation, type MutationOptions } from "./_useMutation";

/** 일정 수정 PATCH /groups/:id/events/:eventId */
export function useUpdateEvent(groupId: number, opts?: MutationOptions) {
  const fn = useCallback(
    ({ eventId, input }: { eventId: number; input: EventInput }) =>
      api<Event>(`/groups/${groupId}/events/${eventId}`, { method: "PATCH", body: input }),
    [groupId],
  );
  return useMutation(fn, opts);
}
