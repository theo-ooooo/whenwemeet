"use client";
import type { News } from "@/lib/types";
import { useQuery, type QueryOptions } from "./_useQuery";

/**
 * 새 소식 GET /groups/:id/news?v=2. 읽음 처리는 useMarkNewsSeen 으로 따로 (순서: GET → POST).
 * v=2 는 팀 활동 기록(#191)을 섞어 달라는 뜻. 없으면 API 가 예전 모양(일정만)으로 준다 (D-155)
 */
export function useNews(groupId: number, opts?: QueryOptions<News>) {
  return useQuery<News>(`/groups/${groupId}/news?v=2`, opts);
}
