"use client";
import { useCallback } from "react";
import { api } from "@/lib/api";
import { useMutation, type MutationOptions } from "./_useMutation";

/** 일정 삭제 DELETE /groups/:id/events/:eventId */
export function useDeleteEvent(groupId: string, opts?: MutationOptions) {
  const fn = useCallback(
    (eventId: string) => api<void>(`/groups/${groupId}/events/${eventId}`, { method: "DELETE" }),
    [groupId],
  );
  return useMutation(fn, opts);
}
