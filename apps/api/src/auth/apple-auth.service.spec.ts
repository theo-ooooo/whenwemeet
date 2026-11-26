import { ApiException } from '../common/errors.js';
import { APPLE_TEST_ENV } from '../testing/apple-keys.js';
import {
  APPLE_DEFAULT_NICKNAME,
  AppleAuthService,
  appleNickname,
} from './apple-auth.service.js';
import { sanitizeNext } from './next-path.js';
import { sha256hex } from './pkce.js';

const CC = 'c'.repeat(43);
const RAW_NONCE = 'n'.repeat(32);

describe('appleNickname', () => {
  it('한글은 성+이름 붙여 쓰고, 그 밖은 띄어 쓴다. 공백 정리, 20자, 없으면 기본값', () => {
    expect(appleNickname('김', '철수')).toBe('김철수');
    expect(appleNickname('Doe', ' John  Paul ')).toBe('Doe John Paul');
    expect(appleNickname(undefined, '철수')).toBe('철수');
    expect(appleNickname('', '')).toBe(APPLE_DEFAULT_NICKNAME);
    expect(appleNickname(1, null)).toBe(APPLE_DEFAULT_NICKNAME);
    expect(appleNickname('Abcdefghij', 'Klmnopqrstu')).toBe(
      'Abcdefghij Klmnopqrs',
    );
  });
});

describe('AppleAuthService', () => {
  const apple = {
    provider: 'APPLE' as const,
    assertConfigured: vi.fn(),
    bundleId: () => APPLE_TEST_ENV.APPLE_BUNDLE_ID,
    serviceId: () => APPLE_TEST_ENV.APPLE_SERVICE_ID,
    authorizeUrl: vi.fn(
      (state: string, nonce: string) =>
        `https://appleid.apple.com/auth/authorize?state=${state}&nonce=${nonce}`,
    ),
    verifyIdToken: vi.fn(),
    exchangeCode: vi.fn(),
  };
  const auth = {
    login: vi.fn(),
    signToken: vi.fn(async (id: number) => `jwt-${id}`),
    sanitizeNext,
  };
  const appAuth = {
    issueHandoff: vi.fn(async () => ({
      handoff: 'H'.repeat(43),
      expiresIn: 60,
    })),
  };
  const configValues: Record<string, string> = {
    WEB_ORIGIN: 'http://localhost:3000',
    APPLE_REDIRECT_URI: APPLE_TEST_ENV.APPLE_REDIRECT_URI,
  };
  const config = { getOrThrow: (key: string) => configValues[key] };
  const linkTickets = {
    verifyIntent: vi.fn(async (intent: unknown) =>
      intent === 'GOOD-INTENT' ? 5 : null,
    ),
    issue: vi.fn(async () => 'T'.repeat(43)),
  };
  let service: AppleAuthService;

  beforeEach(() => {
    apple.assertConfigured.mockReset();
    apple.authorizeUrl.mockClear();
    apple.verifyIdToken.mockReset().mockResolvedValue({ sub: 'sub-1' });
    apple.exchangeCode
      .mockReset()
      .mockResolvedValue({ idToken: 'EXCHANGED', refreshToken: 'RT' });
    auth.login.mockReset().mockResolvedValue({
      id: 8,
      nickname: 'x',
      profileImageUrl: null,
      createdAt: new Date(),
    });
    auth.signToken.mockClear();
    appAuth.issueHandoff.mockClear();
    linkTickets.issue.mockClear();
    service = new AppleAuthService(
      apple as never,
      auth as never,
      appAuth as never,
      config as never,
      linkTickets as never,
    );
  });

  describe('loginNative (앱.md 3.3)', () => {
    const input = {
      identityToken: 'IDT',
      authorizationCode: 'CODE',
      nonce: RAW_NONCE,
      nickname: ' 김철수 ',
      codeChallenge: CC,
    };

    it('identity token(aud=번들, nonce=sha256hex) → 코드 교환(client_id=번들) → 교환 토큰 검증 → login + refresh token → handoff', async () => {
      expect(await service.loginNative(input)).toEqual({
        handoff: 'H'.repeat(43),
        expiresIn: 60,
      });
      const nonce = sha256hex(RAW_NONCE);
      expect(apple.verifyIdToken).toHaveBeenNthCalledWith(1, 'IDT', {
        audience: APPLE_TEST_ENV.APPLE_BUNDLE_ID,
        nonce,
        nonceRequired: true,
      });
      expect(apple.exchangeCode).toHaveBeenCalledWith(
        'CODE',
        APPLE_TEST_ENV.APPLE_BUNDLE_ID,
      );
      expect(apple.verifyIdToken).toHaveBeenNthCalledWith(2, 'EXCHANGED', {
        audience: APPLE_TEST_ENV.APPLE_BUNDLE_ID,
        nonce,
        nonceRequired: false,
      });
      expect(auth.login).toHaveBeenCalledWith('APPLE', {
        providerUserId: 'sub-1',
        nickname: '김철수',
        profileImageUrl: null,
        email: null,
        raw: { sub: 'sub-1' },
        credentials: {
          providerClientId: APPLE_TEST_ENV.APPLE_BUNDLE_ID,
          refreshToken: 'RT',
        },
      });
      expect(appAuth.issueHandoff).toHaveBeenCalledWith(8, CC);
    });

    it('nickname 이 없으면 기본값, refresh token 이 없으면 credentials 없이', async () => {
      apple.exchangeCode.mockResolvedValue({
        idToken: 'EXCHANGED',
        refreshToken: null,
      });
      await service.loginNative({ ...input, nickname: undefined });
      const profile = auth.login.mock.calls[0][1];
      expect(profile.nickname).toBe(APPLE_DEFAULT_NICKNAME);
      expect(profile).not.toHaveProperty('credentials');
    });

    it('두 토큰의 sub 가 다르면 401, 로그인하지 않는다', async () => {
      apple.verifyIdToken
        .mockResolvedValueOnce({ sub: 'sub-1' })
        .mockResolvedValueOnce({ sub: 'sub-2' });
      await expect(service.loginNative(input)).rejects.toMatchObject({
        code: 'SOCIAL_TOKEN_INVALID',
      });
      expect(auth.login).not.toHaveBeenCalled();
    });

    it('identity token 이 틀리면 코드 교환을 하지 않는다. 미설정이면 503', async () => {
      apple.verifyIdToken.mockRejectedValue(
        new ApiException('SOCIAL_TOKEN_INVALID'),
      );
      await expect(service.loginNative(input)).rejects.toMatchObject({
        code: 'SOCIAL_TOKEN_INVALID',
      });
      expect(apple.exchangeCode).not.toHaveBeenCalled();

      apple.assertConfigured.mockImplementation(() => {
        throw new ApiException('APPLE_NOT_CONFIGURED');
      });
      await expect(service.loginNative(input)).rejects.toMatchObject({
        code: 'APPLE_NOT_CONFIGURED',
      });
    });
  });

  describe('start / parseState (앱.md 3.4)', () => {
    it('nonce 와 state(nonce, next) 를 만든다', () => {
      const { nonce, url } = service.start('/join/ABC123?auto=1');
      expect(nonce).toMatch(/^[0-9a-f]{64}$/);
      const state = new URL(url).searchParams.get('state')!;
      expect(JSON.parse(Buffer.from(state, 'base64url').toString())).toEqual({
        nonce,
        next: '/join/ABC123?auto=1',
      });
      expect(apple.authorizeUrl).toHaveBeenCalledWith(state, nonce);
      expect(service.parseState(state)).toEqual({
        nonce,
        next: '/join/ABC123?auto=1',
      });
    });

    it('next 는 규칙 밖이면 /', () => {
      const { nonce, url } = service.start('https://evil');
      expect(
        service.parseState(new URL(url).searchParams.get('state')!),
      ).toEqual({ nonce, next: '/' });
    });

    it('미설정이면 503', () => {
      apple.assertConfigured.mockImplementation(() => {
        throw new ApiException('APPLE_NOT_CONFIGURED');
      });
      expect(() => service.start('/')).toThrow(
        expect.objectContaining({ code: 'APPLE_NOT_CONFIGURED' }),
      );
    });

    it('깨진 state 는 null', () => {
      const enc = (value: unknown) =>
        Buffer.from(JSON.stringify(value)).toString('base64url');
      expect(service.parseState(undefined)).toBeNull();
      expect(service.parseState('@@')).toBeNull();
      expect(service.parseState(enc({ next: '/' }))).toBeNull();
      expect(service.parseState(enc({ nonce: 'n' }))).toEqual({
        nonce: 'n',
        next: '/',
      });
      // (#204) 배포 전에 만든 state 의 client, cc 는 무시한다
      expect(
        service.parseState(
          enc({ nonce: 'n', next: '/g/1', client: 'app', cc: CC }),
        ),
      ).toEqual({ nonce: 'n', next: '/g/1' });
    });
  });

  describe('completeWeb (앱.md 3.4)', () => {
    const stateOf = (value: object) =>
      Buffer.from(JSON.stringify(value)).toString('base64url');
    const webState = stateOf({ nonce: 'N', next: '/g/3' });

    it('web 성공: Service ID 로 교환(redirect_uri 포함) → id_token(aud=Service ID, nonce=state.nonce) → 웹 콜백 JWT', async () => {
      const location = await service.completeWeb({
        code: 'CODE',
        state: webState,
        cookieNonce: 'N',
        user: JSON.stringify({
          name: { firstName: '철수', lastName: '김' },
          email: 'x@y',
        }),
      });
      expect(location).toBe(
        'http://localhost:3000/auth/callback?token=jwt-8&next=%2Fg%2F3',
      );
      expect(apple.exchangeCode).toHaveBeenCalledWith(
        'CODE',
        APPLE_TEST_ENV.APPLE_SERVICE_ID,
        APPLE_TEST_ENV.APPLE_REDIRECT_URI,
      );
      expect(apple.verifyIdToken).toHaveBeenCalledWith('EXCHANGED', {
        audience: APPLE_TEST_ENV.APPLE_SERVICE_ID,
        nonce: 'N',
        nonceRequired: false,
      });
      expect(auth.login).toHaveBeenCalledWith(
        'APPLE',
        expect.objectContaining({
          nickname: '김철수',
          email: null,
          credentials: {
            providerClientId: APPLE_TEST_ENV.APPLE_SERVICE_ID,
            refreshToken: 'RT',
          },
        }),
      );
    });

    it('(#204) 옛 state(client=app, cc) 도 웹 콜백으로 돌아가고 handoff 를 만들지 않는다', async () => {
      const oldAppState = stateOf({
        nonce: 'N',
        next: '/join/ABC123?auto=1',
        client: 'app',
        cc: CC,
      });
      const location = await service.completeWeb({
        code: 'CODE',
        state: oldAppState,
        cookieNonce: 'N',
      });
      expect(location).toBe(
        'http://localhost:3000/auth/callback?token=jwt-8&next=%2Fjoin%2FABC123%3Fauto%3D1',
      );
      expect(appAuth.issueHandoff).not.toHaveBeenCalled();
    });

    it('user JSON 이 없거나 깨졌으면 기본 닉네임', async () => {
      await service.completeWeb({
        code: 'C',
        state: webState,
        cookieNonce: 'N',
        user: '{broken',
      });
      await service.completeWeb({
        code: 'C',
        state: webState,
        cookieNonce: 'N',
      });
      expect(auth.login.mock.calls.map((call) => call[1].nickname)).toEqual([
        APPLE_DEFAULT_NICKNAME,
        APPLE_DEFAULT_NICKNAME,
      ]);
    });

    it('state 불일치, 쿠키 없음, 깨진 state, code 없음 → 웹 로그인 화면 OAUTH_STATE', async () => {
      expect(
        await service.completeWeb({
          code: 'C',
          state: webState,
          cookieNonce: 'X',
        }),
      ).toBe('http://localhost:3000/login?error=OAUTH_STATE');
      expect(
        await service.completeWeb({
          code: 'C',
          state: webState,
          cookieNonce: null,
        }),
      ).toBe('http://localhost:3000/login?error=OAUTH_STATE');
      expect(
        await service.completeWeb({ code: 'C', state: '!!', cookieNonce: 'N' }),
      ).toBe('http://localhost:3000/login?error=OAUTH_STATE');
      expect(
        await service.completeWeb({ state: webState, cookieNonce: 'N' }),
      ).toBe('http://localhost:3000/login?error=OAUTH_STATE');
      expect(apple.exchangeCode).not.toHaveBeenCalled();
    });

    it('사용자 취소 → APPLE_CANCELLED, 그 밖의 Apple 오류 → APPLE_ERROR', async () => {
      expect(
        await service.completeWeb({
          state: webState,
          cookieNonce: 'N',
          error: 'user_cancelled_authorize',
        }),
      ).toBe('http://localhost:3000/login?error=APPLE_CANCELLED');
      expect(
        await service.completeWeb({
          state: webState,
          cookieNonce: 'N',
          error: 'invalid_request',
        }),
      ).toBe('http://localhost:3000/login?error=APPLE_ERROR');
    });

    describe('(#198) 연결 state(intent)', () => {
      const linkState = stateOf({
        nonce: 'N',
        next: '/me/accounts',
        intent: 'GOOD-INTENT',
      });

      it('로그인하지 않고 시작한 사용자에게 묶인 티켓만 만들어 /me/link 로', async () => {
        const location = await service.completeWeb({
          code: 'C',
          state: linkState,
          cookieNonce: 'N',
        });
        expect(location).toBe(
          `http://localhost:3000/me/link?ticket=${'T'.repeat(43)}&next=%2Fme%2Faccounts`,
        );
        expect(auth.login).not.toHaveBeenCalled();
        expect(auth.signToken).not.toHaveBeenCalledWith(5);
        expect(linkTickets.issue).toHaveBeenCalledWith(
          5,
          'APPLE',
          expect.objectContaining({
            providerUserId: 'sub-1',
            credentials: {
              providerClientId: APPLE_TEST_ENV.APPLE_SERVICE_ID,
              refreshToken: 'RT',
            },
          }),
        );
      });

      it('표식이 틀리면 교환하지 않고 LINK_TICKET_INVALID, 실패와 취소는 /me/link?error=', async () => {
        const bad = stateOf({
          nonce: 'N',
          next: '/me/accounts',
          intent: 'forged',
        });
        expect(
          await service.completeWeb({
            code: 'C',
            state: bad,
            cookieNonce: 'N',
          }),
        ).toBe(
          'http://localhost:3000/me/link?error=LINK_TICKET_INVALID&next=%2Fme%2Faccounts',
        );
        expect(apple.exchangeCode).not.toHaveBeenCalled();
        expect(
          await service.completeWeb({
            state: linkState,
            cookieNonce: 'N',
            error: 'user_cancelled_authorize',
          }),
        ).toBe(
          'http://localhost:3000/me/link?error=APPLE_CANCELLED&next=%2Fme%2Faccounts',
        );
        apple.exchangeCode.mockRejectedValueOnce(
          new ApiException('SOCIAL_TOKEN_INVALID'),
        );
        expect(
          await service.completeWeb({
            code: 'C',
            state: linkState,
            cookieNonce: 'N',
          }),
        ).toBe(
          'http://localhost:3000/me/link?error=SOCIAL_TOKEN_INVALID&next=%2Fme%2Faccounts',
        );
      });

      it('start 는 intent 를 state 에 싣고 parseState 가 돌려준다', () => {
        const { nonce, url } = service.start('/me/accounts', 'GOOD-INTENT');
        expect(
          service.parseState(new URL(url).searchParams.get('state')!),
        ).toEqual({ nonce, next: '/me/accounts', intent: 'GOOD-INTENT' });
      });
    });

    it('검증, 교환 실패는 그 코드로, 예상 밖 오류는 APPLE_ERROR 로 리다이렉트', async () => {
      apple.exchangeCode.mockRejectedValueOnce(
        new ApiException('SOCIAL_TOKEN_INVALID'),
      );
      expect(
        await service.completeWeb({
          code: 'C',
          state: webState,
          cookieNonce: 'N',
        }),
      ).toBe('http://localhost:3000/login?error=SOCIAL_TOKEN_INVALID');
      auth.login.mockRejectedValueOnce(new Error('db down'));
      expect(
        await service.completeWeb({
          code: 'C',
          state: webState,
          cookieNonce: 'N',
        }),
      ).toBe('http://localhost:3000/login?error=APPLE_ERROR');
      apple.assertConfigured.mockImplementation(() => {
        throw new ApiException('APPLE_NOT_CONFIGURED');
      });
      expect(
        await service.completeWeb({
          code: 'C',
          state: webState,
          cookieNonce: 'N',
        }),
      ).toBe('http://localhost:3000/login?error=APPLE_NOT_CONFIGURED');
    });
  });
});
