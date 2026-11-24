"use client";
import { useCallback } from "react";
import { api } from "@/lib/api";
import { CLIENT_SOURCE_HEADER, type ClientSource } from "@/lib/assistant";
import type { Event, EventPatchInput, EventScope } from "@/lib/types";
import { qs } from "./_error";
import { useMutation, type MutationOptions } from "./_useMutation";

/**
 * 일정 수정 PATCH /groups/:id/events/:eventId?occurrence=&scope=.
 * 반복 일정은 occurrence + scope 필수, 한 번짜리는 둘 다 생략 (#187).
 * (#511) source 를 주면 X-Client-Source 헤더로 싣는다 (AI 비서 고치기 카드 [수정])
 */
export function useUpdateEvent(groupId: number, opts?: MutationOptions & { source?: ClientSource | null }) {
  const source = opts?.source ?? null;
  const fn = useCallback(
    ({ eventId, input, occurrence, scope }: { eventId: number; input: EventPatchInput; occurrence?: string; scope?: EventScope }) =>
      api<Event>(`/groups/${groupId}/events/${eventId}${qs({ occurrence, scope })}`, {
        method: "PATCH",
        body: input,
        headers: source ? { [CLIENT_SOURCE_HEADER]: source } : undefined,
      }),
    [groupId, source],
  );
  return useMutation(fn, opts);
}
