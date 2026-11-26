import { ApiException } from '../common/errors.js';
import { FakeNaverPlaceProvider } from './naver-place-search.provider.js';
import {
  FakePlaceProvider,
  type PlaceSearchProvider,
  PlaceSearchError,
  PlaceSearchUnavailableError,
} from './place-search.provider.js';
import { PlacesService } from './places.service.js';

/** 카카오 공급자만 바꿔 끼운 서비스 (네이버는 가짜) */
const kakaoOnly = (provider: PlaceSearchProvider) =>
  new PlacesService(provider, new FakeNaverPlaceProvider());

/** (#199) 장소 검색 프록시 서비스: 검색어 검사, 오류 변환 */
const failing = (error: Error): PlaceSearchProvider => ({
  kind: 'kakao',
  search: () => Promise.reject(error),
});
const codeOf = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return { error: { code: (error as ApiException).code } };
  }
  return null;
};

describe('PlacesService', () => {
  it('검색어를 잘라 공급자에 넘기고 { items } 로 감싼다', async () => {
    const provider = new FakePlaceProvider();
    const spy = vi.spyOn(provider, 'search');
    const result = await kakaoOnly(provider).search('  서울숲 ');
    expect(spy).toHaveBeenCalledWith('서울숲');
    expect(result.items[0].name).toBe('서울숲');
  });

  it.each([[undefined], [''], ['  '], ['가'.repeat(51)], [['a']]])(
    '검색어 %j → VALIDATION_FAILED',
    async (q) => {
      expect(
        (await codeOf(kakaoOnly(new FakePlaceProvider()).search(q)))?.error
          .code,
      ).toBe('VALIDATION_FAILED');
    },
  );

  it('카카오 실패는 PLACE_SEARCH_FAILED(502), 미설정은 PLACE_SEARCH_NOT_CONFIGURED(503), 그 밖은 그대로', async () => {
    expect(
      (await codeOf(kakaoOnly(failing(new PlaceSearchError(500))).search('a')))
        ?.error.code,
    ).toBe('PLACE_SEARCH_FAILED');
    expect(
      (await codeOf(kakaoOnly(failing(new PlaceSearchError(null))).search('a')))
        ?.error.code,
    ).toBe('PLACE_SEARCH_FAILED');
    expect(
      (
        await codeOf(
          kakaoOnly(failing(new PlaceSearchUnavailableError())).search('a'),
        )
      )?.error.code,
    ).toBe('PLACE_SEARCH_NOT_CONFIGURED');
    await expect(
      kakaoOnly(failing(new RangeError('x'))).search('a'),
    ).rejects.toBeInstanceOf(RangeError);
  });

  it('resolve: 같은 검색어로 다시 찾아 ID 가 같은 결과 하나, 없으면 null. ID, 검색어 검사', async () => {
    const service = kakaoOnly(new FakePlaceProvider());
    expect((await service.resolve('8209184', '서울숲')).place).toMatchObject({
      name: '서울숲',
      lat: 37.5444,
    });
    expect((await service.resolve('1', '서울숲')).place).toBeNull();
    expect((await codeOf(service.resolve('abc', '서울숲')))?.error.code).toBe(
      'VALIDATION_FAILED',
    );
    expect((await codeOf(service.resolve('1', ' ')))?.error.code).toBe(
      'VALIDATION_FAILED',
    );
    expect(
      await kakaoOnly(failing(new PlaceSearchError(500))).resolveQuietly(
        'kakao',
        '1',
        'a',
      ),
    ).toBeNull();
  });

  it('같은 검색어는 5분 메모리 캐시 (DB 저장 없음), 지나면 다시 부른다. 오래된 것부터 500개까지', async () => {
    const provider = new FakePlaceProvider();
    const spy = vi.spyOn(provider, 'search');
    const service = kakaoOnly(provider);
    let now = 0;
    service.now = () => now;
    await service.search('서울숲');
    await service.resolve('8209184', '서울숲');
    expect(spy).toHaveBeenCalledTimes(1);
    now = 5 * 60 * 1000;
    await service.search('서울숲');
    expect(spy).toHaveBeenCalledTimes(2);
    for (let i = 0; i < 501; i++) await service.search(`곳${i}`);
    spy.mockClear();
    await service.search('서울숲');
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('(D-259) provider: 없으면 카카오, naver 면 네이버 공급자. 다른 값은 VALIDATION_FAILED(field provider)', async () => {
    const kakao = new FakePlaceProvider();
    const naver = new FakeNaverPlaceProvider();
    const kakaoSpy = vi.spyOn(kakao, 'search');
    const naverSpy = vi.spyOn(naver, 'search');
    const service = new PlacesService(kakao, naver);
    expect((await service.search('서울숲')).items[0]).toMatchObject({
      provider: 'kakao',
      kakaoPlaceId: '8209184',
      naverKey: null,
    });
    expect((await service.search('서울숲', '')).items[0].provider).toBe(
      'kakao',
    );
    const item = (await service.search('서울숲', 'naver')).items[0];
    expect(item).toMatchObject({
      provider: 'naver',
      kakaoPlaceId: null,
      name: '서울숲',
      address: '서울특별시 성동구 뚝섬로 273',
    });
    expect(item.naverKey).toMatch(/^[0-9a-f]{16}$/);
    expect(kakaoSpy).toHaveBeenCalledTimes(1);
    expect(naverSpy).toHaveBeenCalledTimes(1);
    const bad = await codeOf(service.search('서울숲', 'google'));
    expect(bad?.error.code).toBe('VALIDATION_FAILED');
  });

  it('(D-259) 네이버 resolve: 같은 검색어 결과에서 키가 같은 항목. 키 형식 검사, 카카오 ID 로는 못 찾는다. 캐시는 출처별', async () => {
    const naver = new FakeNaverPlaceProvider();
    const spy = vi.spyOn(naver, 'search');
    const service = new PlacesService(new FakePlaceProvider(), naver);
    const key = (await service.search('서울숲', 'naver')).items[0].naverKey!;
    expect((await service.resolve(key, '서울숲', 'naver')).place).toMatchObject(
      { name: '서울숲', lat: 37.5444 },
    );
    expect(spy).toHaveBeenCalledTimes(1);
    expect(
      (await service.resolve('fedcba9876543210', '서울숲', 'naver')).place,
    ).toBeNull();
    expect(
      (await codeOf(service.resolve('8209184', '서울숲', 'naver')))?.error.code,
    ).toBe('VALIDATION_FAILED');
    expect(
      (await codeOf(service.resolve(key, '서울숲', 'kakao')))?.error.code,
    ).toBe('VALIDATION_FAILED');
    expect((await service.resolveQuietly('naver', key, '서울숲'))?.name).toBe(
      '서울숲',
    );
    expect(
      await new PlacesService(
        new FakePlaceProvider(),
        failing(new PlaceSearchError(429)),
      ).resolveQuietly('naver', key, '서울숲'),
    ).toBeNull();
  });
});
