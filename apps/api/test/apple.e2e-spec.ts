import { createHash, randomBytes } from 'node:crypto';
import {
  APPLE_REVOKE_URL,
  APPLE_TOKEN_URL,
} from '../src/auth/providers/apple.provider.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  APPLE_TEST_ENV,
  createAppleTestKeys,
  signAppleToken,
  type AppleTestKeys,
} from '../src/testing/apple-keys.js';
import { urlOf } from '../src/testing/fetch-url.js';
import { api, createTestApp, resetDb, TestApp } from './helpers.js';

type FetchMock = ReturnType<typeof vi.fn<typeof fetch>>;

const APPLE_KEYS = Object.keys(APPLE_TEST_ENV).concat('APPLE_PRIVATE_KEY');
const sha256hex = (value: string): string =>
  createHash('sha256').update(value).digest('hex');

function pkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url');
  return {
    verifier,
    challenge: createHash('sha256').update(verifier).digest('base64url'),
  };
}

/** 앱.md 3.2 ~ 3.5: 애플 로그인(iOS 네이티브, 웹, Android) 과 탈퇴 시 폐기. Apple HTTP 는 목, JWKS 는 로컬 키 */
describe('애플 로그인 (e2e)', () => {
  let app: TestApp;
  let prisma: PrismaService;
  let keys: AppleTestKeys;
  const originalFetch = globalThis.fetch;

  /** Apple /auth/token 과 /auth/revoke 를 흉내 낸다. idToken 은 교환 응답의 id_token */
  function appleFetch(options: {
    idToken?: string;
    refreshToken?: string | null;
    tokenError?: string;
    revokeStatus?: number;
    revokeError?: string;
  }): FetchMock {
    return vi.fn<typeof fetch>(async (input) => {
      const url = urlOf(input);
      if (url === APPLE_TOKEN_URL) {
        if (options.tokenError)
          return Response.json({ error: options.tokenError }, { status: 400 });
        return Response.json({
          id_token: options.idToken,
          access_token: 'at',
          token_type: 'Bearer',
          expires_in: 3600,
          ...(options.refreshToken === null
            ? {}
            : { refresh_token: options.refreshToken ?? 'apple-refresh' }),
        });
      }
      if (url === APPLE_REVOKE_URL) {
        const status = options.revokeStatus ?? 200;
        return status === 200
          ? new Response(null, { status })
          : Response.json(
              { error: options.revokeError ?? 'invalid_client' },
              { status },
            );
      }
      throw new Error(`예상 밖 fetch: ${url}`);
    });
  }

  beforeAll(async () => {
    keys = await createAppleTestKeys();
    Object.assign(process.env, APPLE_TEST_ENV, { APPLE_PRIVATE_KEY: keys.p8 });
    app = await createTestApp({ appleJwks: keys.jwks });
    prisma = app.get(PrismaService);
    await resetDb(app);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  afterAll(async () => {
    await resetDb(app);
    await app.close();
    for (const key of APPLE_KEYS) process.env[key] = '';
  });

  async function nativeLogin(
    sub: string,
    overrides: {
      nickname?: string;
      exchangedSub?: string;
      tokenError?: string;
    } = {},
  ) {
    const rawNonce = randomBytes(16).toString('hex');
    const nonce = sha256hex(rawNonce);
    const { verifier, challenge } = pkcePair();
    const identityToken = await signAppleToken(keys, { sub, nonce });
    const exchanged = await signAppleToken(keys, {
      sub: overrides.exchangedSub ?? sub,
      nonce,
    });
    globalThis.fetch = appleFetch({
      idToken: exchanged,
      tokenError: overrides.tokenError,
    });
    const res = await api(app)
      .post('/v1/auth/apple/native')
      .send({
        identityToken,
        authorizationCode: 'auth-code',
        nonce: rawNonce,
        codeChallenge: challenge,
        ...(overrides.nickname ? { nickname: overrides.nickname } : {}),
      });
    return { res, verifier };
  }

  async function startWeb(query: Record<string, string> = {}) {
    const res = await api(app).get('/v1/auth/apple').query(query).expect(302);
    const setCookie = (res.headers['set-cookie'] as unknown as string[]).find(
      (c) => c.startsWith('wwm_apple_state='),
    )!;
    const location = new URL(res.headers.location);
    return {
      setCookie,
      cookie: setCookie.split(';')[0],
      state: location.searchParams.get('state')!,
      nonce: location.searchParams.get('nonce')!,
      location,
    };
  }

  it('iOS 네이티브: 검증 → 코드 교환 → handoff → 세션. refresh token 과 번들 ID 를 저장, 이메일은 저장 안 함', async () => {
    const { res, verifier } = await nativeLogin('apple.sub.0001', {
      nickname: '  애플유저  ',
    });
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.data).toEqual({
      handoff: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
      expiresIn: 60,
    });

    const tokenCall = (globalThis.fetch as FetchMock).mock.calls.find(
      ([input]) => urlOf(input) === APPLE_TOKEN_URL,
    )!;
    const body = tokenCall[1]!.body as URLSearchParams;
    expect(body.get('client_id')).toBe(APPLE_TEST_ENV.APPLE_BUNDLE_ID);
    expect(body.get('code')).toBe('auth-code');
    expect(body.has('redirect_uri')).toBe(false);

    const exchanged = await api(app)
      .post('/v1/auth/handoff')
      .send({ handoff: res.body.data.handoff, verifier })
      .expect(200);
    const me = await api(app)
      .get('/v1/me')
      .set({ Authorization: `Bearer ${exchanged.body.data.token}` })
      .expect(200);
    expect(me.body.data).toMatchObject({
      nickname: '애플유저',
      profileImageUrl: null,
    });

    const account = await prisma.authAccount.findUniqueOrThrow({
      where: {
        provider_providerUserId: {
          provider: 'APPLE',
          providerUserId: 'apple.sub.0001',
        },
      },
    });
    expect(account).toMatchObject({
      email: null,
      rawProfile: { sub: 'apple.sub.0001' },
      providerClientId: APPLE_TEST_ENV.APPLE_BUNDLE_ID,
      refreshToken: 'apple-refresh',
    });
    const groups = await api(app)
      .get('/v1/groups')
      .set({ Authorization: `Bearer ${exchanged.body.data.token}` })
      .expect(200);
    expect(groups.body.data.map((g: { type: string }) => g.type)).toEqual([
      'PERSONAL',
    ]);
  });

  it('네이티브 거절: 코드 재사용(invalid_grant), 두 토큰 sub 불일치, nonce 위반 → 401 SOCIAL_TOKEN_INVALID', async () => {
    const users = await prisma.user.count();
    const replay = await nativeLogin('apple.sub.0002', {
      tokenError: 'invalid_grant',
    });
    expect(replay.res.status).toBe(401);
    expect(replay.res.body.error.code).toBe('SOCIAL_TOKEN_INVALID');

    const mismatch = await nativeLogin('apple.sub.0002', {
      exchangedSub: 'someone.else',
    });
    expect(mismatch.res.status).toBe(401);

    const identityToken = await signAppleToken(keys, {
      sub: 'apple.sub.0002',
      nonce: sha256hex('x'.repeat(32)),
    });
    const badNonce = await api(app)
      .post('/v1/auth/apple/native')
      .send({
        identityToken,
        authorizationCode: 'c',
        nonce: 'y'.repeat(32),
        codeChallenge: pkcePair().challenge,
      })
      .expect(401);
    expect(badNonce.body.error.code).toBe('SOCIAL_TOKEN_INVALID');

    // 웹(Service ID) 용 토큰을 네이티브에 넣으면 aud 위반
    const nonce = 'z'.repeat(32);
    const webToken = await signAppleToken(keys, {
      sub: 'apple.sub.0002',
      nonce: sha256hex(nonce),
      aud: APPLE_TEST_ENV.APPLE_SERVICE_ID,
    });
    await api(app)
      .post('/v1/auth/apple/native')
      .send({
        identityToken: webToken,
        authorizationCode: 'c',
        nonce,
        codeChallenge: pkcePair().challenge,
      })
      .expect(401);
    expect(await prisma.user.count()).toBe(users);
  });

  it('웹: state 쿠키(SameSite=None, Secure) → form_post 콜백 → 웹 콜백 JWT. 같은 sub 면 iOS 와 같은 사용자', async () => {
    const { setCookie, cookie, state, nonce, location } = await startWeb({
      next: '/g/1?date=2026-11-12',
    });
    expect(setCookie).toMatch(
      /^wwm_apple_state=[0-9a-f]{64}; Max-Age=600; Path=\/v1\/auth\/apple; Expires=.+; HttpOnly; Secure; SameSite=None$/,
    );
    expect(location.origin + location.pathname).toBe(
      'https://appleid.apple.com/auth/authorize',
    );
    expect(location.searchParams.get('client_id')).toBe(
      APPLE_TEST_ENV.APPLE_SERVICE_ID,
    );
    expect(location.searchParams.get('response_mode')).toBe('form_post');
    expect(location.searchParams.get('scope')).toBe('name');
    expect(nonce).toBe(cookie.split('=')[1]);

    globalThis.fetch = appleFetch({
      idToken: await signAppleToken(keys, {
        sub: 'apple.sub.0001',
        nonce,
        aud: APPLE_TEST_ENV.APPLE_SERVICE_ID,
      }),
      refreshToken: 'web-refresh',
    });
    const res = await api(app)
      .post('/v1/auth/apple/callback')
      .type('form')
      .set('Cookie', cookie)
      .send({
        code: 'web-code',
        state,
        user: JSON.stringify({ name: { firstName: 'X', lastName: 'Y' } }),
      })
      .expect(302);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    const cleared = (res.headers['set-cookie'] as unknown as string[]).find(
      (c) => c.startsWith('wwm_apple_state='),
    );
    expect(cleared).toMatch(/Expires=Thu, 01 Jan 1970.*SameSite=None/);

    const back = new URL(res.headers.location);
    expect(back.origin + back.pathname).toBe(
      'http://localhost:3000/auth/callback',
    );
    expect(back.searchParams.get('next')).toBe('/g/1?date=2026-11-12');
    const me = await api(app)
      .get('/v1/me')
      .set({ Authorization: `Bearer ${back.searchParams.get('token')}` })
      .expect(200);
    // 이미 있는 사용자라 이름은 덮지 않고, refresh token 과 client_id 는 이번 것으로
    expect(me.body.data.nickname).toBe('애플유저');
    const account = await prisma.authAccount.findFirstOrThrow({
      where: { provider: 'APPLE', providerUserId: 'apple.sub.0001' },
    });
    expect(account).toMatchObject({
      providerClientId: APPLE_TEST_ENV.APPLE_SERVICE_ID,
      refreshToken: 'web-refresh',
    });

    const tokenBody = (globalThis.fetch as FetchMock).mock.calls[0][1]!
      .body as URLSearchParams;
    expect(tokenBody.get('client_id')).toBe(APPLE_TEST_ENV.APPLE_SERVICE_ID);
    expect(tokenBody.get('redirect_uri')).toBe(
      APPLE_TEST_ENV.APPLE_REDIRECT_URI,
    );
  });

  it('웹 신규 가입은 user JSON 의 이름으로 닉네임', async () => {
    const { cookie, state, nonce } = await startWeb();
    globalThis.fetch = appleFetch({
      idToken: await signAppleToken(keys, {
        sub: 'apple.sub.web',
        nonce,
        aud: APPLE_TEST_ENV.APPLE_SERVICE_ID,
      }),
    });
    const res = await api(app)
      .post('/v1/auth/apple/callback')
      .type('form')
      .set('Cookie', cookie)
      .send({
        code: 'c',
        state,
        user: JSON.stringify({ name: { firstName: '철수', lastName: '김' } }),
      })
      .expect(302);
    const token = new URL(res.headers.location).searchParams.get('token');
    expect(
      (
        await api(app)
          .get('/v1/me')
          .set({ Authorization: `Bearer ${token}` })
          .expect(200)
      ).body.data.nickname,
    ).toBe('김철수');
  });

  it('(#204) client=app, cc 는 더 받지 않는다: 무시하고 웹 콜백 JWT 로 돌아간다', async () => {
    const { cookie, state, nonce } = await startWeb({
      client: 'app',
      cc: pkcePair().challenge,
      next: '/join/ABC123?auto=1',
    });
    expect(JSON.parse(Buffer.from(state, 'base64url').toString())).toEqual({
      nonce,
      next: '/join/ABC123?auto=1',
    });
    globalThis.fetch = appleFetch({
      idToken: await signAppleToken(keys, {
        sub: 'apple.sub.android',
        nonce,
        aud: APPLE_TEST_ENV.APPLE_SERVICE_ID,
      }),
    });
    const res = await api(app)
      .post('/v1/auth/apple/callback')
      .type('form')
      .set('Cookie', cookie)
      .send({ code: 'c', state })
      .expect(302);
    const back = new URL(res.headers.location);
    expect(back.origin + back.pathname).toBe(
      'http://localhost:3000/auth/callback',
    );
    expect(back.searchParams.get('next')).toBe('/join/ABC123?auto=1');
  });

  it('콜백 실패: state 불일치 → OAUTH_STATE, 취소 → APPLE_CANCELLED, 교환 실패 → 코드', async () => {
    const first = await startWeb();
    const other = await startWeb();
    const mismatch = await api(app)
      .post('/v1/auth/apple/callback')
      .type('form')
      .set('Cookie', other.cookie)
      .send({ code: 'c', state: first.state })
      .expect(302);
    expect(mismatch.headers.location).toBe(
      'http://localhost:3000/login?error=OAUTH_STATE',
    );

    const cancelled = await api(app)
      .post('/v1/auth/apple/callback')
      .type('form')
      .set('Cookie', first.cookie)
      .send({ state: first.state, error: 'user_cancelled_authorize' })
      .expect(302);
    expect(cancelled.headers.location).toBe(
      'http://localhost:3000/login?error=APPLE_CANCELLED',
    );

    globalThis.fetch = appleFetch({ tokenError: 'invalid_grant' });
    const failed = await api(app)
      .post('/v1/auth/apple/callback')
      .type('form')
      .set('Cookie', first.cookie)
      .send({ code: 'used', state: first.state })
      .expect(302);
    expect(failed.headers.location).toBe(
      'http://localhost:3000/login?error=SOCIAL_TOKEN_INVALID',
    );

    // 서명 위조된 id_token
    globalThis.fetch = appleFetch({
      idToken: await signAppleToken(keys, {
        nonce: first.nonce,
        aud: APPLE_TEST_ENV.APPLE_SERVICE_ID,
        key: keys.foreignKey,
      }),
    });
    const forged = await api(app)
      .post('/v1/auth/apple/callback')
      .type('form')
      .set('Cookie', first.cookie)
      .send({ code: 'c', state: first.state })
      .expect(302);
    expect(forged.headers.location).toBe(
      'http://localhost:3000/login?error=SOCIAL_TOKEN_INVALID',
    );
  });

  describe('탈퇴 시 애플 토큰 폐기 (앱.md 3.5)', () => {
    async function appleSession(sub: string): Promise<string> {
      const { res, verifier } = await nativeLogin(sub);
      const exchanged = await api(app)
        .post('/v1/auth/handoff')
        .send({ handoff: res.body.data.handoff, verifier })
        .expect(200);
      return exchanged.body.data.token as string;
    }

    it('폐기 실패 → 502 APPLE_ERROR, 계정 그대로', async () => {
      const token = await appleSession('apple.sub.del1');
      globalThis.fetch = appleFetch({ revokeStatus: 500 });
      const res = await api(app)
        .delete('/v1/me')
        .set({ Authorization: `Bearer ${token}` })
        .expect(502);
      expect(res.body.error.code).toBe('APPLE_ERROR');
      await api(app)
        .get('/v1/me')
        .set({ Authorization: `Bearer ${token}` })
        .expect(200);
    });

    it('폐기 성공(또는 이미 폐기 invalid_grant) → 계정 삭제, 저장된 refresh token 과 client_id 전달', async () => {
      const token = await appleSession('apple.sub.del2');
      const revoke = appleFetch({
        revokeStatus: 400,
        revokeError: 'invalid_grant',
      });
      globalThis.fetch = revoke;
      await api(app)
        .delete('/v1/me')
        .set({ Authorization: `Bearer ${token}` })
        .expect(200);
      expect(
        await prisma.authAccount.count({
          where: { providerUserId: 'apple.sub.del2' },
        }),
      ).toBe(0);
      const body = revoke.mock.calls[0][1]!.body as URLSearchParams;
      expect(urlOf(revoke.mock.calls[0][0])).toBe(APPLE_REVOKE_URL);
      expect(body.get('client_id')).toBe(APPLE_TEST_ENV.APPLE_BUNDLE_ID);
      expect(body.get('token')).toBe('apple-refresh');
      expect(body.get('token_type_hint')).toBe('refresh_token');
    });

    it('refresh token 이 없는 애플 계정은 Apple 을 부르지 않고 탈퇴', async () => {
      const token = await appleSession('apple.sub.del3');
      await prisma.authAccount.updateMany({
        where: { providerUserId: 'apple.sub.del3' },
        data: { refreshToken: null },
      });
      const spy = vi.fn<typeof fetch>();
      globalThis.fetch = spy;
      await api(app)
        .delete('/v1/me')
        .set({ Authorization: `Bearer ${token}` })
        .expect(200);
      expect(spy).not.toHaveBeenCalled();
    });
  });

  it('APPLE_* 가 하나라도 비면 애플 엔드포인트만 503 APPLE_NOT_CONFIGURED (D-55)', async () => {
    const saved = process.env.APPLE_PRIVATE_KEY;
    process.env.APPLE_PRIVATE_KEY = '';
    try {
      expect(
        (await api(app).get('/v1/auth/apple').expect(503)).body.error.code,
      ).toBe('APPLE_NOT_CONFIGURED');
      const native = await api(app)
        .post('/v1/auth/apple/native')
        .send({
          identityToken: 'x',
          authorizationCode: 'c',
          nonce: 'n'.repeat(32),
          codeChallenge: pkcePair().challenge,
        })
        .expect(503);
      expect(native.body.error.code).toBe('APPLE_NOT_CONFIGURED');
      await api(app).get('/v1/health').expect(200);
    } finally {
      process.env.APPLE_PRIVATE_KEY = saved;
    }
  });

  it('형식이 틀린 네이티브 요청은 400', async () => {
    const base = {
      identityToken: 'x',
      authorizationCode: 'c',
      nonce: 'n'.repeat(32),
      codeChallenge: pkcePair().challenge,
    };
    await api(app)
      .post('/v1/auth/apple/native')
      .send({ ...base, nonce: 'short' })
      .expect(400);
    await api(app)
      .post('/v1/auth/apple/native')
      .send({ ...base, nickname: '   ' })
      .expect(400);
    await api(app)
      .post('/v1/auth/apple/native')
      .send({ ...base, codeChallenge: 'x' })
      .expect(400);
    await api(app)
      .post('/v1/auth/apple/native')
      .send({ ...base, email: 'a@b' })
      .expect(400);
  });
});
