"use client";
import { useCallback } from "react";
import { api } from "@/lib/api";
import type { EventRestoreResult } from "@/lib/types";
import { useMutation } from "./_useMutation";

/**
 * (#375) 일정 삭제 되돌리기 POST /groups/:id/event-deletions/:deletionId/restore (D-251).
 * deletionId 는 삭제 응답 값. 팀원 누구나, 지운 뒤 7일 안. 그 사이 일정이 바뀌면 409
 */
export function useRestoreEvent(groupId: number) {
  const fn = useCallback(
    (deletionId: number) =>
      api<EventRestoreResult>(`/groups/${groupId}/event-deletions/${deletionId}/restore`, { method: "POST" }),
    [groupId],
  );
  return useMutation(fn);
}
