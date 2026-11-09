"use client";
import { useCallback } from "react";
import { api } from "@/lib/api";
import type { Event, EventInput } from "@/lib/types";
import { useMutation, type MutationOptions } from "./_useMutation";

/** 일정 추가 POST /groups/:id/events */
export function useCreateEvent(groupId: string, opts?: MutationOptions) {
  const fn = useCallback(
    (input: EventInput) => api<Event>(`/groups/${groupId}/events`, { method: "POST", body: input }),
    [groupId],
  );
  return useMutation(fn, opts);
}
