import { Inject, Injectable, Logger } from '@nestjs/common';
import { ApiException } from '../common/errors.js';
import { KAKAO_PLACE_ID_PATTERN } from '../events/place.js';
import { PLACE_SEARCH_PROVIDER, type PlaceCandidate, PlaceSearchError, type PlaceSearchProvider, PlaceSearchUnavailableError } from './place-search.provider.js';

/** 장소 검색어 상한 (일정 검색과 같다, 저장하는 placeQuery 는 100자) */
export const PLACE_QUERY_MAX = 50;
export const PLACE_RESOLVE_QUERY_MAX = 100;
/** 검색 결과 메모리 캐시. 카카오 결과는 저장하지 않으므로 프로세스 메모리에만, 짧게 (D-247) */
export const PLACE_CACHE_TTL_MS = 5 * 60 * 1000;
export const PLACE_CACHE_MAX = 500;

function invalid(field: string, message: string): ApiException {
  return new ApiException('VALIDATION_FAILED', message, [{ field, message }]);
}

/**
 * (#199) 장소 검색 프록시 (설계 api.md 2.14, D-247). 카카오 REST 키는 서버에만 두고 브라우저는 우리 API 만 부른다.
 * - search: 입력 중 후보 (`GET /places/search`)
 * - resolve: 저장된 (카카오 ID, 고를 때 검색어) 로 지금 다시 찾아 ID 가 같은 결과 하나 (`GET /places/resolve`, 구독 피드)
 * 결과는 DB 에 저장하지 않고 5분 메모리 캐시만 둔다. 검색어는 로그에 남기지 않는다
 */
@Injectable()
export class PlacesService {
  private readonly logger = new Logger(PlacesService.name);
  private readonly cache = new Map<string, { at: number; items: PlaceCandidate[] }>();

  constructor(@Inject(PLACE_SEARCH_PROVIDER) private readonly provider: PlaceSearchProvider) {}

  /** 지금 시각 (테스트가 바꾼다) */
  now: () => number = () => Date.now();

  async search(raw: unknown): Promise<{ items: PlaceCandidate[] }> {
    const q = typeof raw === 'string' ? raw.trim() : '';
    if (q.length === 0 || Array.from(q).length > PLACE_QUERY_MAX) throw invalid('q', `검색어는 1~${PLACE_QUERY_MAX}자여야 해요`);
    return { items: await this.cachedSearch(q) };
  }

  /** `GET /places/resolve?id=&q=`. 못 찾으면 place null (웹은 사용자 글자와 장소 링크만) */
  async resolve(idRaw: unknown, qRaw: unknown): Promise<{ place: PlaceCandidate | null }> {
    if (typeof idRaw !== 'string' || !KAKAO_PLACE_ID_PATTERN.test(idRaw)) throw invalid('id', '카카오 장소 ID 가 올바르지 않아요');
    const q = typeof qRaw === 'string' ? qRaw.trim() : '';
    if (q.length === 0 || Array.from(q).length > PLACE_RESOLVE_QUERY_MAX) throw invalid('q', `검색어는 1~${PLACE_RESOLVE_QUERY_MAX}자여야 해요`);
    const items = await this.cachedSearch(q);
    return { place: items.find((item) => item.kakaoPlaceId === idRaw) ?? null };
  }

  /** 구독 피드용: 못 찾거나 카카오 오류면 null (피드는 사용자 글자로) */
  async resolveQuietly(id: string, q: string): Promise<PlaceCandidate | null> {
    try {
      return (await this.resolve(id, q)).place;
    } catch {
      return null;
    }
  }

  private async cachedSearch(q: string): Promise<PlaceCandidate[]> {
    const now = this.now();
    const hit = this.cache.get(q);
    if (hit && now - hit.at < PLACE_CACHE_TTL_MS) return hit.items;
    let items: PlaceCandidate[];
    try {
      items = await this.provider.search(q);
    } catch (error) {
      if (error instanceof PlaceSearchUnavailableError) throw new ApiException('PLACE_SEARCH_NOT_CONFIGURED');
      if (error instanceof PlaceSearchError) {
        this.logger.warn(`카카오 장소 검색 실패: ${error.httpStatus ?? '연결'}`);
        throw new ApiException('PLACE_SEARCH_FAILED');
      }
      throw error;
    }
    this.cache.delete(q);
    this.cache.set(q, { at: now, items });
    // 오래된 것부터 버린다 (Map 은 넣은 순서)
    while (this.cache.size > PLACE_CACHE_MAX) this.cache.delete(this.cache.keys().next().value as string);
    return items;
  }
}
