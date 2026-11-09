"use client";
import { useCallback } from "react";
import { api } from "@/lib/api";
import { useMutation, type MutationOptions } from "./_useMutation";

/** 일정 삭제 DELETE /groups/:id/events/:eventId */
export function useDeleteEvent(groupId: number, opts?: MutationOptions) {
  const fn = useCallback(
    (eventId: number) => api<void>(`/groups/${groupId}/events/${eventId}`, { method: "DELETE" }),
    [groupId],
  );
  return useMutation(fn, opts);
}
