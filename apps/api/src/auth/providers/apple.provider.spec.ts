import { decodeProtectedHeader, jwtVerify } from 'jose';
import {
  APPLE_TEST_ENV,
  createAppleTestKeys,
  signAppleToken,
  type AppleTestKeys,
} from '../../testing/apple-keys.js';
import { urlOf } from '../../testing/fetch-url.js';
import {
  APPLE_AUTHORIZE_URL,
  APPLE_ENV_KEYS,
  APPLE_KEYS_URL,
  APPLE_REVOKE_URL,
  APPLE_TOKEN_URL,
  AppleProvider,
  createAppleJwks,
} from './apple.provider.js';

function configOf(values: Record<string, string | undefined>) {
  return {
    get: (key: string) => values[key],
    getOrThrow: (key: string) => {
      const value = values[key];
      if (!value) throw new Error(`${key} 없음`);
      return value;
    },
  } as never;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });

describe('AppleProvider', () => {
  let keys: AppleTestKeys;
  let env: Record<string, string>;
  const originalFetch = globalThis.fetch;
  const verifyNative = (
    provider: AppleProvider,
    token: string,
    nonce = 'nonce',
  ) =>
    provider.verifyIdToken(token, {
      audience: APPLE_TEST_ENV.APPLE_BUNDLE_ID,
      nonce,
      nonceRequired: true,
    });

  beforeAll(async () => {
    keys = await createAppleTestKeys();
  });

  beforeEach(() => {
    env = { ...APPLE_TEST_ENV, APPLE_PRIVATE_KEY: keys.p8 };
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  const provider = () => new AppleProvider(configOf(env), keys.jwks);

  it('설정 유무: 여섯 값이 모두 있어야 한다', () => {
    expect(provider().isConfigured()).toBe(true);
    for (const key of APPLE_ENV_KEYS) {
      const partial = new AppleProvider(
        configOf({ ...env, [key]: ' ' }),
        keys.jwks,
      );
      expect(partial.isConfigured(), key).toBe(false);
      expect(() => partial.assertConfigured()).toThrow(
        expect.objectContaining({ code: 'APPLE_NOT_CONFIGURED' }),
      );
    }
    expect(provider().bundleId()).toBe(APPLE_TEST_ENV.APPLE_BUNDLE_ID);
    expect(provider().serviceId()).toBe(APPLE_TEST_ENV.APPLE_SERVICE_ID);
  });

  it('운영 키 집합은 Apple JWKS 주소를 쓴다 (호출은 검증 때 지연)', () => {
    expect(typeof createAppleJwks()).toBe('function');
    expect(APPLE_KEYS_URL).toBe('https://appleid.apple.com/auth/keys');
  });

  it('authorizeUrl: Service ID, form_post, scope=name, state, nonce. 이메일은 요청하지 않는다', () => {
    const url = new URL(provider().authorizeUrl('STATE', 'NONCE'));
    expect(url.origin + url.pathname).toBe(APPLE_AUTHORIZE_URL);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: APPLE_TEST_ENV.APPLE_SERVICE_ID,
      redirect_uri: APPLE_TEST_ENV.APPLE_REDIRECT_URI,
      response_type: 'code',
      response_mode: 'form_post',
      scope: 'name',
      state: 'STATE',
      nonce: 'NONCE',
    });
    expect(() =>
      new AppleProvider(configOf({}), keys.jwks).authorizeUrl('s', 'n'),
    ).toThrow(expect.objectContaining({ code: 'APPLE_NOT_CONFIGURED' }));
  });

  describe('verifyIdToken (앱.md 3.2)', () => {
    it('정상 토큰은 sub 를 돌려준다. 이메일 클레임은 무시', async () => {
      const token = await signAppleToken(keys, {
        sub: 'sub-1',
        email: 'x@privaterelay.appleid.com',
      });
      expect(await verifyNative(provider(), token)).toEqual({ sub: 'sub-1' });
    });

    it('서명 위조(다른 키), 알 수 없는 kid → SOCIAL_TOKEN_INVALID', async () => {
      await expect(
        verifyNative(
          provider(),
          await signAppleToken(keys, { key: keys.foreignKey }),
        ),
      ).rejects.toMatchObject({ code: 'SOCIAL_TOKEN_INVALID' });
      await expect(
        verifyNative(provider(), await signAppleToken(keys, { kid: 'other' })),
      ).rejects.toMatchObject({ code: 'SOCIAL_TOKEN_INVALID' });
      await expect(verifyNative(provider(), 'not.a.jwt')).rejects.toMatchObject(
        { code: 'SOCIAL_TOKEN_INVALID' },
      );
    });

    it('iss 가 Apple 이 아니면 거절', async () => {
      await expect(
        verifyNative(
          provider(),
          await signAppleToken(keys, { iss: 'https://evil.example' }),
        ),
      ).rejects.toMatchObject({ code: 'SOCIAL_TOKEN_INVALID' });
    });

    it('aud 는 경로별 하나만: 네이티브에 Service ID 토큰, 웹에 번들 ID 토큰은 거절', async () => {
      const serviceToken = await signAppleToken(keys, {
        aud: APPLE_TEST_ENV.APPLE_SERVICE_ID,
      });
      await expect(
        verifyNative(provider(), serviceToken),
      ).rejects.toMatchObject({ code: 'SOCIAL_TOKEN_INVALID' });
      const bundleToken = await signAppleToken(keys, {
        aud: APPLE_TEST_ENV.APPLE_BUNDLE_ID,
      });
      await expect(
        provider().verifyIdToken(bundleToken, {
          audience: APPLE_TEST_ENV.APPLE_SERVICE_ID,
          nonce: 'nonce',
          nonceRequired: false,
        }),
      ).rejects.toMatchObject({ code: 'SOCIAL_TOKEN_INVALID' });
    });

    it('exp 는 60초 오차까지 허용, 넘으면 거절', async () => {
      const now = Math.floor(Date.now() / 1000);
      expect(
        await verifyNative(
          provider(),
          await signAppleToken(keys, { exp: now - 30 }),
        ),
      ).toEqual({ sub: expect.any(String) });
      await expect(
        verifyNative(
          provider(),
          await signAppleToken(keys, { exp: now - 120 }),
        ),
      ).rejects.toMatchObject({ code: 'SOCIAL_TOKEN_INVALID' });
    });

    it('RS256 외 알고리즘은 거절', async () => {
      const { generateKeyPair } = await import('jose');
      const ps = await generateKeyPair('PS256');
      await expect(
        verifyNative(
          provider(),
          await signAppleToken(keys, { alg: 'PS256', key: ps.privateKey }),
        ),
      ).rejects.toMatchObject({
        code: 'SOCIAL_TOKEN_INVALID',
      });
    });

    it('nonce: 다르면 거절, 필수 경로에서 없으면 거절', async () => {
      await expect(
        verifyNative(
          provider(),
          await signAppleToken(keys, { nonce: 'other' }),
        ),
      ).rejects.toMatchObject({ code: 'SOCIAL_TOKEN_INVALID' });
      await expect(
        verifyNative(provider(), await signAppleToken(keys, { nonce: null })),
      ).rejects.toMatchObject({ code: 'SOCIAL_TOKEN_INVALID' });
    });

    it('nonce 선택 경로(교환 id_token): 있으면 대조, 없으면 nonce_supported=false 일 때만 통과', async () => {
      const optional = (token: string) =>
        provider().verifyIdToken(token, {
          audience: APPLE_TEST_ENV.APPLE_BUNDLE_ID,
          nonce: 'nonce',
          nonceRequired: false,
        });
      expect(await optional(await signAppleToken(keys))).toEqual({
        sub: expect.any(String),
      });
      await expect(
        optional(await signAppleToken(keys, { nonce: 'other' })),
      ).rejects.toMatchObject({ code: 'SOCIAL_TOKEN_INVALID' });
      await expect(
        optional(await signAppleToken(keys, { nonce: null })),
      ).rejects.toMatchObject({ code: 'SOCIAL_TOKEN_INVALID' });
      await expect(
        optional(
          await signAppleToken(keys, { nonce: null, nonceSupported: true }),
        ),
      ).rejects.toMatchObject({ code: 'SOCIAL_TOKEN_INVALID' });
      expect(
        await optional(
          await signAppleToken(keys, { nonce: null, nonceSupported: false }),
        ),
      ).toEqual({ sub: expect.any(String) });
    });

    it('JWKS 조회 실패(네트워크, 비정상 응답) 는 502 APPLE_ERROR', async () => {
      const failing = new AppleProvider(configOf(env), (async () => {
        throw new TypeError('fetch failed');
      }) as never);
      await expect(
        verifyNative(failing, await signAppleToken(keys)),
      ).rejects.toMatchObject({ code: 'APPLE_ERROR' });
      const generic = new AppleProvider(configOf(env), (async () => {
        throw Object.assign(new Error('Expected 200 OK'), {
          code: 'ERR_JOSE_GENERIC',
        });
      }) as never);
      await expect(
        verifyNative(generic, await signAppleToken(keys)),
      ).rejects.toMatchObject({ code: 'APPLE_ERROR' });
    });
  });

  it('clientSecret: ES256, kid, iss=팀 ID, aud=Apple, sub=client_id, 5분. \\n 이스케이프된 키도 받는다', async () => {
    const secret = await provider().clientSecret('day.whenwemeet.web');
    expect(decodeProtectedHeader(secret)).toEqual({
      alg: 'ES256',
      kid: APPLE_TEST_ENV.APPLE_KEY_ID,
    });
    const { payload } = await jwtVerify(secret, keys.p8PublicKey, {
      algorithms: ['ES256'],
    });
    expect(payload).toMatchObject({
      iss: APPLE_TEST_ENV.APPLE_TEAM_ID,
      aud: 'https://appleid.apple.com',
      sub: 'day.whenwemeet.web',
    });
    expect(payload.exp! - payload.iat!).toBe(300);

    env.APPLE_PRIVATE_KEY = keys.p8.replace(/\n/g, '\\n');
    const escaped = await provider().clientSecret('x');
    await expect(jwtVerify(escaped, keys.p8PublicKey)).resolves.toBeTruthy();

    // 같은 인스턴스는 키를 한 번만 가져온다 (두 번째 호출도 성공)
    const same = provider();
    await same.clientSecret('a');
    await expect(same.clientSecret('b')).resolves.toEqual(expect.any(String));
  });

  it('clientSecret: 키가 깨졌으면 502 APPLE_ERROR, 고친 뒤에는 다시 가져온다', async () => {
    const config = {
      ...env,
      APPLE_PRIVATE_KEY:
        '-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----',
    };
    const broken = new AppleProvider(configOf(config), keys.jwks);
    await expect(broken.clientSecret('x')).rejects.toMatchObject({
      code: 'APPLE_ERROR',
    });
    await expect(broken.clientSecret('x')).rejects.toMatchObject({
      code: 'APPLE_ERROR',
    });
    config.APPLE_PRIVATE_KEY = keys.p8;
    await expect(broken.clientSecret('x')).resolves.toEqual(expect.any(String));
  });

  describe('exchangeCode (D-51)', () => {
    it('client_id, client_secret, code, grant_type 을 보내고 id_token 과 refresh_token 을 받는다. redirect_uri 는 넘길 때만', async () => {
      const fetchMock = vi.fn<typeof fetch>(async () =>
        json({ id_token: 'ID', refresh_token: 'RT', access_token: 'AT' }),
      );
      globalThis.fetch = fetchMock;
      expect(
        await provider().exchangeCode('CODE', 'day.whenwemeet.app'),
      ).toEqual({ idToken: 'ID', refreshToken: 'RT' });
      expect(urlOf(fetchMock.mock.calls[0][0])).toBe(APPLE_TOKEN_URL);
      const body = fetchMock.mock.calls[0][1]!.body as URLSearchParams;
      expect(body.get('client_id')).toBe('day.whenwemeet.app');
      expect(body.get('code')).toBe('CODE');
      expect(body.get('grant_type')).toBe('authorization_code');
      expect(body.has('redirect_uri')).toBe(false);
      const { payload } = await jwtVerify(
        body.get('client_secret')!,
        keys.p8PublicKey,
      );
      expect(payload.sub).toBe('day.whenwemeet.app');

      await provider().exchangeCode(
        'CODE',
        'day.whenwemeet.web',
        APPLE_TEST_ENV.APPLE_REDIRECT_URI,
      );
      expect(
        (fetchMock.mock.calls[1][1]!.body as URLSearchParams).get(
          'redirect_uri',
        ),
      ).toBe(APPLE_TEST_ENV.APPLE_REDIRECT_URI);
    });

    it('refresh_token 이 없으면 null', async () => {
      globalThis.fetch = vi.fn<typeof fetch>(async () =>
        json({ id_token: 'ID' }),
      );
      expect(await provider().exchangeCode('C', 'x')).toEqual({
        idToken: 'ID',
        refreshToken: null,
      });
    });

    it('invalid_grant → 401 SOCIAL_TOKEN_INVALID, 그 밖 실패와 id_token 없음과 네트워크 오류 → 502 APPLE_ERROR', async () => {
      globalThis.fetch = vi.fn<typeof fetch>(async () =>
        json({ error: 'invalid_grant' }, 400),
      );
      await expect(provider().exchangeCode('C', 'x')).rejects.toMatchObject({
        code: 'SOCIAL_TOKEN_INVALID',
      });
      globalThis.fetch = vi.fn<typeof fetch>(async () =>
        json({ error: 'invalid_client' }, 400),
      );
      await expect(provider().exchangeCode('C', 'x')).rejects.toMatchObject({
        code: 'APPLE_ERROR',
      });
      globalThis.fetch = vi.fn<typeof fetch>(
        async () => new Response('down', { status: 503 }),
      );
      await expect(provider().exchangeCode('C', 'x')).rejects.toMatchObject({
        code: 'APPLE_ERROR',
      });
      globalThis.fetch = vi.fn<typeof fetch>(async () =>
        json({ refresh_token: 'RT' }),
      );
      await expect(provider().exchangeCode('C', 'x')).rejects.toMatchObject({
        code: 'APPLE_ERROR',
      });
      globalThis.fetch = vi.fn<typeof fetch>(async () => {
        throw new TypeError('fetch failed');
      });
      await expect(provider().exchangeCode('C', 'x')).rejects.toMatchObject({
        code: 'APPLE_ERROR',
      });
    });

    it('미설정이면 Apple 을 부르지 않고 503', async () => {
      const fetchMock = vi.fn<typeof fetch>();
      globalThis.fetch = fetchMock;
      await expect(
        new AppleProvider(configOf({}), keys.jwks).exchangeCode('C', 'x'),
      ).rejects.toMatchObject({ code: 'APPLE_NOT_CONFIGURED' });
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('unlink = 토큰 폐기 (앱.md 3.5)', () => {
    const account = {
      providerUserId: 'sub-1',
      providerClientId: 'day.whenwemeet.app',
      refreshToken: 'RT',
    };

    it('저장된 client_id 와 refresh token 으로 /auth/revoke', async () => {
      const fetchMock = vi.fn<typeof fetch>(
        async () => new Response(null, { status: 200 }),
      );
      globalThis.fetch = fetchMock;
      await provider().unlink(account);
      expect(urlOf(fetchMock.mock.calls[0][0])).toBe(APPLE_REVOKE_URL);
      const body = fetchMock.mock.calls[0][1]!.body as URLSearchParams;
      expect(body.get('client_id')).toBe('day.whenwemeet.app');
      expect(body.get('token')).toBe('RT');
      expect(body.get('token_type_hint')).toBe('refresh_token');
      const { payload } = await jwtVerify(
        body.get('client_secret')!,
        keys.p8PublicKey,
      );
      expect(payload.sub).toBe('day.whenwemeet.app');
    });

    it('400 invalid_grant 는 이미 폐기된 것으로 보고 성공', async () => {
      globalThis.fetch = vi.fn<typeof fetch>(async () =>
        json({ error: 'invalid_grant' }, 400),
      );
      await expect(provider().unlink(account)).resolves.toBeUndefined();
    });

    it('그 밖의 실패는 502 APPLE_ERROR', async () => {
      globalThis.fetch = vi.fn<typeof fetch>(async () =>
        json({ error: 'invalid_client' }, 400),
      );
      await expect(provider().unlink(account)).rejects.toMatchObject({
        code: 'APPLE_ERROR',
      });
      globalThis.fetch = vi.fn<typeof fetch>(
        async () => new Response('x', { status: 500 }),
      );
      await expect(provider().unlink(account)).rejects.toMatchObject({
        code: 'APPLE_ERROR',
      });
    });

    it('refresh token 이나 client_id 가 없으면 Apple 을 부르지 않고 건너뜀 (설정이 없어도)', async () => {
      const fetchMock = vi.fn<typeof fetch>();
      globalThis.fetch = fetchMock;
      const unconfigured = new AppleProvider(configOf({}), keys.jwks);
      await expect(
        unconfigured.unlink({ ...account, refreshToken: null }),
      ).resolves.toBeUndefined();
      await expect(
        unconfigured.unlink({ ...account, providerClientId: null }),
      ).resolves.toBeUndefined();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('refresh token 이 있는데 미설정이면 503 APPLE_NOT_CONFIGURED', async () => {
      await expect(
        new AppleProvider(configOf({}), keys.jwks).unlink(account),
      ).rejects.toMatchObject({ code: 'APPLE_NOT_CONFIGURED' });
    });
  });
});
