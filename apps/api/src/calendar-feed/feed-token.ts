import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

/**
 * (#193) 구독 주소 토큰 (D-218). 모두 순수 함수, 키는 서비스가 JWT_SECRET 에서 HKDF 로 파생해 넘긴다 (D-112, D-157 과 같은 방식).
 * 토큰 = base64url(HMAC-SHA256(key, "<userId>:<groupId>:<salt>")) 43자 (256비트). DB 에는 소금과 sha256(토큰) 만 둔다.
 * DB 만 새어서는 주소를 만들 수 없고, 서버는 소금으로 같은 주소를 다시 보여 줄 수 있다 (복사할 때마다 재발급하지 않아도 된다)
 */

export const FEED_TOKEN_KEY_INFO = 'wwm-ics-feed';
export const FEED_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** 16바이트 랜덤 base64url 22자. 재발급 = 소금 교체 */
export function newFeedSalt(): string {
  return randomBytes(16).toString('base64url');
}

export function feedToken(
  key: Buffer,
  userId: number,
  groupId: number,
  salt: string,
): string {
  return createHmac('sha256', key)
    .update(`${userId}:${groupId}:${salt}`, 'utf8')
    .digest('base64url');
}

/** sha256 hex 64자. 공개 피드가 이 값으로 행을 찾는다 */
export function feedTokenHash(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** 형식이 맞는 토큰만 해시. 틀리면 null (DB 를 부르지 않는다) */
export function lookupHash(token: unknown): string | null {
  return typeof token === 'string' && FEED_TOKEN_PATTERN.test(token)
    ? feedTokenHash(token)
    : null;
}

/**
 * 찾은 행으로 다시 만든 토큰과 요청 토큰이 같은지 상수 시간 비교. 해시가 우연히 같거나,
 * JWT_SECRET 을 바꿔 옛 주소가 더는 이 소금에서 나오지 않으면 false
 */
export function tokenMatches(
  key: Buffer,
  row: { userId: number; groupId: number; tokenSalt: string },
  token: string,
): boolean {
  const expected = Buffer.from(
    feedToken(key, row.userId, row.groupId, row.tokenSalt),
    'utf8',
  );
  const given = Buffer.from(token, 'utf8');
  return expected.length === given.length && timingSafeEqual(expected, given);
}
