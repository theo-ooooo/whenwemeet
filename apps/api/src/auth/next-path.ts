/**
 * 로그인 후 돌아갈 웹 경로(next) 검증. 인증흐름.md 2단계, 결정기록 D-41 (#71).
 *
 * 같은 출처의 상대 경로 + 쿼리만 허용하고, 하나라도 어긋나면 `/` 로 바꾼다 (오픈 리다이렉트 방지).
 * - 길이 512자 이하 (fragment 포함 원문 기준)
 * - fragment(`#...`) 는 버린다
 * - 경로: `/` 하나로 시작, `//` 로 시작하면 거절. 글자는 `A-Z a-z 0-9 / _ -` 만 (`%`, `.`, `\`, 공백, 제어문자 불가 → `/%2F%2Fx`, `/%5Cx`, `/\x` 차단)
 * - 쿼리: ASCII 일부(`A-Z a-z 0-9 - . _ ~ % & = + , : ; @ /`) 만. `%` 는 반드시 `%XX` 꼴이고
 *   제어문자(`%00`~`%1F`, `%7F`)와 역슬래시(`%5C`) 인코딩은 거절. 비ASCII 는 퍼센트 인코딩된 형태로만 받는다
 */
export const NEXT_MAX_LENGTH = 512;

const NEXT_PATH = /^\/[A-Za-z0-9/_-]*$/;
const NEXT_QUERY = /^[A-Za-z0-9\-._~%&=+,:;@/]*$/;
const BROKEN_PERCENT = /%(?![0-9A-Fa-f]{2})/;
const FORBIDDEN_PERCENT = /%(?:[01][0-9A-Fa-f]|7[Ff]|5[Cc])/;

export function sanitizeNext(raw: unknown): string {
  if (
    typeof raw !== 'string' ||
    raw.length === 0 ||
    raw.length > NEXT_MAX_LENGTH
  )
    return '/';
  const hashAt = raw.indexOf('#');
  const target = hashAt < 0 ? raw : raw.slice(0, hashAt);
  const queryAt = target.indexOf('?');
  const path = queryAt < 0 ? target : target.slice(0, queryAt);
  const query = queryAt < 0 ? '' : target.slice(queryAt + 1);

  if (!NEXT_PATH.test(path) || path.startsWith('//')) return '/';
  if (!query) return path;
  if (
    !NEXT_QUERY.test(query) ||
    BROKEN_PERCENT.test(query) ||
    FORBIDDEN_PERCENT.test(query)
  )
    return '/';
  return `${path}?${query}`;
}
