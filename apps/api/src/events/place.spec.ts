import {
  CLEARED_PLACE,
  exceptionPlaceFromColumns,
  parsePlace,
  placeColumns,
  placeFromColumns,
  placeLabel,
  placeProblem,
  placeProviderOf,
  samePlace,
  toPlaceView,
} from './place.js';

/** (#199) 장소 순수 함수 (D-242, D-243). 카카오가 준 이름, 주소, 좌표는 받지도 저장하지도 않는다 */
const PICKED = {
  text: null,
  query: '서울숲',
  kakaoPlaceId: '8209184',
  naverKey: null,
};
const FREE = {
  text: '할머니 댁',
  query: null,
  kakaoPlaceId: null,
  naverKey: null,
};
/** (D-259) 네이버로 고른 장소: 식별 키(이름 + 주소 해시) + 검색어 */
const NAVER = {
  text: null,
  query: '서울숲',
  kakaoPlaceId: null,
  naverKey: '0123456789abcdef',
};

describe('placeProblem', () => {
  it('생략, null, 직접 적은 글자, 고른 장소(ID + 검색어)는 통과', () => {
    expect(placeProblem(undefined)).toBeNull();
    expect(placeProblem(null)).toBeNull();
    expect(placeProblem({ text: '집' })).toBeNull();
    expect(placeProblem({ kakaoPlaceId: '1', query: '카페' })).toBeNull();
    expect(
      placeProblem({ kakaoPlaceId: '1', query: '카페', text: '우리 단골' }),
    ).toBeNull();
    expect(placeProblem({ text: '😀'.repeat(100) })).toBeNull();
    expect(
      placeProblem({ naverKey: '0123456789abcdef', query: '서울숲' }),
    ).toBeNull();
  });

  it.each([
    ['문자열', '집'],
    ['배열', []],
    ['빈 객체', {}],
    ['글자 공백', { text: '  ' }],
    ['글자 101자', { text: '가'.repeat(101) }],
    ['검색어 101자', { kakaoPlaceId: '1', query: '가'.repeat(101) }],
    ['글자 숫자', { text: 1 }],
    ['ID 만', { kakaoPlaceId: '1' }],
    ['ID 글자', { kakaoPlaceId: '12a', query: 'a' }],
    ['ID 숫자형', { kakaoPlaceId: 123, query: 'a' }],
    ['카카오 이름(저장 금지)', { text: '집', name: '카페' }],
    [
      '카카오 좌표(저장 금지)',
      { kakaoPlaceId: '1', query: 'a', lat: 37, lng: 127 },
    ],
    ['네이버 키만', { naverKey: '0123456789abcdef' }],
    ['네이버 키 대문자', { naverKey: '0123456789ABCDEF', query: 'a' }],
    ['네이버 키 길이', { naverKey: '0123', query: 'a' }],
    [
      '카카오 ID 와 네이버 키 둘 다',
      { kakaoPlaceId: '1', naverKey: '0123456789abcdef', query: 'a' },
    ],
    [
      '네이버 이름(저장 금지)',
      { naverKey: '0123456789abcdef', query: 'a', name: '서울숲' },
    ],
  ])('%s → 문구', (_label, value) => {
    expect(placeProblem(value)).toEqual(expect.any(String));
  });
});

describe('parsePlace, samePlace, toPlaceView, 열 변환', () => {
  it('앞뒤 공백을 자르고 빈 글자는 null, ID 가 없으면 검색어를 버린다', () => {
    expect(parsePlace(undefined)).toBeUndefined();
    expect(parsePlace(null)).toBeNull();
    expect(parsePlace({ text: ' 집 ', query: '무시' })).toEqual({
      text: '집',
      query: null,
      kakaoPlaceId: null,
      naverKey: null,
    });
    expect(
      parsePlace({ kakaoPlaceId: '8209184', query: ' 서울숲 ', text: ' ' }),
    ).toEqual(PICKED);
    expect(
      parsePlace({ naverKey: '0123456789abcdef', query: ' 서울숲 ' }),
    ).toEqual(NAVER);
  });

  it('null 과 CLEARED_PLACE 는 같은 "없음", 값 하나라도 다르면 다르다', () => {
    expect(samePlace(null, CLEARED_PLACE)).toBe(true);
    expect(samePlace(undefined, null)).toBe(true);
    expect(samePlace(PICKED, { ...PICKED })).toBe(true);
    expect(samePlace(PICKED, null)).toBe(false);
    expect(samePlace(PICKED, { ...PICKED, query: '숲' })).toBe(false);
    expect(samePlace(FREE, { ...FREE, text: '할머니댁' })).toBe(false);
    expect(samePlace(NAVER, { ...NAVER })).toBe(true);
    expect(samePlace(NAVER, { ...NAVER, naverKey: 'fedcba9876543210' })).toBe(
      false,
    );
  });

  it('응답: 카카오 ID 가 있으면 url, 없음은 null. 사용자 글자는 직접 적은 것, 없으면 검색어', () => {
    expect(toPlaceView(PICKED)).toEqual({
      ...PICKED,
      provider: 'kakao',
      url: 'https://place.map.kakao.com/8209184',
    });
    expect(toPlaceView(NAVER)).toEqual({
      ...NAVER,
      provider: 'naver',
      url: 'https://map.naver.com/p/search/%EC%84%9C%EC%9A%B8%EC%88%B2',
    });
    expect(toPlaceView(FREE)).toMatchObject({ provider: null, url: null });
    expect(placeProviderOf(NAVER)).toBe('naver');
    expect(placeLabel(NAVER)).toBe('서울숲');
    expect(toPlaceView(CLEARED_PLACE)).toBeNull();
    expect(toPlaceView(null)).toBeNull();
    expect(placeLabel(PICKED)).toBe('서울숲');
    expect(placeLabel({ ...PICKED, text: '단골' })).toBe('단골');
    expect(placeLabel(null)).toBeNull();
  });

  it('열 ↔ 값. 예외 셋 다 null 은 원본(null), text "" 만이면 이 회차만 없음', () => {
    const columns = placeColumns(PICKED);
    expect(columns).toEqual({
      placeId: '8209184',
      placeProvider: 'KAKAO',
      placeQuery: '서울숲',
      placeText: null,
    });
    expect(placeFromColumns(columns)).toEqual(PICKED);
    // D-259 이전 행: 출처 null + placeId 는 카카오
    expect(placeFromColumns({ ...columns, placeProvider: null })).toEqual(
      PICKED,
    );
    expect(placeColumns(NAVER)).toEqual({
      placeId: '0123456789abcdef',
      placeProvider: 'NAVER',
      placeQuery: '서울숲',
      placeText: null,
    });
    expect(placeFromColumns(placeColumns(NAVER))).toEqual(NAVER);
    expect(exceptionPlaceFromColumns(placeColumns(NAVER))).toEqual(NAVER);
    expect(placeColumns(FREE).placeProvider).toBeNull();
    expect(placeFromColumns(placeColumns(null))).toBeNull();
    expect(exceptionPlaceFromColumns(placeColumns(null))).toBeNull();
    expect(exceptionPlaceFromColumns(placeColumns(CLEARED_PLACE))).toBe(
      CLEARED_PLACE,
    );
    expect(exceptionPlaceFromColumns(placeColumns(FREE))).toEqual(FREE);
  });
});
