import { fakeConfig } from '../testing/fake-config.js';
import { urlOf } from '../testing/fetch-url.js';
import {
  createNaverPlaceSearchProvider,
  FakeNaverPlaceProvider,
  NAVER_LOCAL_URL,
  NaverLocalPlaceProvider,
  naverPlaceKey,
  plainText,
  toNaverCandidate,
} from './naver-place-search.provider.js';
import { PlaceSearchError } from './place-search.provider.js';

/** (D-259) 네이버 지역 검색 공급자. fetch 목. 응답 예는 2026-11-13 실제 응답 모양 */
const ITEM = {
  title: '<b>서울숲</b>',
  link: '',
  category: '여행,명소>숲,숲길',
  description: '',
  telephone: '',
  address: '서울특별시 성동구 성수동1가 678-1',
  roadAddress: '서울특별시 성동구 뚝섬로 273',
  mapx: '1270385663',
  mapy: '375419644',
};

const respond = (status: number, body: unknown) =>
  vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status }));

describe('plainText, naverPlaceKey', () => {
  it('강조 태그를 지우고 엔티티를 되돌린다', () => {
    expect(plainText('<b>서울숲</b>')).toBe('서울숲');
    expect(plainText('서울바쿠테 성수본점 국밥&amp;쌀국수')).toBe(
      '서울바쿠테 성수본점 국밥&쌀국수',
    );
    expect(plainText('A&lt;B&gt; &quot;C&quot; &#39;D&#x27; &apos;')).toBe(
      `A<B> "C" 'D' '`,
    );
    expect(plainText('&unknown; &#0;')).toBe('&unknown; &#0;');
  });

  it('키는 이름 + 주소의 sha256 앞 16자 (원문이 아님, 같은 입력은 같은 키)', () => {
    const key = naverPlaceKey('서울숲', '서울특별시 성동구 뚝섬로 273');
    expect(key).toMatch(/^[0-9a-f]{16}$/);
    expect(key).toBe(naverPlaceKey('서울숲', '서울특별시 성동구 뚝섬로 273'));
    expect(key).not.toBe(naverPlaceKey('서울숲', null));
    expect(key).not.toBe(
      naverPlaceKey('서울숲 ', '서울특별시 성동구 뚝섬로 273'),
    );
  });
});

describe('toNaverCandidate', () => {
  it('제목 태그 제거, 도로명 주소 우선, 분류 마지막 조각, 좌표는 mapx/1e7 = 경도, mapy/1e7 = 위도', () => {
    expect(toNaverCandidate(ITEM)).toEqual({
      provider: 'naver',
      kakaoPlaceId: null,
      naverKey: naverPlaceKey('서울숲', '서울특별시 성동구 뚝섬로 273'),
      name: '서울숲',
      address: '서울특별시 성동구 뚝섬로 273',
      lat: 37.5419644,
      lng: 127.0385663,
      category: '숲,숲길',
    });
    expect(toNaverCandidate({ ...ITEM, roadAddress: '' })?.address).toBe(
      '서울특별시 성동구 성수동1가 678-1',
    );
    expect(
      toNaverCandidate({ ...ITEM, roadAddress: '', address: '', category: '' }),
    ).toMatchObject({ address: null, category: null });
  });

  it('이름, 좌표가 이상하면 버린다', () => {
    expect(toNaverCandidate({ ...ITEM, title: '<b></b>' })).toBeNull();
    expect(toNaverCandidate({ ...ITEM, mapx: '' })).toBeNull();
    expect(toNaverCandidate({ ...ITEM, mapy: 'abc' })).toBeNull();
    expect(toNaverCandidate({ ...ITEM, mapy: '995419644' })).toBeNull();
  });
});

describe('NaverLocalPlaceProvider', () => {
  it('키 헤더 둘, query/display=5/start=1/sort=random 만 보낸다. 이상한 항목과 같은 키 중복은 건너뛴다', async () => {
    const fetchFn = respond(200, { items: [ITEM, { title: '' }, ITEM] });
    const items = await new NaverLocalPlaceProvider(
      'id',
      'secret',
      fetchFn,
    ).search('서울 숲&');
    expect(items).toHaveLength(1);
    const [input, init] = fetchFn.mock.calls[0];
    const url = new URL(urlOf(input));
    expect(`${url.origin}${url.pathname}`).toBe(NAVER_LOCAL_URL);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      query: '서울 숲&',
      display: '5',
      start: '1',
      sort: 'random',
    });
    expect(init.headers).toEqual({
      'X-NCP-APIGW-API-KEY-ID': 'id',
      'X-NCP-APIGW-API-KEY': 'secret',
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('주소를 바꿀 수 있다 (테스트 가짜 서버)', async () => {
    const fetchFn = respond(200, { items: [] });
    await new NaverLocalPlaceProvider(
      'id',
      'secret',
      fetchFn,
      'http://127.0.0.1:1/local',
    ).search('a');
    expect(urlOf(fetchFn.mock.calls[0][0])).toMatch(
      /^http:\/\/127\.0\.0\.1:1\/local\?/,
    );
  });

  it('4xx/5xx(하루 한도 429 포함), 형식이 틀린 본문, 연결 실패는 PlaceSearchError', async () => {
    await expect(
      new NaverLocalPlaceProvider(
        'i',
        's',
        respond(429, { errorCode: '012' }),
      ).search('a'),
    ).rejects.toMatchObject({ httpStatus: 429 });
    await expect(
      new NaverLocalPlaceProvider('i', 's', respond(200, { nope: 1 })).search(
        'a',
      ),
    ).rejects.toBeInstanceOf(PlaceSearchError);
    await expect(
      new NaverLocalPlaceProvider(
        'i',
        's',
        vi.fn().mockRejectedValue(new TypeError('fetch failed')),
      ).search('a'),
    ).rejects.toMatchObject({ httpStatus: null });
  });
});

describe('가짜, 고르기', () => {
  it('가짜: 카카오 가짜와 같은 곳(네이버 주소 모양), 없으면 "<검색어> 본점", 최대 5개', async () => {
    const fake = new FakeNaverPlaceProvider();
    expect(await fake.search('서울숲')).toEqual([
      expect.objectContaining({
        provider: 'naver',
        name: '서울숲',
        address: '서울특별시 성동구 뚝섬로 273',
      }),
    ]);
    expect(await fake.search('없는곳')).toEqual([
      expect.objectContaining({
        name: '없는곳 본점',
        naverKey: expect.stringMatching(/^[0-9a-f]{16}$/),
      }),
    ]);
    expect((await fake.search('서울')).length).toBeLessThanOrEqual(5);
  });

  it('키 둘 다 있으면 네이버, 운영에 하나라도 없으면 미설정, 그 밖은 가짜. PLACE_SEARCH_FAKE=1 은 늘 가짜', () => {
    const keys = {
      NAVER_SEARCH_CLIENT_ID: 'i',
      NAVER_SEARCH_CLIENT_SECRET: 's',
    };
    expect(createNaverPlaceSearchProvider(fakeConfig(keys)).kind).toBe('naver');
    expect(
      createNaverPlaceSearchProvider(
        fakeConfig({ NODE_ENV: 'production', NAVER_SEARCH_CLIENT_ID: 'i' }),
      ).kind,
    ).toBe('unavailable');
    expect(
      createNaverPlaceSearchProvider(fakeConfig({ NODE_ENV: 'production' }))
        .kind,
    ).toBe('unavailable');
    expect(createNaverPlaceSearchProvider(fakeConfig({})).kind).toBe('fake');
    expect(
      createNaverPlaceSearchProvider(
        fakeConfig({ ...keys, PLACE_SEARCH_FAKE: '1', NODE_ENV: 'production' }),
      ).kind,
    ).toBe('fake');
  });
});
