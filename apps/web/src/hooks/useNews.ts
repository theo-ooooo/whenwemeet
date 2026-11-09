"use client";
import type { News } from "@/lib/types";
import { useQuery, type QueryOptions } from "./_useQuery";

/** 새 소식 GET /groups/:id/news. 읽음 처리는 useMarkNewsSeen 으로 따로 (순서: GET → POST) */
export function useNews(groupId: number, opts?: QueryOptions<News>) {
  return useQuery<News>(`/groups/${groupId}/news`, opts);
}
