import { createHash } from 'node:crypto';
import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import {
  type FetchFn,
  fakeSearch,
  FAKE_PLACES,
  type PlaceCandidate,
  PlaceSearchError,
  type PlaceSearchProvider,
  PLACE_SEARCH_TIMEOUT_MS,
  UnavailablePlaceProvider,
} from './place-search.provider.js';

/** (D-259) 네이버 장소 검색 공급자 주입 토큰. 구현은 NAVER API HUB 지역 검색(운영), 가짜(로컬, 테스트), 미설정(운영에 키 없음) */
export const NAVER_PLACE_SEARCH_PROVIDER = Symbol(
  'NAVER_PLACE_SEARCH_PROVIDER',
);

/** NAVER API HUB 지역 검색 (네이버 검색 > 지역). 테스트는 NAVER_SEARCH_URL 로 가짜 서버를 가리킨다 */
export const NAVER_LOCAL_URL =
  'https://naverapihub.apigw.ntruss.com/search/v1/local';
/** 한 번에 받는 후보 수. 네이버 지역 검색 최대 5. 다시 찾을 때 같은 목록이 오게 고정 */
export const NAVER_RESULT_SIZE = 5;

interface NaverItem {
  title?: unknown;
  category?: unknown;
  address?: unknown;
  roadAddress?: unknown;
  mapx?: unknown;
  mapy?: unknown;
}

const text = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

/** 검색어 강조 태그(<b>)를 지우고 HTML 엔티티를 되돌린다 ("<b>서울숲</b>" → "서울숲", "&amp;" → "&") */
export function plainText(value: string): string {
  return value
    .replace(/<[^>]*>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
      if (code[0] === '#') {
        const n =
          code[1] === 'x' || code[1] === 'X'
            ? parseInt(code.slice(2), 16)
            : parseInt(code.slice(1), 10);
        return Number.isFinite(n) && n > 0 && n <= 0x10ffff
          ? String.fromCodePoint(n)
          : whole;
      }
      return ENTITIES[code.toLowerCase()] ?? whole;
    })
    .trim();
}

/**
 * (D-259) 네이버 장소 식별 키. 네이버 지역 검색은 고정 ID 를 주지 않아 이름 + 주소(도로명, 없으면 지번)의 sha256 앞 16자로 만든다.
 * 원문(이름, 주소)은 저장하지 않고 이 키만 저장한다. 다시 찾을 때 같은 검색어 결과에서 키가 같은 항목을 고른다
 */
export function naverPlaceKey(name: string, address: string | null): string {
  return createHash('sha256')
    .update(`${name}\n${address ?? ''}`)
    .digest('hex')
    .slice(0, 16);
}

/** 네이버 항목 하나 → 후보. 좌표는 WGS84 x 1e7 정수 문자열 (mapx = 경도, mapy = 위도). 이름, 좌표가 이상하면 버린다 */
export function toNaverCandidate(item: NaverItem): PlaceCandidate | null {
  const name = plainText(text(item.title)).slice(0, 100);
  const lng = Number(text(item.mapx)) / 1e7;
  const lat = Number(text(item.mapy)) / 1e7;
  if (
    !name ||
    !text(item.mapx) ||
    !text(item.mapy) ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    Math.abs(lat) > 90 ||
    Math.abs(lng) > 180
  )
    return null;
  const address =
    (plainText(text(item.roadAddress)) || plainText(text(item.address))).slice(
      0,
      200,
    ) || null;
  const category =
    plainText(text(item.category)).split('>').pop()?.trim() || null;
  return {
    provider: 'naver',
    kakaoPlaceId: null,
    naverKey: naverPlaceKey(name, address),
    name,
    address,
    lat,
    lng,
    category,
  };
}

/** NAVER API HUB 지역 검색. 키는 서버에만 (X-NCP-APIGW-API-KEY-ID, X-NCP-APIGW-API-KEY). 검색어 말고 사용자 정보는 보내지 않는다 */
export class NaverLocalPlaceProvider implements PlaceSearchProvider {
  readonly kind = 'naver' as const;

  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly fetchFn: FetchFn = (...args) => fetch(...args),
    private readonly baseUrl: string = NAVER_LOCAL_URL,
  ) {}

  async search(query: string): Promise<PlaceCandidate[]> {
    const params = new URLSearchParams({
      query,
      display: String(NAVER_RESULT_SIZE),
      start: '1',
      sort: 'random',
    });
    let response: Response;
    try {
      response = await this.fetchFn(`${this.baseUrl}?${params.toString()}`, {
        headers: {
          'X-NCP-APIGW-API-KEY-ID': this.clientId,
          'X-NCP-APIGW-API-KEY': this.clientSecret,
        },
        signal: AbortSignal.timeout(PLACE_SEARCH_TIMEOUT_MS),
      });
    } catch {
      throw new PlaceSearchError(null);
    }
    if (!response.ok) throw new PlaceSearchError(response.status);
    const body = (await response.json().catch(() => null)) as {
      items?: unknown;
    } | null;
    if (!body || !Array.isArray(body.items))
      throw new PlaceSearchError(response.status);
    const seen = new Set<string>();
    // 같은 이름 + 주소(같은 키)는 하나만 (다시 찾을 때 고를 수 있게)
    return body.items.flatMap((item: NaverItem) => {
      const c = toNaverCandidate(item);
      if (!c || seen.has(c.naverKey!)) return [];
      seen.add(c.naverKey!);
      return [c];
    });
  }
}

const naver = (
  name: string,
  address: string,
  lat: number,
  lng: number,
  category: string | null,
): PlaceCandidate => ({
  provider: 'naver',
  kakaoPlaceId: null,
  naverKey: naverPlaceKey(name, address),
  name,
  address,
  lat,
  lng,
  category,
});

/** 가짜 네이버 목록 (카카오 가짜 목록과 같은 곳, 주소는 네이버처럼 시도 전체 이름) */
export const FAKE_NAVER_PLACES: readonly PlaceCandidate[] = FAKE_PLACES.map(
  (p) =>
    naver(
      p.name,
      p.address!.replace(/^서울 /, '서울특별시 '),
      p.lat,
      p.lng,
      p.category,
    ),
);

export class FakeNaverPlaceProvider implements PlaceSearchProvider {
  readonly kind = 'fake' as const;

  async search(query: string): Promise<PlaceCandidate[]> {
    return fakeSearch(FAKE_NAVER_PLACES, query, (name) =>
      naver(name, '서울특별시 중구 세종대로 110', 37.5663, 126.9779, null),
    ).slice(0, NAVER_RESULT_SIZE);
  }
}

/**
 * NAVER_SEARCH_CLIENT_ID 와 NAVER_SEARCH_CLIENT_SECRET 이 둘 다 있으면 네이버, 없으면 운영은 미설정(503), 그 밖(로컬, 테스트)은 가짜.
 * PLACE_SEARCH_FAKE=1 이면 키가 있어도 가짜 (카카오와 같은 규칙, D-247)
 */
export function createNaverPlaceSearchProvider(
  config: ConfigService,
): PlaceSearchProvider {
  const id = config.get<string>('NAVER_SEARCH_CLIENT_ID')?.trim();
  const secret = config.get<string>('NAVER_SEARCH_CLIENT_SECRET')?.trim();
  const url = config.get<string>('NAVER_SEARCH_URL')?.trim() || NAVER_LOCAL_URL;
  const fake = config.get<string>('PLACE_SEARCH_FAKE') === '1';
  const production = config.get<string>('NODE_ENV') === 'production';
  let provider: PlaceSearchProvider;
  if (id && secret && !fake)
    provider = new NaverLocalPlaceProvider(id, secret, undefined, url);
  else if (production && !fake) provider = new UnavailablePlaceProvider();
  else provider = new FakeNaverPlaceProvider();
  new Logger('PlaceSearch').log(`네이버 장소 검색 공급자: ${provider.kind}`);
  return provider;
}
