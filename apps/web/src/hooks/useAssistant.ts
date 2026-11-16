"use client";
// (#450) AI 비서 "볼까" 자원 훅 (api.md 2.15). 메시지 보내기, 처음 안내 동의
import { useCallback } from "react";
import { api } from "@/lib/api";
import type { AssistantReply, AssistantRequest } from "@/lib/assistant";
import { useMutation, type MutationOptions } from "./_useMutation";

/**
 * 메시지 보내기 POST /groups/:id/assistant/messages. signal 로 끊는다(화면을 닫을 때).
 * 서버 500 도 점검 화면으로 보내지 않고 대화 안 오류 말풍선으로 둔다 (AI-비서.md 7-8)
 */
export function useSendAssistantMessage(groupId: number, opts?: MutationOptions) {
  const fn = useCallback(
    ({ signal, ...body }: AssistantRequest & { signal?: AbortSignal }) =>
      api<AssistantReply>(`/groups/${groupId}/assistant/messages`, { method: "POST", body, signal, outageRedirect: false }),
    [groupId],
  );
  return useMutation(fn, opts);
}

/** 처음 쓸 때 안내 동의 POST /me/assistant-consent (멱등) */
export function useAssistantConsent(opts?: MutationOptions) {
  const fn = useCallback(() => api<{ consentedAt: string }>("/me/assistant-consent", { method: "POST" }), []);
  return useMutation(fn, opts);
}
