"use client";
import { useCallback } from "react";
import { api } from "@/lib/api";
import type { Reaction, ReactionSummary, Rsvp, RsvpSummary } from "@/lib/types";
import { qs } from "./_error";
import { useMutation, type MutationOptions } from "./_useMutation";

type Target = { eventId: number; occurrence?: string };

/**
 * (#190) 내 참석 여부 PUT /groups/:id/events/:eventId/rsvp?occurrence=. null 은 응답 취소.
 * 반복 회차는 occurrence 필수, 한 번짜리는 생략. 참여자가 아니면 403 NOT_PARTICIPANT
 */
export function useSetRsvp(groupId: number, opts?: MutationOptions) {
  const fn = useCallback(
    ({ eventId, occurrence, status }: Target & { status: Rsvp | null }) =>
      api<RsvpSummary>(`/groups/${groupId}/events/${eventId}/rsvp${qs({ occurrence })}`, { method: "PUT", body: { status } }),
    [groupId],
  );
  return useMutation(fn, opts);
}

/** (#190) 내 반응 PUT /groups/:id/events/:eventId/reaction?occurrence=. null 은 취소. 팀원 누구나 */
export function useSetReaction(groupId: number, opts?: MutationOptions) {
  const fn = useCallback(
    ({ eventId, occurrence, reaction }: Target & { reaction: Reaction | null }) =>
      api<ReactionSummary>(`/groups/${groupId}/events/${eventId}/reaction${qs({ occurrence })}`, { method: "PUT", body: { reaction } }),
    [groupId],
  );
  return useMutation(fn, opts);
}
