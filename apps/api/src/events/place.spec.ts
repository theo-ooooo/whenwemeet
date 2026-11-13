import {
  CLEARED_PLACE,
  exceptionPlaceFromColumns,
  parsePlace,
  placeColumns,
  placeFromColumns,
  placeLabel,
  placeProblem,
  samePlace,
  toPlaceView,
} from './place.js';

/** (#199) 장소 순수 함수 (D-242, D-243). 카카오가 준 이름, 주소, 좌표는 받지도 저장하지도 않는다 */
const PICKED = { text: null, query: '서울숲', kakaoPlaceId: '8209184' };
const FREE = { text: '할머니 댁', query: null, kakaoPlaceId: null };

describe('placeProblem', () => {
  it('생략, null, 직접 적은 글자, 고른 장소(ID + 검색어)는 통과', () => {
    expect(placeProblem(undefined)).toBeNull();
    expect(placeProblem(null)).toBeNull();
    expect(placeProblem({ text: '집' })).toBeNull();
    expect(placeProblem({ kakaoPlaceId: '1', query: '카페' })).toBeNull();
    expect(placeProblem({ kakaoPlaceId: '1', query: '카페', text: '우리 단골' })).toBeNull();
    expect(placeProblem({ text: '😀'.repeat(100) })).toBeNull();
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
    ['카카오 좌표(저장 금지)', { kakaoPlaceId: '1', query: 'a', lat: 37, lng: 127 }],
  ])('%s → 문구', (_label, value) => {
    expect(placeProblem(value)).toEqual(expect.any(String));
  });
});

describe('parsePlace, samePlace, toPlaceView, 열 변환', () => {
  it('앞뒤 공백을 자르고 빈 글자는 null, ID 가 없으면 검색어를 버린다', () => {
    expect(parsePlace(undefined)).toBeUndefined();
    expect(parsePlace(null)).toBeNull();
    expect(parsePlace({ text: ' 집 ', query: '무시' })).toEqual({ text: '집', query: null, kakaoPlaceId: null });
    expect(parsePlace({ kakaoPlaceId: '8209184', query: ' 서울숲 ', text: ' ' })).toEqual(PICKED);
  });

  it('null 과 CLEARED_PLACE 는 같은 "없음", 값 하나라도 다르면 다르다', () => {
    expect(samePlace(null, CLEARED_PLACE)).toBe(true);
    expect(samePlace(undefined, null)).toBe(true);
    expect(samePlace(PICKED, { ...PICKED })).toBe(true);
    expect(samePlace(PICKED, null)).toBe(false);
    expect(samePlace(PICKED, { ...PICKED, query: '숲' })).toBe(false);
    expect(samePlace(FREE, { ...FREE, text: '할머니댁' })).toBe(false);
  });

  it('응답: 카카오 ID 가 있으면 url, 없음은 null. 사용자 글자는 직접 적은 것, 없으면 검색어', () => {
    expect(toPlaceView(PICKED)).toEqual({ ...PICKED, url: 'https://place.map.kakao.com/8209184' });
    expect(toPlaceView(FREE)?.url).toBeNull();
    expect(toPlaceView(CLEARED_PLACE)).toBeNull();
    expect(toPlaceView(null)).toBeNull();
    expect(placeLabel(PICKED)).toBe('서울숲');
    expect(placeLabel({ ...PICKED, text: '단골' })).toBe('단골');
    expect(placeLabel(null)).toBeNull();
  });

  it('열 ↔ 값. 예외 셋 다 null 은 원본(null), text "" 만이면 이 회차만 없음', () => {
    const columns = placeColumns(PICKED);
    expect(columns).toEqual({ placeId: '8209184', placeQuery: '서울숲', placeText: null });
    expect(placeFromColumns(columns)).toEqual(PICKED);
    expect(placeFromColumns(placeColumns(null))).toBeNull();
    expect(exceptionPlaceFromColumns(placeColumns(null))).toBeNull();
    expect(exceptionPlaceFromColumns(placeColumns(CLEARED_PLACE))).toBe(CLEARED_PLACE);
    expect(exceptionPlaceFromColumns(placeColumns(FREE))).toEqual(FREE);
  });
});
