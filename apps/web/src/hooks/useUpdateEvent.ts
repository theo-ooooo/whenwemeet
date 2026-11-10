"use client";
import { useCallback } from "react";
import { api } from "@/lib/api";
import type { Event, EventPatchInput, EventScope } from "@/lib/types";
import { qs } from "./_error";
import { useMutation, type MutationOptions } from "./_useMutation";

/**
 * 일정 수정 PATCH /groups/:id/events/:eventId?occurrence=&scope=.
 * 반복 일정은 occurrence + scope 필수, 한 번짜리는 둘 다 생략 (#187)
 */
export function useUpdateEvent(groupId: number, opts?: MutationOptions) {
  const fn = useCallback(
    ({ eventId, input, occurrence, scope }: { eventId: number; input: EventPatchInput; occurrence?: string; scope?: EventScope }) =>
      api<Event>(`/groups/${groupId}/events/${eventId}${qs({ occurrence, scope })}`, { method: "PATCH", body: input }),
    [groupId],
  );
  return useMutation(fn, opts);
}
