import { createHmac } from 'node:crypto';
import {
  CODE_KEY_INFO,
  deriveKey,
  hashCode,
  hmacHex,
  IP_KEY_INFO,
  isAcceptableEmail,
  maskEmail,
  newCode,
  newToken,
  normalizeEmail,
  safeEqualHex,
  safeEqualText,
  sha256hex,
  TOKEN_PATTERN,
} from './email-crypto.js';

describe('이메일 정규화, 검증 (D-110)', () => {
  it('앞뒤 공백 제거 + 소문자. 점과 + 는 그대로', () => {
    expect(normalizeEmail('  Kim.Theo+Cal@GMail.COM \n')).toBe('kim.theo+cal@gmail.com');
  });

  it('ASCII 로컬@도메인.최상위 만, 191자 경계', () => {
    expect(isAcceptableEmail('a@b.co')).toBe(true);
    expect(isAcceptableEmail('kim.theo+cal@gmail.com')).toBe(true);
    const local = 'a'.repeat(64);
    const domain = (n: number) => `${'b'.repeat(n)}.com`;
    // 64 + 1 + (domain) = 191 이 되도록 레이블을 63자 이하로 나눈다
    const at191 = `${local}@${'c'.repeat(60)}.${'d'.repeat(60)}.${'e'.repeat(2)}xy`;
    expect(at191.length).toBe(191);
    expect(isAcceptableEmail(at191)).toBe(true);
    expect(isAcceptableEmail(`${at191.slice(0, 66)}z${at191.slice(66)}`)).toBe(false);
    expect(isAcceptableEmail(`a@${domain(10)}`)).toBe(true);
    expect(isAcceptableEmail('')).toBe(false);
    expect(isAcceptableEmail('no-at.example.com')).toBe(false);
    expect(isAcceptableEmail('a@localhost')).toBe(false);
    expect(isAcceptableEmail('김@example.com')).toBe(false);
    expect(isAcceptableEmail('a@예시.한국')).toBe(false);
    expect(isAcceptableEmail('a b@example.com')).toBe(false);
    expect(isAcceptableEmail('a@[127.0.0.1]')).toBe(false);
    expect(isAcceptableEmail('Name <a@b.co>')).toBe(false);
  });

  it('가린 이메일: 앞 2자 (2자 이하면 1자) + *** + @도메인 (6-4)', () => {
    expect(maskEmail('kimtheo@gmail.com')).toBe('ki***@gmail.com');
    expect(maskEmail('abc@x.io')).toBe('ab***@x.io');
    expect(maskEmail('ab@x.io')).toBe('a***@x.io');
    expect(maskEmail('a@x.io')).toBe('a***@x.io');
    expect(maskEmail('broken')).toBe('***');
  });
});

describe('토큰, 코드, 해시 (D-112)', () => {
  it('토큰은 base64url 43자, 매번 다르다', () => {
    const a = newToken();
    expect(a).toMatch(TOKEN_PATTERN);
    expect(a).toHaveLength(43);
    expect(newToken()).not.toBe(a);
  });

  it('코드는 6자리 숫자, 0 으로 채운다', () => {
    for (let i = 0; i < 200; i += 1) expect(newCode()).toMatch(/^\d{6}$/);
  });

  it('작은 값도 0 으로 채운다 (randomInt 경계)', async () => {
    vi.resetModules();
    vi.doMock('node:crypto', async (importOriginal) => ({ ...(await importOriginal<typeof import('node:crypto')>()), randomInt: () => 42 }));
    const mod = await import('./email-crypto.js');
    expect(mod.newCode()).toBe('000042');
    vi.doUnmock('node:crypto');
    vi.resetModules();
  });

  it('sha256hex 는 64자 hex', () => {
    expect(sha256hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('HKDF 키는 비밀과 info 에 따라 결정적이고, 코드 키와 IP 키는 다르다', () => {
    const a = deriveKey('secret-0123456789', CODE_KEY_INFO);
    expect(a).toHaveLength(32);
    expect(deriveKey('secret-0123456789', CODE_KEY_INFO).equals(a)).toBe(true);
    expect(deriveKey('secret-0123456789', IP_KEY_INFO).equals(a)).toBe(false);
    expect(deriveKey('other-secret', CODE_KEY_INFO).equals(a)).toBe(false);
  });

  it('코드 해시 = HMAC(key, linkTokenHash:code). 같은 코드도 메일이 다르면 다른 해시', () => {
    const key = deriveKey('s', CODE_KEY_INFO);
    const h1 = sha256hex('token-1');
    expect(hashCode(key, h1, '123456')).toBe(createHmac('sha256', key).update(`${h1}:123456`).digest('hex'));
    expect(hashCode(key, h1, '123456')).toBe(hashCode(key, h1, '123456'));
    expect(hashCode(key, sha256hex('token-2'), '123456')).not.toBe(hashCode(key, h1, '123456'));
    expect(hashCode(key, h1, '123457')).not.toBe(hashCode(key, h1, '123456'));
    expect(hmacHex(key, '1.2.3.4')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('상수 시간 비교: 같으면 true, 다르거나 길이가 다르거나 비면 false', () => {
    const a = sha256hex('a');
    expect(safeEqualHex(a, a)).toBe(true);
    expect(safeEqualHex(a, sha256hex('b'))).toBe(false);
    expect(safeEqualHex(a, a.slice(0, 62))).toBe(false);
    expect(safeEqualHex('', '')).toBe(false);
    expect(safeEqualText('key', 'key')).toBe(true);
    expect(safeEqualText('key', 'key2')).toBe(false);
    expect(safeEqualText('', 'key')).toBe(false);
  });
});
