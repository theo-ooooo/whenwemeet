"use client";
import { useCallback } from "react";
import { api } from "@/lib/api";
import type { EventScope } from "@/lib/types";
import { qs } from "./_error";
import { useMutation, type MutationOptions } from "./_useMutation";

/**
 * 일정 삭제 DELETE /groups/:id/events/:eventId?occurrence=&scope=.
 * 반복 일정은 occurrence + scope 필수, 한 번짜리는 둘 다 생략 (#187)
 */
export function useDeleteEvent(groupId: number, opts?: MutationOptions) {
  const fn = useCallback(
    ({ eventId, occurrence, scope }: { eventId: number; occurrence?: string; scope?: EventScope }) =>
      api<void>(`/groups/${groupId}/events/${eventId}${qs({ occurrence, scope })}`, { method: "DELETE" }),
    [groupId],
  );
  return useMutation(fn, opts);
}
