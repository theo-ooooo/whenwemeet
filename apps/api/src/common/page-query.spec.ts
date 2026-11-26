import { parsePageQuery, parseSearchText } from './page-query.js';

describe('parsePageQuery, parseSearchText (#515)', () => {
  it('기본 20, 1~50, cursor 는 양의 정수', () => {
    expect(parsePageQuery({})).toEqual({ limit: 20, cursor: null });
    expect(parsePageQuery({ limit: '', cursor: '' })).toEqual({
      limit: 20,
      cursor: null,
    });
    expect(parsePageQuery({ limit: '50', cursor: '12' })).toEqual({
      limit: 50,
      cursor: 12,
    });
    for (const limit of ['0', '51', '-1', '1.5', 'abc'])
      expect(() => parsePageQuery({ limit })).toThrow();
    for (const cursor of ['0', '01', '-3', '1e3', '9999999999'])
      expect(() => parsePageQuery({ cursor })).toThrow();
  });

  it('검색어는 자르고 비면 null, 50자 초과는 400', () => {
    expect(parseSearchText(undefined)).toBeNull();
    expect(parseSearchText('  ')).toBeNull();
    expect(parseSearchText(' 하늘 ')).toBe('하늘');
    expect(() => parseSearchText('가'.repeat(51))).toThrow();
    expect(() => parseSearchText(['a'])).toThrow();
  });
});
