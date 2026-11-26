import { randomInt } from 'node:crypto';

/** 혼동 문자(0 O 1 I) 를 뺀 알파벳 (api.md 2.2) */
export const INVITE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const INVITE_CODE_LENGTH = 6;
export const INVITE_CODE_PATTERN = new RegExp(
  `^[${INVITE_ALPHABET}]{${INVITE_CODE_LENGTH}}$`,
);

export function generateInviteCode(): string {
  let code = '';
  for (let i = 0; i < INVITE_CODE_LENGTH; i += 1) {
    code += INVITE_ALPHABET[randomInt(INVITE_ALPHABET.length)];
  }
  return code;
}

/** 입력은 대문자로 정규화. 공백은 제거 */
export function normalizeInviteCode(input: string): string {
  return input.replace(/\s+/g, '').toUpperCase();
}

/** Prisma 고유 제약 위반 (초대 코드 충돌, 멤버십 중복) */
export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === 'P2002'
  );
}
