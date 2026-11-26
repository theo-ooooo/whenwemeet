import { NEXT_MAX_LENGTH, sanitizeNext } from './next-path.js';

describe('sanitizeNext (로그인 next 검증, D-41)', () => {
  it.each([
    ['/', '/'],
    ['/join/ABC123', '/join/ABC123'],
    ['/g/x_y-z/calendar', '/g/x_y-z/calendar'],
    ['/join/ABC123?auto=1', '/join/ABC123?auto=1'],
    ['/g/3?date=2026-11-12', '/g/3?date=2026-11-12'],
    [
      '/g/3/calendar?date=2026-11-12&view=month',
      '/g/3/calendar?date=2026-11-12&view=month',
    ],
    // 비ASCII 는 퍼센트 인코딩된 꼴로만
    ['/g/3/free?q=%ED%95%9C%EA%B8%80', '/g/3/free?q=%ED%95%9C%EA%B8%80'],
    // 쿼리 안의 / 는 출처를 바꾸지 못하므로 허용
    ['/login?next=/g/3', '/login?next=/g/3'],
    // fragment 는 버린다
    ['/g/3?date=2026-11-12#top', '/g/3?date=2026-11-12'],
    ['/g/3#top', '/g/3'],
    // 빈 쿼리는 경로만
    ['/g/3?', '/g/3'],
  ])('허용: %s → %s', (raw, expected) => {
    expect(sanitizeNext(raw)).toBe(expected);
  });

  it.each([
    // 다른 출처로 나가는 꼴
    '//evil.example',
    '//evil',
    '///evil.example',
    '//evil.example?x=1',
    '/\\evil.example',
    '\\\\evil.example',
    '\\/evil.example',
    'https://evil.example',
    'http:/evil.example',
    'javascript:alert(1)',
    'data:text/html,hi',
    'evil.example/path',
    'g/3',
    '?a=1',
    // 인코딩 우회
    '/%2F%2Fevil.example',
    '/%2f%2fevil.example',
    '/%5Cevil.example',
    '/%5cevil.example',
    '/g/3?x=%5C',
    '/g/3?x=%5c',
    '/g/3?x=%0D%0ASet-Cookie:a=b',
    '/g/3?x=%00',
    '/g/3?x=%7F',
    '/g/3?x=%',
    '/g/3?x=%zz',
    '/g/3?x=%2',
    // 제어문자, 공백, 역슬래시 원문
    '/g/3\r\nLocation: https://evil.example',
    '/g/3?x=1\nSet-Cookie:a',
    '/\t/evil.example',
    '/g/3?x=a b',
    '/g/3?x=a\\b',
    '/g /3',
    // 경로 정규화나 HTML 특수문자
    '/../evil',
    '/g/./3',
    '/g/3?x=<script>',
    '/g/3?x="a"',
    "/g/3?x='a'",
    '/g/3?x=a?b',
    // 비ASCII 원문
    '/g/3?q=한글',
    '/한글',
    // 형식
    '',
    undefined,
    null,
    123,
    ['/g/3'],
    { toString: () => '/g/3' },
  ])('거절 → /: %j', (raw) => {
    expect(sanitizeNext(raw)).toBe('/');
  });

  it(`길이는 ${NEXT_MAX_LENGTH}자까지`, () => {
    const ok = `/g/3?x=${'a'.repeat(NEXT_MAX_LENGTH - 7)}`;
    expect(ok).toHaveLength(NEXT_MAX_LENGTH);
    expect(sanitizeNext(ok)).toBe(ok);
    expect(sanitizeNext(`${ok}a`)).toBe('/');
    // fragment 를 버리기 전 원문 길이로 판단
    expect(sanitizeNext(`/g/3#${'a'.repeat(NEXT_MAX_LENGTH)}`)).toBe('/');
  });
});
