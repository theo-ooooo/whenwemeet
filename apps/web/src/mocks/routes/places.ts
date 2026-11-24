// 장소 검색과 다시 찾기 (#491). 가짜 목록은 mocks/places.ts
import { fakePlaceSearch } from "../places";
import { err, ok, type AuthedReq, type MockResult } from "./shared";

/** (#199) 장소 검색 */
export function placeSearchRoute(req: AuthedReq): MockResult | null {
  const { method, seg, query } = req;
  if (seg[0] === "places" && seg[1] === "search" && seg.length === 2 && method === "GET") {
    const q = (query.get("q") ?? "").trim();
    if (!q || Array.from(q).length > 50) return err(400, "VALIDATION_FAILED", "검색어는 1~50자여야 해요");
    const provider = query.get("provider") || "kakao";
    if (provider !== "kakao" && provider !== "naver") return err(400, "VALIDATION_FAILED", "장소 검색 출처는 kakao 나 naver 여야 해요");
    return ok({ items: fakePlaceSearch(q, provider) });
  }
  return null;
}

// (#199) 저장된 장소 다시 찾기 (같은 가짜 목록에서 ID 가 같은 것). (D-259) provider=naver 면 키가 같은 것
export function placeResolveRoute(req: AuthedReq): MockResult | null {
  const { method, seg, query } = req;
  if (seg[0] === "places" && seg[1] === "resolve" && seg.length === 2 && method === "GET") {
    const id = query.get("id") ?? "";
    const q = (query.get("q") ?? "").trim();
    const provider = query.get("provider") || "kakao";
    if (provider !== "kakao" && provider !== "naver") return err(400, "VALIDATION_FAILED", "장소 검색 출처는 kakao 나 naver 여야 해요");
    if (provider === "kakao" && !/^\d{1,20}$/.test(id)) return err(400, "VALIDATION_FAILED", "카카오 장소 ID 가 올바르지 않아요");
    if (provider === "naver" && !/^[0-9a-f]{16}$/.test(id)) return err(400, "VALIDATION_FAILED", "네이버 장소 키가 올바르지 않아요");
    if (!q) return err(400, "VALIDATION_FAILED", "검색어는 1~100자여야 해요");
    return ok({ place: fakePlaceSearch(q, provider).find((p) => (provider === "naver" ? p.naverKey : p.kakaoPlaceId) === id) ?? null });
  }
  return null;
}
