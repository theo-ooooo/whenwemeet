import { createHash, createHmac, hkdfSync, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { isEmail } from 'class-validator';

/**
 * (#245) 이메일 로그인의 토큰, 코드, 해시, 이메일 정규화 (이메일-로그인.md 2장, 3장, D-110, D-112).
 * 모두 순수 함수. 키는 EmailLoginConfig 가 JWT_SECRET 에서 파생해 넘긴다
 */

/** 링크 토큰, 가입 티켓 모양. 32바이트 → base64url 43자 */
export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
/** 코드 모양. 6자리 숫자 */
export const CODE_PATTERN = /^\d{6}$/;
/** 정규화한 이메일 최대 길이 (AuthAccount.providerUserId 와 같음, D-110) */
export const EMAIL_MAX_LENGTH = 191;

/** HKDF info. 코드 해시 키와 IP 해시 키를 같은 비밀에서 나눠 만든다 */
export const CODE_KEY_INFO = 'wwm-email-code';
export const IP_KEY_INFO = 'wwm-email-ip';

/** 앞뒤 공백 제거 → 전체 소문자. 점, `+` 는 그대로 (Gmail 별칭을 합치지 않음, D-110) */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/** 정규화한 이메일이 받을 수 있는 모양인지. ASCII 만, `로컬@도메인.최상위`, 191자 이하 */
export function isAcceptableEmail(email: string): boolean {
  if (email.length === 0 || email.length > EMAIL_MAX_LENGTH) return false;
  if (!/^[\x21-\x7e]+$/.test(email)) return false;
  return isEmail(email, { allow_utf8_local_part: false, require_tld: true, allow_ip_domain: false, allow_display_name: false });
}

/** 확인 화면용 가린 이메일. 로컬 부분 앞 2자(2자 이하면 1자) + `***` + `@도메인` (6-4) */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at <= 0) return '***';
  const local = email.slice(0, at);
  const keep = local.length <= 2 ? 1 : 2;
  return `${local.slice(0, keep)}***${email.slice(at)}`;
}

/** 링크 토큰, 가입 티켓. 32바이트 랜덤 → base64url 43자 */
export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

/** 6자리 코드. 0 으로 채운다 (000123 도 나온다) */
export function newCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

export function sha256hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/** HKDF-SHA256(secret, info) 32바이트 (D-112). 소금은 비운다 (같은 비밀에서 늘 같은 키) */
export function deriveKey(secret: string, info: string): Buffer {
  return Buffer.from(hkdfSync('sha256', Buffer.from(secret, 'utf8'), Buffer.alloc(0), info, 32));
}

export function hmacHex(key: Buffer, value: string): string {
  return createHmac('sha256', key).update(value, 'utf8').digest('hex');
}

/** 코드 해시. 메일마다 다른 linkTokenHash 를 섞어 같은 코드도 메일마다 다른 해시가 된다 */
export function hashCode(key: Buffer, linkTokenHash: string, code: string): string {
  return hmacHex(key, `${linkTokenHash}:${code}`);
}

/** hex 해시끼리 상수 시간 비교. 길이가 다르면 false */
export function safeEqualHex(a: string, b: string): boolean {
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  return left.length === right.length && left.length > 0 && timingSafeEqual(left, right);
}

/** 임의 문자열 상수 시간 비교 (내부 키, 심사 이메일). 길이를 드러내지 않게 sha256 끼리 비교한다 */
export function safeEqualText(a: string, b: string): boolean {
  return timingSafeEqual(createHash('sha256').update(a, 'utf8').digest(), createHash('sha256').update(b, 'utf8').digest());
}
