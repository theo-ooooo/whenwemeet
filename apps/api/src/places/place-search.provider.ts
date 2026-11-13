import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';

/** (#199) 장소 검색 공급자 주입 토큰 (설계 장소-검색.md). 구현은 카카오 로컬(운영), 가짜(로컬, 테스트), 미설정(운영에 키 없음) */
export const PLACE_SEARCH_PROVIDER = Symbol('PLACE_SEARCH_PROVIDER');
export type FetchFn = typeof fetch;

/** 카카오 로컬 키워드 검색 (https://developers.kakao.com/docs/latest/ko/local/dev-guide#search-by-keyword) */
export const KAKAO_KEYWORD_URL = 'https://dapi.kakao.com/v2/local/search/keyword.json';
/** 한 번에 받는 후보 수 (카카오 최대 15) */
export const PLACE_RESULT_SIZE = 10;
/** 카카오 요청 제한 시간. 재시도 없음 */
export const PLACE_SEARCH_TIMEOUT_MS = 5_000;

/** 검색 후보 하나. 고르면 일정 본문 place 에 그대로 싣는다 (url 은 빼고) */
export interface PlaceCandidate {
  kakaoPlaceId: string;
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
  readonly kind: 'kakao' | 'fake' | 'unavailable';
  search(query: string): Promise<PlaceCandidate[]>;
}

/** 카카오 호출 실패 (네트워크, 시간 초과, 4xx/5xx, 응답 형식) */
export class PlaceSearchError extends Error {
  constructor(readonly httpStatus: number | null) {
    super(`장소 검색 실패: ${httpStatus ?? '-'}`);
    this.name = 'PlaceSearchError';
  }
}

/** 키가 없어 쓸 수 없음 (운영에서 KAKAO_REST_API_KEY 미설정) */
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
  return { kakaoPlaceId: id, name, address, lat, lng, category };
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
export const FAKE_PLACES: readonly PlaceCandidate[] = [
  { kakaoPlaceId: '27531028', name: '카페 온화 성수점', address: '서울 성동구 연무장길 12', lat: 37.5428, lng: 127.0565, category: '카페' },
  { kakaoPlaceId: '8209184', name: '서울숲', address: '서울 성동구 뚝섬로 273', lat: 37.5444, lng: 127.0374, category: '공원' },
  { kakaoPlaceId: '10808237', name: '미소치과의원', address: '서울 마포구 양화로 160', lat: 37.5569, lng: 126.9237, category: '치과' },
  { kakaoPlaceId: '17733090', name: '을지로 노가리골목', address: '서울 중구 을지로13길 19', lat: 37.5662, lng: 126.9915, category: '술집' },
  { kakaoPlaceId: '11043640', name: '롯데월드', address: '서울 송파구 올림픽로 240', lat: 37.5111, lng: 127.0982, category: '테마파크' },
];

export class FakePlaceProvider implements PlaceSearchProvider {
  readonly kind = 'fake' as const;

  async search(query: string): Promise<PlaceCandidate[]> {
    const q = query.toLowerCase();
    const hits = FAKE_PLACES.filter((place) => place.name.toLowerCase().includes(q) || (place.category ?? '').includes(query));
    if (hits.length > 0) return hits;
    return [{ kakaoPlaceId: '99999999', name: `${query.slice(0, 90)} 본점`, address: '서울 중구 세종대로 110', lat: 37.5663, lng: 126.9779, category: null }];
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
  new Logger('PlaceSearch').log(`장소 검색 공급자: ${provider.kind}`);
  return provider;
}
