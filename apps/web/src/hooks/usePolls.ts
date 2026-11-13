"use client";
// (#189) 약속 투표 자원 훅 (api.md 2.13). 홈 "정하는 중" 목록, 투표 하나, 만들기, 표, 정하기, 취소
import { useCallback } from "react";
import { api } from "@/lib/api";
import type { Poll, PollConfirmResult, PollInput, PollSummary } from "@/lib/types";
import { useMutation, type MutationOptions } from "./_useMutation";
import { useQuery, type QueryOptions } from "./_useQuery";

/** 진행 중 투표 GET /groups/:id/polls (마감 가까운 순, 지난 투표는 뒤) */
export function usePolls(groupId: number, opts?: QueryOptions<PollSummary[]>) {
  return useQuery<PollSummary[]>(`/groups/${groupId}/polls`, opts);
}

/** 투표 하나 GET /polls/:code. 없거나 내 팀 투표가 아니면 404 */
export function usePoll(code: string, opts?: QueryOptions<Poll>) {
  return useQuery<Poll>(`/polls/${code}`, opts);
}

/** 만들기 POST /groups/:id/polls */
export function useCreatePoll(groupId: number, opts?: MutationOptions) {
  const fn = useCallback((input: PollInput) => api<Poll>(`/groups/${groupId}/polls`, { method: "POST", body: input }), [groupId]);
  return useMutation(fn, opts);
}

/** 내 표 전체 교체 PUT /groups/:id/polls/:pollId/votes */
export function useVotePoll(groupId: number, opts?: MutationOptions) {
  const fn = useCallback(
    ({ pollId, optionIds }: { pollId: number; optionIds: number[] }) =>
      api<Poll>(`/groups/${groupId}/polls/${pollId}/votes`, { method: "PUT", body: { optionIds } }),
    [groupId],
  );
  return useMutation(fn, opts);
}

/** 정하기 POST /groups/:id/polls/:pollId/confirm → 새 일정 */
export function useConfirmPoll(groupId: number, opts?: MutationOptions) {
  const fn = useCallback(
    ({ pollId, optionId }: { pollId: number; optionId: number }) =>
      api<PollConfirmResult>(`/groups/${groupId}/polls/${pollId}/confirm`, { method: "POST", body: { optionId } }),
    [groupId],
  );
  return useMutation(fn, opts);
}

/** 취소 DELETE /groups/:id/polls/:pollId (진행 중만) */
export function useDeletePoll(groupId: number, opts?: MutationOptions) {
  const fn = useCallback((pollId: number) => api<{ ok: true }>(`/groups/${groupId}/polls/${pollId}`, { method: "DELETE" }), [groupId]);
  return useMutation(fn, opts);
}
