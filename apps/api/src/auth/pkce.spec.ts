import {
  CODE_CHALLENGE_LENGTH,
  HANDOFF_LENGTH,
  randomToken,
  s256Challenge,
  sha256hex,
} from './pkce.js';

describe('pkce', () => {
  it('randomToken 은 base64url 43자이고 매번 다르다', () => {
    const a = randomToken();
    expect(a).toMatch(new RegExp(`^[A-Za-z0-9_-]{${HANDOFF_LENGTH}}$`));
    expect(randomToken()).not.toBe(a);
  });

  it('sha256hex 는 64자 소문자 hex', () => {
    expect(sha256hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('s256Challenge 는 RFC 7636 부록 B 예시와 같다', () => {
    const challenge = s256Challenge(
      'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk',
    );
    expect(challenge).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
    expect(challenge).toHaveLength(CODE_CHALLENGE_LENGTH);
  });
});
