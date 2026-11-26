import { ApiException } from './errors.js';

/** (#515) 페이지 넘김 쿼리 기본값과 상한 (공지, 관리자 사용자 목록) */
export const PAGE_LIMIT_DEFAULT = 20;
export const PAGE_LIMIT_MAX = 50;
/** 관리자 사용자 검색어 상한 (닉네임 50자) */
export const PAGE_QUERY_MAX = 50;

export interface PageQuery {
  limit: number;
  /** 앞 페이지 응답의 nextCursor. 없으면 첫 페이지 */
  cursor: number | null;
}

function invalid(field: string, message: string): ApiException {
  return new ApiException('VALIDATION_FAILED', message, [{ field, message }]);
}

/**
 * (#515) `?limit=&cursor=` 원문 검사. limit 는 1~50(기본 20), cursor 는 양의 정수.
 * 빈 값은 생략과 같다. 전역 ValidationPipe 의 숫자 변환을 거치지 않도록 원문을 직접 읽는다 (id-param.ts 와 같은 이유)
 */
export function parsePageQuery(raw: {
  limit?: unknown;
  cursor?: unknown;
}): PageQuery {
  let limit = PAGE_LIMIT_DEFAULT;
  if (raw.limit !== undefined && raw.limit !== '') {
    const value =
      typeof raw.limit === 'string' && /^\d{1,3}$/.test(raw.limit)
        ? Number(raw.limit)
        : Number.NaN;
    if (!(value >= 1 && value <= PAGE_LIMIT_MAX))
      throw invalid('limit', `limit 는 1~${PAGE_LIMIT_MAX} 사이여야 해요`);
    limit = value;
  }
  let cursor: number | null = null;
  if (raw.cursor !== undefined && raw.cursor !== '') {
    if (
      typeof raw.cursor !== 'string' ||
      !/^[1-9]\d{0,9}$/.test(raw.cursor) ||
      Number(raw.cursor) > 2_147_483_647
    ) {
      throw invalid('cursor', 'cursor 는 양의 정수여야 해요');
    }
    cursor = Number(raw.cursor);
  }
  return { limit, cursor };
}

/** (#515) 검색어 `q`. 앞뒤 공백을 자르고 비면 null, 50자를 넘으면 400 */
export function parseSearchText(raw: unknown): string | null {
  if (raw === undefined || raw === '') return null;
  if (typeof raw !== 'string') throw invalid('q', '검색어를 확인해 주세요');
  const q = raw.trim();
  if (q.length > PAGE_QUERY_MAX)
    throw invalid('q', `검색어는 ${PAGE_QUERY_MAX}자까지예요`);
  return q === '' ? null : q;
}
