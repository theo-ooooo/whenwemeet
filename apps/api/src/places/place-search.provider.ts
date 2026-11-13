import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';

/** (#199) 장소 검색 공급자 주입 토큰 (설계 장소-검색.md). 구현은 카카오 로컬(운영), 가짜(로컬, 테스트), 미설정(운영에 키 없음) */
export const PLACE_SEARCH_PROVIDER = Symbol('PLACE_SEARCH_PROVIDER');
export type FetchFn = typeof fetch;

/** 카카오 로컬 키워드 검색 (https://developers.kakao.com/docs/latest/ko/local/dev-guide#search-by-keyword) */
export const KAKAO_KEYWORD_URL = 'https://dapi.kakao.com/v2/local/search/keyword.json';
/** 한 번에 받는 후보 수 (카카오 최대 15). 다시 찾을 때(resolve) 같은 검색어로 같은 목록이 오게 한 값으로 고정 */
export const PLACE_RESULT_SIZE = 15;
/** 카카오 요청 제한 시간. 재시도 없음 */
export const PLACE_SEARCH_TIMEOUT_MS = 5_000;

/** 장소 검색 출처 (D-259). 웹은 내 정보의 지도 선택으로 고른다. 없으면 카카오 (옛 웹 호환) */
export type PlaceSource = 'kakao' | 'naver';

/**
 * 검색 후보 하나. 고르면 일정 본문 place 에 식별자(카카오 ID 또는 네이버 키)와 검색어만 싣는다.
 * provider 가 kakao 면 kakaoPlaceId, naver 면 naverKey 가 있다 (나머지 하나는 null)
 */
export interface PlaceCandidate {
  provider: PlaceSource;
  kakaoPlaceId: string | null;
  /** (D-259) 네이버는 고정 장소 ID 를 주지 않아 이름 + 주소의 해시로 만든 식별 키 (naver-place-search.provider.ts) */
  naverKey: string | null;
  name: string;
  /** 도로명 주소, 없으면 지번 주소. 둘 다 없으면 null */
  address: string | null;
  lat: number;
  lng: number;
  /** 카카오 분류의 마지막 조각 ("카페", "치과"). 없으면 null */
  category: string | null;
}

export interface PlaceSearchProvider {
  /** 공급자 이름 (로그용) */
  readonly kind: 'kakao' | 'naver' | 'fake' | 'unavailable';
  search(query: string): Promise<PlaceCandidate[]>;
}

/** 카카오 호출 실패 (네트워크, 시간 초과, 4xx/5xx, 응답 형식) */
export class PlaceSearchError extends Error {
  constructor(readonly httpStatus: number | null) {
    super(`장소 검색 실패: ${httpStatus ?? '-'}`);
    this.name = 'PlaceSearchError';
  }
}

/** 키가 없어 쓸 수 없음 (운영에서 KAKAO_REST_API_KEY 또는 NAVER_SEARCH_CLIENT_ID/SECRET 미설정) */
export class PlaceSearchUnavailableError extends Error {
  constructor() {
    super('장소 검색이 설정되지 않았어요');
    this.name = 'PlaceSearchUnavailableError';
  }
}

interface KakaoDocument {
  id?: unknown;
  place_name?: unknown;
  category_name?: unknown;
  address_name?: unknown;
  road_address_name?: unknown;
  x?: unknown;
  y?: unknown;
}

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

/** 카카오 문서 하나 → 후보. 필수 값(ID, 이름, 좌표)이 이상하면 버린다 */
export function toCandidate(doc: KakaoDocument): PlaceCandidate | null {
  const id = text(doc.id);
  const name = text(doc.place_name).slice(0, 100);
  const lng = Number(doc.x);
  const lat = Number(doc.y);
  if (!/^\d{1,20}$/.test(id) || !name || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  const address = (text(doc.road_address_name) || text(doc.address_name)).slice(0, 200) || null;
  const category = text(doc.category_name).split('>').pop()?.trim() || null;
  return { provider: 'kakao', kakaoPlaceId: id, naverKey: null, name, address, lat, lng, category };
}

/** 카카오 로컬 REST API. 키는 서버에만 (Authorization: KakaoAK). 검색어 말고 사용자 정보는 보내지 않는다 */
export class KakaoLocalPlaceProvider implements PlaceSearchProvider {
  readonly kind = 'kakao' as const;

  constructor(
    private readonly restApiKey: string,
    private readonly fetchFn: FetchFn = (...args) => fetch(...args),
  ) {}

  async search(query: string): Promise<PlaceCandidate[]> {
    const url = `${KAKAO_KEYWORD_URL}?${new URLSearchParams({ query, size: String(PLACE_RESULT_SIZE) }).toString()}`;
    let response: Response;
    try {
      response = await this.fetchFn(url, {
        headers: { Authorization: `KakaoAK ${this.restApiKey}` },
        signal: AbortSignal.timeout(PLACE_SEARCH_TIMEOUT_MS),
      });
    } catch {
      throw new PlaceSearchError(null);
    }
    if (!response.ok) throw new PlaceSearchError(response.status);
    const body = (await response.json().catch(() => null)) as { documents?: unknown } | null;
    if (!body || !Array.isArray(body.documents)) throw new PlaceSearchError(response.status);
    return body.documents.flatMap((doc: KakaoDocument) => toCandidate(doc) ?? []);
  }
}

/** 가짜 장소 (로컬 개발, 테스트). 검색어가 이름에 들어간 것만, 없으면 "<검색어> 본점" 하나를 만든다 */
const kakao = (kakaoPlaceId: string, name: string, address: string, lat: number, lng: number, category: string | null): PlaceCandidate => ({
  provider: 'kakao',
  kakaoPlaceId,
  naverKey: null,
  name,
  address,
  lat,
  lng,
  category,
});

export const FAKE_PLACES: readonly PlaceCandidate[] = [
  kakao('27531028', '카페 온화 성수점', '서울 성동구 연무장길 12', 37.5428, 127.0565, '카페'),
  kakao('8209184', '서울숲', '서울 성동구 뚝섬로 273', 37.5444, 127.0374, '공원'),
  kakao('10808237', '미소치과의원', '서울 마포구 양화로 160', 37.5569, 126.9237, '치과'),
  kakao('17733090', '을지로 노가리골목', '서울 중구 을지로13길 19', 37.5662, 126.9915, '술집'),
  kakao('11043640', '롯데월드', '서울 송파구 올림픽로 240', 37.5111, 127.0982, '테마파크'),
];

/** 가짜 목록에서 찾기. 이름이나 분류가 맞는 것, 없으면 make 로 "<검색어> 본점" 하나 */
export function fakeSearch(list: readonly PlaceCandidate[], query: string, make: (name: string) => PlaceCandidate): PlaceCandidate[] {
  const q = query.toLowerCase();
  const hits = list.filter((place) => place.name.toLowerCase().includes(q) || (place.category ?? '').includes(query));
  return hits.length > 0 ? [...hits] : [make(`${query.slice(0, 90)} 본점`)];
}

export class FakePlaceProvider implements PlaceSearchProvider {
  readonly kind = 'fake' as const;

  async search(query: string): Promise<PlaceCandidate[]> {
    return fakeSearch(FAKE_PLACES, query, (name) => kakao('99999999', name, '서울 중구 세종대로 110', 37.5663, 126.9779, null));
  }
}

export class UnavailablePlaceProvider implements PlaceSearchProvider {
  readonly kind = 'unavailable' as const;

  search(): Promise<PlaceCandidate[]> {
    return Promise.reject(new PlaceSearchUnavailableError());
  }
}

/**
 * KAKAO_REST_API_KEY 가 있으면 카카오, 없으면 운영은 미설정(503, 웹은 직접 입력으로), 그 밖(로컬, 테스트)은 가짜 (D-247).
 * PLACE_SEARCH_FAKE=1 이면 키가 있어도 가짜 (로컬에서 쿼터를 쓰지 않게)
 */
export function createPlaceSearchProvider(config: ConfigService): PlaceSearchProvider {
  const key = config.get<string>('KAKAO_REST_API_KEY')?.trim();
  const fake = config.get<string>('PLACE_SEARCH_FAKE') === '1';
  const production = config.get<string>('NODE_ENV') === 'production';
  let provider: PlaceSearchProvider;
  if (key && !fake) provider = new KakaoLocalPlaceProvider(key);
  else if (production && !fake) provider = new UnavailablePlaceProvider();
  else provider = new FakePlaceProvider();
  new Logger('PlaceSearch').log(`카카오 장소 검색 공급자: ${provider.kind}`);
  return provider;
}
