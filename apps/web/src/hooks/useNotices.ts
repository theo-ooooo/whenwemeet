"use client";
import { useCallback } from "react";
import { api } from "@/lib/api";
import type { Notice, NoticeAttention, NoticeListItem, Page } from "@/lib/types";
import { useQuery, type QueryOptions } from "./_useQuery";
import { useMutation, type MutationOptions } from "./_useMutation";
import { usePaged } from "./_usePaged";

/** (#515) 공지 목록 GET /notices (공개, 로그인했으면 unread). 다음 페이지는 loadMore */
export function useNotices(opts?: QueryOptions<Page<NoticeListItem>>) {
  return usePaged<NoticeListItem>("/notices?limit=20", opts);
}

/** (#515) 공지 목록을 본 시각 기록 POST /notices/seen. 로그인했을 때만, 목록을 받은 뒤에 부른다 */
export function useMarkNoticesSeen(opts?: MutationOptions) {
  const fn = useCallback(() => api<{ noticesSeenAt: string }>("/notices/seen", { method: "POST" }), []);
  return useMutation<void, { noticesSeenAt: string }>(fn, opts);
}

/** (#515) 공지 작성, 수정 입력. published 는 게시(true)와 초안(false) */
export type NoticeInput = { title: string; body: string; kind: Notice["kind"]; pinned: boolean; published: boolean; /** (#538) 앱, 웹을 열 때 한 번 창으로 */ popup?: boolean; /** (#528) 게시와 같이 전체 푸시. 게시할 때만, 한 번만 */ push?: boolean };

/** (#538) 팝업 공지와 새 공지 띠 GET /notices/attention (D-291). 로그인했을 때만 */
export function useNoticeAttention(opts?: QueryOptions<NoticeAttention>) {
  return useQuery<NoticeAttention>("/notices/attention", opts);
}

/** (#538) 팝업 닫기 POST /notices/:id/dismiss. 멱등. 다시 띄우지 않는다 (기기가 바뀌어도) */
export function useDismissNotice(opts?: MutationOptions) {
  const fn = useCallback((id: number) => api<{ ok: true }>(`/notices/${id}/dismiss`, { method: "POST" }), []);
  return useMutation<number, { ok: true }>(fn, opts);
}
