"use client";
import { useCallback } from "react";
import { api } from "@/lib/api";
import type { Notice, NoticeListItem, Page } from "@/lib/types";
import type { QueryOptions } from "./_useQuery";
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
export type NoticeInput = { title: string; body: string; kind: Notice["kind"]; pinned: boolean; published: boolean };
