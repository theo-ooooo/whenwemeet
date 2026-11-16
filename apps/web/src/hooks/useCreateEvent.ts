"use client";
import { useCallback } from "react";
import { api } from "@/lib/api";
import { CLIENT_SOURCE_HEADER, type ClientSource } from "@/lib/assistant";
import type { Event, EventInput } from "@/lib/types";
import { useMutation, type MutationOptions } from "./_useMutation";

/**
 * 일정 추가 POST /groups/:id/events.
 * (#450) source 를 주면 X-Client-Source 헤더로 싣는다 (AI 비서 카드 [추가], [고치기]로 연 폼의 저장, AI-비서.md 6-1)
 */
export function useCreateEvent(groupId: number, opts?: MutationOptions & { source?: ClientSource | null }) {
  const source = opts?.source ?? null;
  const fn = useCallback(
    (input: EventInput) =>
      api<Event>(`/groups/${groupId}/events`, { method: "POST", body: input, headers: source ? { [CLIENT_SOURCE_HEADER]: source } : undefined }),
    [groupId, source],
  );
  return useMutation(fn, opts);
}
