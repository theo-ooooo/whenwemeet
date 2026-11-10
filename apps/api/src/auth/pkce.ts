import { createHash, randomBytes } from 'node:crypto';

/** handoff 토큰 길이. 32바이트 → base64url 43자 (앱.md 2.1) */
export const HANDOFF_LENGTH = 43;

/** PKCE S256 challenge 길이. sha256 32바이트 → base64url 43자 */
export const CODE_CHALLENGE_LENGTH = 43;

/** 32바이트 랜덤 → base64url 43자 */
export function randomToken(): string {
  return randomBytes(32).toString('base64url');
}

export function sha256hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/** PKCE S256: base64url(sha256(verifier)) (RFC 7636 4.2) */
export function s256Challenge(verifier: string): string {
  return createHash('sha256').update(verifier, 'ascii').digest('base64url');
}
