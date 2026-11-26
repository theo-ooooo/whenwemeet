"use client";
import { useEffect } from "react";
import { placeRef } from "@/lib/place";
import type { Place, PlaceCandidate } from "@/lib/types";
import { qs } from "./_error";
import { useQuery } from "./_useQuery";

/** 이 탭 메모리에만 두는 다시 찾기 결과 (검색 결과는 저장하지 않는다, D-242). 새로 고치면 사라진다 */
const memory = new Map<string, PlaceCandidate | null>();

/** 다시 찾기에 넘기는 모양: 저장된 장소(Place) 또는 고른 초안 (provider + id) */
type Ref = (Pick<Place, "kakaoPlaceId" | "naverKey" | "query"> | { provider: "kakao" | "naver"; id: string; query: string }) | null | undefined;

/**
 * (#199) 저장된 장소(식별자 + 고를 때 검색어)를 고른 출처에서 지금 다시 찾는다 GET /places/resolve?id=&q=(&provider=naver).
 * 카카오는 장소 ID, 네이버는 키(D-259). 지도 선택과 상관없이 장소의 출처에서 찾는다.
 * 직접 적은 장소(식별자 없음)는 부르지 않는다. 못 찾으면 data.place 가 null, 검색이 안 되면 error (화면은 사용자 글자와 지도 검색 링크만)
 */
export function usePlaceResolve(place: Ref) {
  const ref = place && "id" in place ? { provider: place.provider, id: place.id } : placeRef(place);
  const q = place?.query?.trim() ?? "";
  const key = ref && q ? `${ref.provider}|${ref.id}|${q}` : null;
  const cached = key !== null && memory.has(key) ? { place: memory.get(key) ?? null } : null;
  // 카카오는 provider 를 빼고 부른다 (옛 API 와 같은 주소)
  const params = ref ? (ref.provider === "naver" ? { provider: "naver", id: ref.id, q } : { id: ref.id, q }) : null;
  const r = useQuery<{ place: PlaceCandidate | null }>(key && params ? `/places/resolve${qs(params)}` : null, {
    enabled: key !== null && cached === null,
    initialData: cached,
  });
  useEffect(() => {
    if (key !== null && r.data) memory.set(key, r.data.place);
  }, [key, r.data]);
  return { ...r, data: cached ?? r.data, isLoading: cached ? false : r.isLoading };
}
