import { randomInt } from 'node:crypto';

/**
 * (#311) 팀, 일정 공개 코드. 주소(`?team=<코드>`, `/events/<코드>`), 알림, 위젯에서 내부 번호 대신 쓴다.
 * 혼동 글자(0 o 1 l)를 뺀 소문자 영숫자 8자 (32^8 ≈ 1.1조). 초대 코드와 다르고 아무 권한도 주지 않는다 (멤버십 검사는 그대로).
 * 마이그레이션 `20261112120000_public_codes` 의 백필도 같은 알파벳을 쓴다
 */
export const PUBLIC_CODE_ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';
export const PUBLIC_CODE_LENGTH = 8;
/** 입력 검사는 느슨하게 소문자 영숫자 8자. 열 비교가 대소문자를 가리지 않아(utf8mb4_0900_ai_ci) 대문자는 소문자로 맞춰 받는다 */
export const PUBLIC_CODE_PATTERN = /^[a-z0-9]{8}$/;

export function generatePublicCode(): string {
  let code = '';
  for (let i = 0; i < PUBLIC_CODE_LENGTH; i += 1)
    code += PUBLIC_CODE_ALPHABET[randomInt(PUBLIC_CODE_ALPHABET.length)];
  return code;
}

/** 경로 파라미터의 공개 코드. 모양이 틀리면 null (호출자가 404 로) */
export function parsePublicCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const code = raw.trim().toLowerCase();
  return PUBLIC_CODE_PATTERN.test(code) ? code : null;
}
