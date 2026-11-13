"use client";
import type { EventSearchResult } from "@/lib/types";
import { qs } from "./_error";
import { useQuery } from "./_useQuery";

/**
 * (#199) 일정 검색 GET /events/search?q=&groupId=. groupId 가 null 이면 내가 속한 모든 팀.
 * 300ms 디바운스, 검색어가 비면 부르지 않는다. 검색어는 어디에도 저장하지 않는다 (스토어 "검색 기록: 수집 안 함")
 */
export function useEventSearch(query: string, groupId: number | null) {
  const q = query.trim();
  const path = q ? `/events/search${qs({ q, groupId: groupId === null ? undefined : String(groupId) })}` : null;
  return useQuery<EventSearchResult>(path, { enabled: q.length > 0, debounceMs: 300 });
}
