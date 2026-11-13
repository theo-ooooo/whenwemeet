import { fakeConfig } from '../testing/fake-config.js';
import { urlOf } from '../testing/fetch-url.js';
import {
  createPlaceSearchProvider,
  FakePlaceProvider,
  KAKAO_KEYWORD_URL,
  KakaoLocalPlaceProvider,
  PlaceSearchError,
  PlaceSearchUnavailableError,
  toCandidate,
  UnavailablePlaceProvider,
} from './place-search.provider.js';

/** (#199) 장소 검색 공급자 (D-247). 카카오는 fetch 목 */
const DOC = {
  id: '8209184',
  place_name: '서울숲',
  category_name: '여행 > 관광,명소 > 공원',
  address_name: '서울 성동구 성수동1가 678-1',
  road_address_name: '서울 성동구 뚝섬로 273',
  x: '127.0374',
  y: '37.5444',
  place_url: 'http://place.map.kakao.com/8209184',
};

const respond = (status: number, body: unknown) => vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status }));

describe('toCandidate', () => {
  it('도로명 주소 우선, 분류는 마지막 조각, 좌표는 숫자', () => {
    expect(toCandidate(DOC)).toEqual({ provider: 'kakao', kakaoPlaceId: '8209184', naverKey: null, name: '서울숲', address: '서울 성동구 뚝섬로 273', lat: 37.5444, lng: 127.0374, category: '공원' });
    expect(toCandidate({ ...DOC, road_address_name: '' })?.address).toBe('서울 성동구 성수동1가 678-1');
    expect(toCandidate({ ...DOC, road_address_name: '', address_name: '', category_name: '' })).toMatchObject({ address: null, category: null });
  });

  it('ID, 이름, 좌표가 이상하면 버린다', () => {
    expect(toCandidate({ ...DOC, id: 'x1' })).toBeNull();
    expect(toCandidate({ ...DOC, place_name: ' ' })).toBeNull();
    expect(toCandidate({ ...DOC, x: 'abc' })).toBeNull();
    expect(toCandidate({ ...DOC, y: '91' })).toBeNull();
  });
});

describe('KakaoLocalPlaceProvider', () => {
  it('KakaoAK 헤더, 검색어와 size 만 보낸다. 이상한 문서는 건너뛴다', async () => {
    const fetchFn = respond(200, { documents: [DOC, { id: 'bad' }] });
    const items = await new KakaoLocalPlaceProvider('rest-key', fetchFn).search('서울 숲&');
    expect(items).toHaveLength(1);
    const [input, init] = fetchFn.mock.calls[0];
    const url = new URL(urlOf(input));
    expect(`${url.origin}${url.pathname}`).toBe(KAKAO_KEYWORD_URL);
    expect(Object.fromEntries(url.searchParams)).toEqual({ query: '서울 숲&', size: '15' });
    expect(init.headers).toEqual({ Authorization: 'KakaoAK rest-key' });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('4xx/5xx, 형식이 틀린 본문, 연결 실패는 PlaceSearchError', async () => {
    await expect(new KakaoLocalPlaceProvider('k', respond(401, { msg: 'x' })).search('a')).rejects.toMatchObject({ httpStatus: 401 });
    await expect(new KakaoLocalPlaceProvider('k', respond(200, { nope: 1 })).search('a')).rejects.toBeInstanceOf(PlaceSearchError);
    await expect(new KakaoLocalPlaceProvider('k', vi.fn().mockRejectedValue(new TypeError('fetch failed'))).search('a')).rejects.toMatchObject({ httpStatus: null });
  });
});

describe('가짜, 미설정, 고르기', () => {
  it('가짜: 이름이나 분류가 맞는 것, 없으면 "<검색어> 본점" 하나', async () => {
    const fake = new FakePlaceProvider();
    expect((await fake.search('카페')).map((p) => p.name)).toEqual(['카페 온화 성수점']);
    expect((await fake.search('치과')).map((p) => p.name)).toEqual(['미소치과의원']);
    expect(await fake.search('없는곳')).toEqual([expect.objectContaining({ name: '없는곳 본점' })]);
  });

  it('미설정은 PlaceSearchUnavailableError', async () => {
    await expect(new UnavailablePlaceProvider().search()).rejects.toBeInstanceOf(PlaceSearchUnavailableError);
  });

  it('키가 있으면 카카오, 운영에 키가 없으면 미설정, 그 밖은 가짜. PLACE_SEARCH_FAKE=1 은 늘 가짜', () => {
    expect(createPlaceSearchProvider(fakeConfig({ KAKAO_REST_API_KEY: 'k' })).kind).toBe('kakao');
    expect(createPlaceSearchProvider(fakeConfig({ NODE_ENV: 'production' })).kind).toBe('unavailable');
    expect(createPlaceSearchProvider(fakeConfig({ NODE_ENV: 'production', KAKAO_REST_API_KEY: ' ' })).kind).toBe('unavailable');
    expect(createPlaceSearchProvider(fakeConfig({})).kind).toBe('fake');
    expect(createPlaceSearchProvider(fakeConfig({ KAKAO_REST_API_KEY: 'k', PLACE_SEARCH_FAKE: '1', NODE_ENV: 'production' })).kind).toBe('fake');
  });
});
