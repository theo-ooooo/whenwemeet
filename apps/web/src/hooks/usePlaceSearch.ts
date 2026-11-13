"use client";
import type { PlaceCandidate, PlaceProvider } from "@/lib/types";
import { qs } from "./_error";
import { useQuery } from "./_useQuery";

/**
 * (#199) 장소 검색 GET /places/search?q=&provider= (우리 API 가 카카오 로컬 또는 네이버 지역 검색을 대신 부른다, 키는 서버에만).
 * provider 는 내 정보의 지도 선택 (D-259). 입력 중 300ms 디바운스, 검색어가 비면 부르지 않는다. 503(설정 없음), 502 는 error 로 오고 화면은 직접 입력만 남긴다
 */
export function usePlaceSearch(query: string, provider: PlaceProvider, enabled = true) {
  const q = query.trim();
  return useQuery<{ items: PlaceCandidate[] }>(q ? `/places/search${qs({ q, provider })}` : null, { enabled: enabled && q.length > 0, debounceMs: 300 });
}
