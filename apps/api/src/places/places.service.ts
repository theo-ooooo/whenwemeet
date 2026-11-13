import { Inject, Injectable, Logger } from '@nestjs/common';
import { ApiException } from '../common/errors.js';
import { KAKAO_PLACE_ID_PATTERN, NAVER_PLACE_KEY_PATTERN } from '../events/place.js';
import { NAVER_PLACE_SEARCH_PROVIDER } from './naver-place-search.provider.js';
import {
  PLACE_SEARCH_PROVIDER,
  type PlaceCandidate,
  PlaceSearchError,
  type PlaceSearchProvider,
  PlaceSearchUnavailableError,
  type PlaceSource,
} from './place-search.provider.js';

/** 장소 검색어 상한 (일정 검색과 같다, 저장하는 placeQuery 는 100자) */
export const PLACE_QUERY_MAX = 50;
export const PLACE_RESOLVE_QUERY_MAX = 100;
/** 검색 결과 메모리 캐시. 카카오 결과는 저장하지 않으므로 프로세스 메모리에만, 짧게 (D-247) */
export const PLACE_CACHE_TTL_MS = 5 * 60 * 1000;
export const PLACE_CACHE_MAX = 500;

function invalid(field: string, message: string): ApiException {
  return new ApiException('VALIDATION_FAILED', message, [{ field, message }]);
}

/** provider 쿼리: 없거나 빈 값은 카카오 (옛 웹 호환), kakao 나 naver 가 아니면 400 */
export function parseSource(raw: unknown): PlaceSource {
  if (raw === undefined || raw === null || raw === '') return 'kakao';
  if (raw === 'kakao' || raw === 'naver') return raw;
  throw invalid('provider', '장소 검색 출처는 kakao 나 naver 여야 해요');
}

const SOURCE_NAMES: Record<PlaceSource, string> = { kakao: '카카오', naver: '네이버' };

/**
 * (#199) 장소 검색 프록시 (설계 api.md 2.14, D-247, D-259). 카카오 REST 키, 네이버 검색 키는 서버에만 두고 브라우저는 우리 API 만 부른다.
 * - search: 입력 중 후보 (`GET /places/search?provider=`). 출처는 웹의 지도 선택 (기본 카카오)
 * - resolve: 저장된 (식별자, 고를 때 검색어) 로 지금 다시 찾아 식별자가 같은 결과 하나 (`GET /places/resolve`, 구독 피드).
 *   카카오는 장소 ID, 네이버는 이름 + 주소 해시 키
 * 결과는 DB 에 저장하지 않고 출처 + 검색어별 5분 메모리 캐시만 둔다. 검색어는 로그에 남기지 않는다
 */
@Injectable()
export class PlacesService {
  private readonly logger = new Logger(PlacesService.name);
  private readonly cache = new Map<string, { at: number; items: PlaceCandidate[] }>();

  private readonly providers: Record<PlaceSource, PlaceSearchProvider>;

  constructor(@Inject(PLACE_SEARCH_PROVIDER) kakao: PlaceSearchProvider, @Inject(NAVER_PLACE_SEARCH_PROVIDER) naver: PlaceSearchProvider) {
    this.providers = { kakao, naver };
  }

  /** 지금 시각 (테스트가 바꾼다) */
  now: () => number = () => Date.now();

  async search(raw: unknown, sourceRaw?: unknown): Promise<{ items: PlaceCandidate[] }> {
    const source = parseSource(sourceRaw);
    const q = typeof raw === 'string' ? raw.trim() : '';
    if (q.length === 0 || Array.from(q).length > PLACE_QUERY_MAX) throw invalid('q', `검색어는 1~${PLACE_QUERY_MAX}자여야 해요`);
    return { items: await this.cachedSearch(source, q) };
  }

  /**
   * `GET /places/resolve?provider=&id=&q=`. id 는 카카오면 장소 ID, 네이버면 식별 키(naverKey).
   * 못 찾으면 place null (웹은 사용자 글자와 지도 검색 링크만)
   */
  async resolve(idRaw: unknown, qRaw: unknown, sourceRaw?: unknown): Promise<{ place: PlaceCandidate | null }> {
    const source = parseSource(sourceRaw);
    if (source === 'kakao' && (typeof idRaw !== 'string' || !KAKAO_PLACE_ID_PATTERN.test(idRaw))) throw invalid('id', '카카오 장소 ID 가 올바르지 않아요');
    if (source === 'naver' && (typeof idRaw !== 'string' || !NAVER_PLACE_KEY_PATTERN.test(idRaw))) throw invalid('id', '네이버 장소 키가 올바르지 않아요');
    const q = typeof qRaw === 'string' ? qRaw.trim() : '';
    if (q.length === 0 || Array.from(q).length > PLACE_RESOLVE_QUERY_MAX) throw invalid('q', `검색어는 1~${PLACE_RESOLVE_QUERY_MAX}자여야 해요`);
    const items = await this.cachedSearch(source, q);
    return { place: items.find((item) => (source === 'naver' ? item.naverKey : item.kakaoPlaceId) === idRaw) ?? null };
  }

  /** 구독 피드용: 못 찾거나 검색 오류면 null (피드는 사용자 글자로) */
  async resolveQuietly(source: PlaceSource, id: string, q: string): Promise<PlaceCandidate | null> {
    try {
      return (await this.resolve(id, q, source)).place;
    } catch {
      return null;
    }
  }

  private async cachedSearch(source: PlaceSource, q: string): Promise<PlaceCandidate[]> {
    const now = this.now();
    const key = `${source}|${q}`;
    const hit = this.cache.get(key);
    if (hit && now - hit.at < PLACE_CACHE_TTL_MS) return hit.items;
    let items: PlaceCandidate[];
    try {
      items = await this.providers[source].search(q);
    } catch (error) {
      if (error instanceof PlaceSearchUnavailableError) throw new ApiException('PLACE_SEARCH_NOT_CONFIGURED');
      if (error instanceof PlaceSearchError) {
        this.logger.warn(`${SOURCE_NAMES[source]} 장소 검색 실패: ${error.httpStatus ?? '연결'}`);
        throw new ApiException('PLACE_SEARCH_FAILED');
      }
      throw error;
    }
    this.cache.delete(key);
    this.cache.set(key, { at: now, items });
    // 오래된 것부터 버린다 (Map 은 넣은 순서)
    while (this.cache.size > PLACE_CACHE_MAX) this.cache.delete(this.cache.keys().next().value as string);
    return items;
  }
}
