import { PrismaService } from '../src/prisma/prisma.service.js';
import { KAKAO_ME_URL, KAKAO_TOKEN_URL, KAKAO_UNLINK_URL } from '../src/auth/kakao.client.js';
import { urlOf } from '../src/testing/fetch-url.js';
import { api, auth, createTestApp, devLogin, resetDb, TestApp } from './helpers.js';

type FetchMock = ReturnType<typeof vi.fn<typeof fetch>>;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** 카카오 토큰 교환 + 사용자 조회를 흉내 내는 fetch */
function kakaoFetch(profile: { id: number; nickname?: string; image?: string }): FetchMock {
  return vi.fn<typeof fetch>(async (input) => {
    const url = urlOf(input);
    if (url === KAKAO_TOKEN_URL) return jsonResponse({ access_token: 'kakao-access-token' });
    if (url === KAKAO_ME_URL) {
      return jsonResponse({
        id: profile.id,
        kakao_account: { profile: { nickname: profile.nickname, profile_image_url: profile.image } },
      });
    }
    throw new Error(`예상 밖 fetch: ${url}`);
  });
}

/** /auth/kakao 를 호출해 state 쿠키와 state 값을 얻는다 */
async function startLogin(app: TestApp, next?: string): Promise<{ cookie: string; state: string; location: URL }> {
  const res = await api(app).get('/v1/auth/kakao').query(next ? { next } : {}).expect(302);
  const setCookie = (res.headers['set-cookie'] as unknown as string[])[0];
  const cookie = setCookie.split(';')[0];
  const location = new URL(res.headers.location);
  return { cookie, state: location.searchParams.get('state')!, location };
}

describe('카카오 OAuth (e2e)', () => {
  let app: TestApp;
  const originalFetch = globalThis.fetch;

  beforeAll(async () => {
    app = await createTestApp();
    await resetDb(app);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  afterAll(async () => {
    await resetDb(app);
    await app.close();
  });

  it('GET /auth/kakao 는 state 쿠키를 심고 카카오 인가 페이지로 302', async () => {
    const { cookie, state, location } = await startLogin(app, '/join/ABC123');
    expect(cookie).toMatch(/^wwm_oauth_state=[0-9a-f]{64}$/);
    expect(location.origin + location.pathname).toBe('https://kauth.kakao.com/oauth/authorize');
    expect(location.searchParams.get('response_type')).toBe('code');
    expect(location.searchParams.get('scope')).toBe('profile_nickname,profile_image');
    expect(location.searchParams.get('client_id')).toBe('e2e-kakao-client-id');
    const decoded = JSON.parse(Buffer.from(state, 'base64url').toString('utf8'));
    expect(decoded).toEqual({ nonce: cookie.split('=')[1], next: '/join/ABC123' });
  });

  it('next 가 규칙 밖이면 / 로 바꾼다', async () => {
    const { state } = await startLogin(app, 'https://evil.example');
    expect(JSON.parse(Buffer.from(state, 'base64url').toString('utf8')).next).toBe('/');
  });

  it('콜백 성공: 사용자 생성 + PERSONAL 팀 + JWT 를 웹 콜백으로 전달', async () => {
    globalThis.fetch = kakaoFetch({ id: 4_000_000_001, nickname: '카카오유저', image: 'https://img.example/p.png' });
    const { cookie, state } = await startLogin(app, '/join/ABC123');
    const res = await api(app)
      .get('/v1/auth/kakao/callback')
      .set('Cookie', cookie)
      .query({ code: 'auth-code', state })
      .expect(302);

    const location = new URL(res.headers.location);
    expect(location.origin + location.pathname).toBe('http://localhost:3000/auth/callback');
    expect(location.searchParams.get('next')).toBe('/join/ABC123');
    const token = location.searchParams.get('token')!;
    expect(token.split('.')).toHaveLength(3);
    // state 쿠키는 삭제
    const cleared = (res.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('wwm_oauth_state='));
    expect(cleared).toMatch(/Expires=Thu, 01 Jan 1970/);

    const me = await api(app).get('/v1/me').set({ Authorization: `Bearer ${token}` }).expect(200);
    expect(me.body.data).toMatchObject({ nickname: '카카오유저', profileImageUrl: 'https://img.example/p.png' });

    const groups = await api(app).get('/v1/groups').set({ Authorization: `Bearer ${token}` }).expect(200);
    expect(groups.body.data).toHaveLength(1);
    expect(groups.body.data[0].type).toBe('PERSONAL');

    // 토큰 교환 요청에 client_secret 과 code 가 실려야 한다
    const tokenCall = (globalThis.fetch as FetchMock).mock.calls.find(([input]) => urlOf(input) === KAKAO_TOKEN_URL)!;
    const body = tokenCall[1]!.body as URLSearchParams;
    expect(body.get('code')).toBe('auth-code');
    expect(body.get('client_secret')).toBe('e2e-kakao-client-secret');
    expect(body.get('grant_type')).toBe('authorization_code');
  });

  it('같은 kakaoId 로 다시 로그인하면 닉네임만 갱신되고 팀은 늘지 않는다', async () => {
    globalThis.fetch = kakaoFetch({ id: 4_000_000_001, nickname: '바뀐닉네임' });
    const { cookie, state } = await startLogin(app);
    const res = await api(app).get('/v1/auth/kakao/callback').set('Cookie', cookie).query({ code: 'c', state }).expect(302);
    const token = new URL(res.headers.location).searchParams.get('token')!;
    const me = await api(app).get('/v1/me').set({ Authorization: `Bearer ${token}` }).expect(200);
    expect(me.body.data).toMatchObject({ nickname: '바뀐닉네임', profileImageUrl: null });

    const prisma = app.get(PrismaService);
    expect(await prisma.user.count()).toBe(1);
    expect(await prisma.group.count()).toBe(1);
  });

  it('state 불일치, 쿠키 없음, code 없음 → /login?error=OAUTH_STATE', async () => {
    const { cookie, state } = await startLogin(app);
    const other = await startLogin(app);

    const mismatch = await api(app).get('/v1/auth/kakao/callback').set('Cookie', other.cookie).query({ code: 'c', state }).expect(302);
    expect(mismatch.headers.location).toBe('http://localhost:3000/login?error=OAUTH_STATE');

    const noCookie = await api(app).get('/v1/auth/kakao/callback').query({ code: 'c', state }).expect(302);
    expect(noCookie.headers.location).toBe('http://localhost:3000/login?error=OAUTH_STATE');

    const noCode = await api(app).get('/v1/auth/kakao/callback').set('Cookie', cookie).query({ state }).expect(302);
    expect(noCode.headers.location).toBe('http://localhost:3000/login?error=OAUTH_STATE');

    const garbage = await api(app).get('/v1/auth/kakao/callback').set('Cookie', cookie).query({ code: 'c', state: '!!!' }).expect(302);
    expect(garbage.headers.location).toBe('http://localhost:3000/login?error=OAUTH_STATE');
  });

  it('카카오 호출 실패 → /login?error=KAKAO_ERROR', async () => {
    globalThis.fetch = vi.fn<typeof fetch>(async () => jsonResponse({ error: 'invalid_grant' }, 400));
    const { cookie, state } = await startLogin(app);
    const res = await api(app).get('/v1/auth/kakao/callback').set('Cookie', cookie).query({ code: 'bad', state }).expect(302);
    expect(res.headers.location).toBe('http://localhost:3000/login?error=KAKAO_ERROR');
  });

  it('KAKAO_CLIENT_ID 가 비어 있으면 로그인 시작만 503 KAKAO_NOT_CONFIGURED, 나머지는 정상', async () => {
    const saved = process.env.KAKAO_CLIENT_ID;
    process.env.KAKAO_CLIENT_ID = '';
    try {
      const res = await api(app).get('/v1/auth/kakao').expect(503);
      expect(res.body.error.code).toBe('KAKAO_NOT_CONFIGURED');
      await api(app).get('/v1/health').expect(200);
      const session = await devLogin(app, '로컬개발자');
      await api(app).get('/v1/me').set(auth(session)).expect(200);
    } finally {
      process.env.KAKAO_CLIENT_ID = saved;
    }
  });

  it('dev-login 검증: nickname 없으면 400', async () => {
    const res = await api(app).post('/v1/auth/dev-login').send({}).expect(400);
    expect(res.body).toEqual({
      status: 400,
      data: null,
      message: 'nickname 은 문자열이어야 해요',
      error: { code: 'VALIDATION_FAILED', details: [{ field: 'nickname', message: 'nickname 은 문자열이어야 해요' }] },
    });
  });

  it('운영(NODE_ENV=production) 에서는 dev-login 이 404', async () => {
    const saved = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const res = await api(app).post('/v1/auth/dev-login').send({ nickname: 'x' }).expect(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    } finally {
      process.env.NODE_ENV = saved;
    }
  });

  describe('회원 탈퇴의 카카오 unlink', () => {
    async function kakaoSession(id: number): Promise<string> {
      globalThis.fetch = kakaoFetch({ id, nickname: `유저${id}` });
      const { cookie, state } = await startLogin(app);
      const res = await api(app).get('/v1/auth/kakao/callback').set('Cookie', cookie).query({ code: 'c', state }).expect(302);
      return new URL(res.headers.location).searchParams.get('token')!;
    }

    it('unlink 실패 → 502 KAKAO_ERROR, 계정은 그대로', async () => {
      const token = await kakaoSession(4_000_000_002);
      globalThis.fetch = vi.fn<typeof fetch>(async () => jsonResponse({ code: -401, msg: 'bad key' }, 401));
      const res = await api(app).delete('/v1/me').set({ Authorization: `Bearer ${token}` }).expect(502);
      expect(res.body.error.code).toBe('KAKAO_ERROR');
      await api(app).get('/v1/me').set({ Authorization: `Bearer ${token}` }).expect(200);
    });

    it('unlink 성공(또는 이미 끊김 -101) → 계정 삭제, Admin Key 와 target_id 전달', async () => {
      const token = await kakaoSession(4_000_000_003);
      const unlink = vi.fn<typeof fetch>(async () => jsonResponse({ code: -101, msg: 'NotRegisteredUserException' }, 400));
      globalThis.fetch = unlink;
      await api(app).delete('/v1/me').set({ Authorization: `Bearer ${token}` }).expect(200);
      await api(app).get('/v1/me').set({ Authorization: `Bearer ${token}` }).expect(401);

      const [input, init] = unlink.mock.calls[0];
      expect(urlOf(input)).toBe(KAKAO_UNLINK_URL);
      expect((init!.headers as Record<string, string>).Authorization).toBe('KakaoAK e2e-kakao-admin-key');
      const body = init!.body as URLSearchParams;
      expect(body.get('target_id_type')).toBe('user_id');
      expect(body.get('target_id')).toBe('4000000003');
    });

    it('KAKAO_ADMIN_KEY 가 없으면 503 KAKAO_NOT_CONFIGURED', async () => {
      const token = await kakaoSession(4_000_000_004);
      const saved = process.env.KAKAO_ADMIN_KEY;
      process.env.KAKAO_ADMIN_KEY = '';
      try {
        const res = await api(app).delete('/v1/me').set({ Authorization: `Bearer ${token}` }).expect(503);
        expect(res.body.error.code).toBe('KAKAO_NOT_CONFIGURED');
      } finally {
        process.env.KAKAO_ADMIN_KEY = saved;
      }
    });
  });
});
