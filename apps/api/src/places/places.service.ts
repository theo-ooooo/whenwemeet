import { Inject, Injectable, Logger } from '@nestjs/common';
import { ApiException } from '../common/errors.js';
import { PLACE_SEARCH_PROVIDER, type PlaceCandidate, PlaceSearchError, type PlaceSearchProvider, PlaceSearchUnavailableError } from './place-search.provider.js';

/** 장소 검색어 상한 (일정 검색과 같다) */
export const PLACE_QUERY_MAX = 50;

/**
 * (#199) 장소 검색 프록시 (설계 장소-검색.md, D-247). 카카오 REST 키는 서버에만 두고 브라우저는 우리 API 만 부른다.
 * 검색어와 결과는 저장하지 않는다. 로그에는 검색어를 남기지 않는다
 */
@Injectable()
export class PlacesService {
  private readonly logger = new Logger(PlacesService.name);

  constructor(@Inject(PLACE_SEARCH_PROVIDER) private readonly provider: PlaceSearchProvider) {}

  async search(raw: unknown): Promise<{ items: PlaceCandidate[] }> {
    const q = typeof raw === 'string' ? raw.trim() : '';
    if (q.length === 0 || Array.from(q).length > PLACE_QUERY_MAX) {
      const message = `검색어는 1~${PLACE_QUERY_MAX}자여야 해요`;
      throw new ApiException('VALIDATION_FAILED', message, [{ field: 'q', message }]);
    }
    try {
      return { items: await this.provider.search(q) };
    } catch (error) {
      if (error instanceof PlaceSearchUnavailableError) throw new ApiException('PLACE_SEARCH_NOT_CONFIGURED');
      if (error instanceof PlaceSearchError) {
        this.logger.warn(`카카오 장소 검색 실패: ${error.httpStatus ?? '연결'}`);
        throw new ApiException('PLACE_SEARCH_FAILED');
      }
      throw error;
    }
  }
}
