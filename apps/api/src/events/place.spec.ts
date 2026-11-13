import {
  CLEARED_PLACE,
  exceptionPlaceFromColumns,
  parsePlace,
  placeColumns,
  placeFromColumns,
  placeProblem,
  samePlace,
  toPlaceView,
} from './place.js';

/** (#199) 장소 순수 함수 (D-242, D-243) */
const PICKED = { name: '서울숲', address: '서울 성동구 뚝섬로 273', lat: 37.5444, lng: 127.0374, kakaoPlaceId: '8209184' };

describe('placeProblem', () => {
  it('생략, null, 이름만, 고른 장소 전체는 통과', () => {
    expect(placeProblem(undefined)).toBeNull();
    expect(placeProblem(null)).toBeNull();
    expect(placeProblem({ name: '집' })).toBeNull();
    expect(placeProblem(PICKED)).toBeNull();
    expect(placeProblem({ name: '집', address: null, lat: null, lng: null, kakaoPlaceId: null })).toBeNull();
    expect(placeProblem({ name: '가'.repeat(100) })).toBeNull();
    expect(placeProblem({ name: '😀'.repeat(100) })).toBeNull();
  });

  it.each([
    ['문자열', '집'],
    ['배열', []],
    ['이름 없음', {}],
    ['이름 공백', { name: '  ' }],
    ['이름 101자', { name: '가'.repeat(101) }],
    ['주소 숫자', { name: '집', address: 1 }],
    ['주소 201자', { name: '집', address: '가'.repeat(201) }],
    ['경도 없음', { name: '집', lat: 1 }],
    ['위도 범위', { name: '집', lat: -90.1, lng: 0 }],
    ['경도 범위', { name: '집', lat: 0, lng: 180.5 }],
    ['좌표 문자열', { name: '집', lat: '1', lng: '2' }],
    ['좌표 NaN', { name: '집', lat: Number.NaN, lng: 1 }],
    ['ID 글자', { name: '집', kakaoPlaceId: '12a' }],
    ['ID 숫자형', { name: '집', kakaoPlaceId: 123 }],
    ['모르는 키', { name: '집', url: 'https://x' }],
  ])('%s → 문구', (_label, value) => {
    expect(placeProblem(value)).toEqual(expect.any(String));
  });
});

describe('parsePlace', () => {
  it('앞뒤 공백을 자르고 빈 주소는 null, 좌표가 반쪽이면 버린다', () => {
    expect(parsePlace(undefined)).toBeUndefined();
    expect(parsePlace(null)).toBeNull();
    expect(parsePlace({ name: ' 집 ', address: '  ' })).toEqual({ name: '집', address: null, lat: null, lng: null, kakaoPlaceId: null });
    expect(parsePlace({ ...PICKED, address: ` ${PICKED.address} ` })).toEqual(PICKED);
    expect(parsePlace({ name: '집', lat: 1 })).toMatchObject({ lat: null, lng: null });
  });
});

describe('samePlace, toPlaceView, 열 변환', () => {
  it('null 과 이름 "" 은 같은 "없음", 필드 하나라도 다르면 다르다', () => {
    expect(samePlace(null, CLEARED_PLACE)).toBe(true);
    expect(samePlace(undefined, null)).toBe(true);
    expect(samePlace(PICKED, { ...PICKED })).toBe(true);
    expect(samePlace(PICKED, null)).toBe(false);
    expect(samePlace(PICKED, { ...PICKED, lat: 37 })).toBe(false);
    expect(samePlace(PICKED, { ...PICKED, kakaoPlaceId: null })).toBe(false);
  });

  it('응답: 카카오 ID 가 있으면 url, 없음은 null', () => {
    expect(toPlaceView(PICKED)).toEqual({ ...PICKED, url: 'https://place.map.kakao.com/8209184' });
    expect(toPlaceView({ ...PICKED, kakaoPlaceId: null })?.url).toBeNull();
    expect(toPlaceView(CLEARED_PLACE)).toBeNull();
    expect(toPlaceView(null)).toBeNull();
  });

  it('열 ↔ 값. 예외 이름 null 은 원본(null), "" 는 이 회차만 없음', () => {
    const columns = placeColumns(PICKED);
    expect(columns).toEqual({ placeName: '서울숲', placeAddress: PICKED.address, placeLat: PICKED.lat, placeLng: PICKED.lng, placeKakaoId: '8209184' });
    expect(placeFromColumns(columns)).toEqual(PICKED);
    expect(placeFromColumns(placeColumns(null))).toBeNull();
    expect(exceptionPlaceFromColumns(placeColumns(null))).toBeNull();
    expect(exceptionPlaceFromColumns(placeColumns(CLEARED_PLACE))).toBe(CLEARED_PLACE);
    expect(exceptionPlaceFromColumns(columns)).toEqual(PICKED);
  });
});
