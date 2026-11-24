"use client";
import { useCallback } from "react";
import { api } from "@/lib/api";
import { CLIENT_SOURCE_HEADER, type ClientSource } from "@/lib/assistant";
import type { EventDeleteResult, EventScope } from "@/lib/types";
import { qs } from "./_error";
import { useMutation, type MutationOptions } from "./_useMutation";

/**
 * 일정 삭제 DELETE /groups/:id/events/:eventId?occurrence=&scope=.
 * 반복 일정은 occurrence + scope 필수, 한 번짜리는 둘 다 생략 (#187).
 * (#375) 응답의 deletionId 로 되돌릴 수 있다 (useRestoreEvent).
 * (#511) source 를 주면 X-Client-Source 헤더로 싣는다 (AI 비서 지우기 카드 [삭제])
 */
export function useDeleteEvent(groupId: number, opts?: MutationOptions & { source?: ClientSource | null }) {
  const source = opts?.source ?? null;
  const fn = useCallback(
    ({ eventId, occurrence, scope }: { eventId: number; occurrence?: string; scope?: EventScope }) =>
      api<EventDeleteResult>(`/groups/${groupId}/events/${eventId}${qs({ occurrence, scope })}`, {
        method: "DELETE",
        headers: source ? { [CLIENT_SOURCE_HEADER]: source } : undefined,
      }),
    [groupId, source],
  );
  return useMutation(fn, opts);
}
