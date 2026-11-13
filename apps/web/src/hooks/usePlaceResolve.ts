"use client";
import { useEffect } from "react";
import type { Place, PlaceCandidate } from "@/lib/types";
import { qs } from "./_error";
import { useQuery } from "./_useQuery";

/** 이 탭 메모리에만 두는 다시 찾기 결과 (카카오 결과는 저장하지 않는다, D-242). 새로 고치면 사라진다 */
const memory = new Map<string, PlaceCandidate | null>();

/**
 * (#199) 저장된 장소(카카오 ID + 고를 때 검색어)를 지금 다시 찾는다 GET /places/resolve?id=&q=.
 * 직접 적은 장소(ID 없음)는 부르지 않는다. 못 찾으면 data.place 가 null, 카카오가 안 되면 error (화면은 사용자 글자와 장소 링크만)
 */
export function usePlaceResolve(place: Pick<Place, "kakaoPlaceId" | "query"> | null | undefined) {
  const id = place?.kakaoPlaceId ?? null;
  const q = place?.query?.trim() ?? "";
  const key = id && q ? `${id}|${q}` : null;
  const cached = key !== null && memory.has(key) ? { place: memory.get(key) ?? null } : null;
  const r = useQuery<{ place: PlaceCandidate | null }>(key ? `/places/resolve${qs({ id: id!, q })}` : null, { enabled: key !== null && cached === null, initialData: cached });
  useEffect(() => {
    if (key !== null && r.data) memory.set(key, r.data.place);
  }, [key, r.data]);
  return { ...r, data: cached ?? r.data, isLoading: cached ? false : r.isLoading };
}
