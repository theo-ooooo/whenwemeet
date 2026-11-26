import { createHash, randomBytes } from 'node:crypto';
import { AuthHandoffsRepository } from '../src/auth-handoffs/auth-handoffs.repository.js';
import {
  KAKAO_ME_URL,
  KAKAO_TOKEN_INFO_URL,
  KAKAO_TOKEN_URL,
} from '../src/auth/providers/kakao.provider.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { urlOf } from '../src/testing/fetch-url.js';
import { sampleImage } from '../src/testing/images.js';
import { api, createTestApp, devLogin, resetDb, TestApp } from './helpers.js';
import { E2E_PUBLIC_BASE_URL, MemoryStorage } from './memory-storage.js';

/** test-env.ts 의 KAKAO_APP_ID */
const APP_ID = 424242;
const IMAGE_URL = 'https://k.kakaocdn.example/app.jpg';

function pkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url');
  return {
    verifier,
    challenge: createHash('sha256').update(verifier).digest('base64url'),
  };
}

const sha256hex = (value: string): string =>
  createHash('sha256').update(value).digest('hex');

interface KakaoMockOptions {
  id: number;
  nickname?: string;
  appId?: number;
  tokenInfoStatus?: number;
  image?: Buffer;
}

/** 카카오 SDK 토큰 확인(access_token_info) + 사용자 조회 + 프로필 사진을 흉내 내는 fetch */
function kakaoAppFetch(options: KakaoMockOptions) {
  return vi.fn<typeof fetch>(async (input) => {
    const url = urlOf(input);
    if (url === KAKAO_TOKEN_INFO_URL) {
      const status = options.tokenInfoStatus ?? 200;
      if (status !== 200)
        return Response.json(
          { code: -401, msg: 'this access token does not exist' },
          { status },
        );
      return Response.json({
        id: options.id,
        expires_in: 7199,
        app_id: options.appId ?? APP_ID,
      });
    }
    if (url === KAKAO_ME_URL) {
      return Response.json({
        id: options.id,
        kakao_account: {
          profile: {
            nickname: options.nickname ?? '앱유저',
            profile_image_url: options.image ? IMAGE_URL : undefined,
          },
        },
      });
    }
    if (url === KAKAO_TOKEN_URL)
      return Response.json({ access_token: 'web-access-token' });
    if (url === IMAGE_URL && options.image)
      return new Response(new Uint8Array(options.image), { status: 200 });
    throw new Error(`예상 밖 fetch: ${url}`);
  });
}

/** 앱.md 2 ~ 3.1: 카카오 네이티브 로그인 → handoff → 웹 서버가 세션 JWT 로 교환 */
describe('앱 로그인 (e2e)', () => {
  let app: TestApp;
  let prisma: PrismaService;
  const storage = new MemoryStorage();
  const originalFetch = globalThis.fetch;

  beforeAll(async () => {
    app = await createTestApp({ storage, publicBaseUrl: E2E_PUBLIC_BASE_URL });
    prisma = app.get(PrismaService);
    await resetDb(app);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  afterAll(async () => {
    await resetDb(app);
    await app.close();
  });

  async function nativeLogin(options: KakaoMockOptions, challenge: string) {
    globalThis.fetch = kakaoAppFetch(options);
    return api(app)
      .post('/v1/auth/kakao/native')
      .send({ accessToken: 'sdk-access-token', codeChallenge: challenge });
  }

  it('native → handoff → /auth/handoff → /me 200. 신규 가입은 PERSONAL 팀과 소셜 사진 복사까지 웹과 같다', async () => {
    const { verifier, challenge } = pkcePair();
    const res = await nativeLogin(
      {
        id: 5_000_000_001,
        nickname: '앱유저',
        image: await sampleImage('jpeg'),
      },
      challenge,
    );
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.data).toEqual({
      handoff: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
      expiresIn: 60,
    });

    // access_token_info 에 Bearer 로 SDK 토큰을 보낸다
    const infoCall = (
      globalThis.fetch as ReturnType<typeof vi.fn<typeof fetch>>
    ).mock.calls.find(([input]) => urlOf(input) === KAKAO_TOKEN_INFO_URL)!;
    expect((infoCall[1]!.headers as Record<string, string>).Authorization).toBe(
      'Bearer sdk-access-token',
    );

    // DB 에는 해시와 challenge 만
    const handoff = res.body.data.handoff as string;
    const row = await prisma.authHandoff.findFirstOrThrow();
    expect(row).toMatchObject({
      tokenHash: sha256hex(handoff),
      codeChallenge: challenge,
      usedAt: null,
    });
    expect(row.expiresAt.getTime() - Date.now()).toBeGreaterThan(55_000);
    expect(row.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(60_000);

    const exchanged = await api(app)
      .post('/v1/auth/handoff')
      .send({ handoff, verifier })
      .expect(200);
    expect(exchanged.headers['cache-control']).toBe('no-store');
    const token = exchanged.body.data.token as string;
    expect(Object.keys(exchanged.body.data)).toEqual(['token']);

    const me = await api(app)
      .get('/v1/me')
      .set({ Authorization: `Bearer ${token}` })
      .expect(200);
    expect(me.body.data).toMatchObject({ id: row.userId, nickname: '앱유저' });
    expect(me.body.data.profileImageUrl).toMatch(
      /^https:\/\/img\.e2e\.example\/avatars\/\d+\/[0-9A-Z]{26}\.webp$/,
    );
    const groups = await api(app)
      .get('/v1/groups')
      .set({ Authorization: `Bearer ${token}` })
      .expect(200);
    expect(groups.body.data.map((g: { type: string }) => g.type)).toEqual([
      'PERSONAL',
    ]);
    expect((await prisma.authHandoff.findFirstOrThrow()).usedAt).not.toBeNull();
    // (#188) handoff 교환 성공 = 앱 로그인 시각 (D-97)
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: row.userId } }))
        .lastAppLoginAt,
    ).toBeInstanceOf(Date);

    // 두 번째 교환은 401
    const again = await api(app)
      .post('/v1/auth/handoff')
      .send({ handoff, verifier })
      .expect(401);
    expect(again.body.error.code).toBe('HANDOFF_INVALID');
    expect(again.body.message).toBe('로그인이 만료됐어요. 다시 시도해 주세요');
  });

  it('웹 카카오 로그인과 같은 회원번호면 같은 User (계정이 늘지 않는다)', async () => {
    const before = await prisma.user.count();
    const { verifier, challenge } = pkcePair();
    const res = await nativeLogin(
      { id: 5_000_000_001, nickname: '바뀐닉' },
      challenge,
    ).then((r) => r.body.data.handoff as string);
    const { body } = await api(app)
      .post('/v1/auth/handoff')
      .send({ handoff: res, verifier })
      .expect(200);
    const me = await api(app)
      .get('/v1/me')
      .set({ Authorization: `Bearer ${body.data.token}` })
      .expect(200);
    expect(me.body.data.nickname).toBe('앱유저');
    expect(await prisma.user.count()).toBe(before);
    expect(
      await prisma.authAccount.count({
        where: { provider: 'KAKAO', providerUserId: '5000000001' },
      }),
    ).toBe(1);
  });

  it('verifier 가 틀리면 401 이고 handoff 는 소비되지 않는다, 맞는 verifier 로는 교환된다', async () => {
    const { verifier, challenge } = pkcePair();
    const handoff = (await nativeLogin({ id: 5_000_000_002 }, challenge)).body
      .data.handoff as string;
    const wrong = await api(app)
      .post('/v1/auth/handoff')
      .send({ handoff, verifier: pkcePair().verifier })
      .expect(401);
    expect(wrong.body.error.code).toBe('HANDOFF_INVALID');
    await api(app)
      .post('/v1/auth/handoff')
      .send({ handoff, verifier })
      .expect(200);
  });

  it('만료(60초 경과)와 없는 handoff 는 401 HANDOFF_INVALID', async () => {
    const { verifier, challenge } = pkcePair();
    const handoff = (await nativeLogin({ id: 5_000_000_003 }, challenge)).body
      .data.handoff as string;
    await prisma.authHandoff.update({
      where: { tokenHash: sha256hex(handoff) },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect(
      (
        await api(app)
          .post('/v1/auth/handoff')
          .send({ handoff, verifier })
          .expect(401)
      ).body.error.code,
    ).toBe('HANDOFF_INVALID');

    const unknown = randomBytes(32).toString('base64url');
    expect(
      (
        await api(app)
          .post('/v1/auth/handoff')
          .send({ handoff: unknown, verifier })
          .expect(401)
      ).body.error.code,
    ).toBe('HANDOFF_INVALID');
  });

  it('형식이 틀린 요청은 400 VALIDATION_FAILED', async () => {
    const { verifier, challenge } = pkcePair();
    await api(app)
      .post('/v1/auth/handoff')
      .send({ handoff: 'short', verifier })
      .expect(400);
    await api(app)
      .post('/v1/auth/handoff')
      .send({
        handoff: randomBytes(32).toString('base64url'),
        verifier: 'x'.repeat(42),
      })
      .expect(400);
    await api(app)
      .post('/v1/auth/handoff')
      .send({
        handoff: randomBytes(32).toString('base64url'),
        verifier,
        extra: 1,
      })
      .expect(400);
    await api(app)
      .post('/v1/auth/kakao/native')
      .send({ accessToken: '', codeChallenge: challenge })
      .expect(400);
    await api(app)
      .post('/v1/auth/kakao/native')
      .send({ accessToken: 'a', codeChallenge: 'abc' })
      .expect(400);
    await api(app)
      .post('/v1/auth/kakao/native')
      .send({ accessToken: 'a'.repeat(513), codeChallenge: challenge })
      .expect(400);
  });

  it('다른 앱의 토큰(app_id 불일치), 무효 토큰은 401 SOCIAL_TOKEN_INVALID, 카카오 장애는 502. 사용자와 handoff 를 만들지 않는다', async () => {
    const users = await prisma.user.count();
    const handoffs = await prisma.authHandoff.count();
    const { challenge } = pkcePair();

    const otherApp = await nativeLogin(
      { id: 5_000_000_010, appId: 1 },
      challenge,
    );
    expect(otherApp.status).toBe(401);
    expect(otherApp.body.error.code).toBe('SOCIAL_TOKEN_INVALID');

    const invalid = await nativeLogin(
      { id: 5_000_000_010, tokenInfoStatus: 401 },
      challenge,
    );
    expect(invalid.status).toBe(401);
    expect(invalid.body.error.code).toBe('SOCIAL_TOKEN_INVALID');

    const down = await nativeLogin(
      { id: 5_000_000_010, tokenInfoStatus: 500 },
      challenge,
    );
    expect(down.status).toBe(502);
    expect(down.body.error.code).toBe('KAKAO_ERROR');

    expect(await prisma.user.count()).toBe(users);
    expect(await prisma.authHandoff.count()).toBe(handoffs);
  });

  it('KAKAO_APP_ID 가 비어 있으면 /auth/kakao/native 만 503 KAKAO_NOT_CONFIGURED (D-55)', async () => {
    const saved = process.env.KAKAO_APP_ID;
    process.env.KAKAO_APP_ID = '';
    try {
      const fetchSpy = vi.fn<typeof fetch>();
      globalThis.fetch = fetchSpy;
      const res = await api(app)
        .post('/v1/auth/kakao/native')
        .send({ accessToken: 'a', codeChallenge: pkcePair().challenge })
        .expect(503);
      expect(res.body.error.code).toBe('KAKAO_NOT_CONFIGURED');
      expect(fetchSpy).not.toHaveBeenCalled();
      await api(app).get('/v1/auth/kakao').expect(302);
      await api(app).get('/v1/health').expect(200);
    } finally {
      process.env.KAKAO_APP_ID = saved;
    }
  });

  describe('AuthHandoffsRepository (실 DB)', () => {
    let repo: AuthHandoffsRepository;
    let userId: number;

    beforeAll(async () => {
      repo = app.get(AuthHandoffsRepository);
      userId = (await devLogin(app, '핸드오프')).userId;
    });

    it('consume 동시 2건 중 1건만 성공', async () => {
      const tokenHash = sha256hex('concurrent');
      await repo.create({
        userId,
        tokenHash,
        codeChallenge: 'c'.repeat(43),
        expiresAt: new Date(Date.now() + 60_000),
      });
      const results = await Promise.all([
        repo.consume(tokenHash, 'c'.repeat(43), new Date()),
        repo.consume(tokenHash, 'c'.repeat(43), new Date()),
      ]);
      expect(results.filter((r) => r === userId)).toHaveLength(1);
      expect(results.filter((r) => r === null)).toHaveLength(1);
    });

    it('deleteExpiredBefore 는 기준보다 먼저 만료된 행만 지운다', async () => {
      const now = Date.now();
      const old = sha256hex('old');
      const recent = sha256hex('recent');
      await repo.create({
        userId,
        tokenHash: old,
        codeChallenge: 'c'.repeat(43),
        expiresAt: new Date(now - 2 * 86_400_000),
      });
      await repo.create({
        userId,
        tokenHash: recent,
        codeChallenge: 'c'.repeat(43),
        expiresAt: new Date(now - 1000),
      });
      expect(
        await repo.deleteExpiredBefore(new Date(now - 86_400_000)),
      ).toBeGreaterThanOrEqual(1);
      expect(
        await prisma.authHandoff.findUnique({ where: { tokenHash: old } }),
      ).toBeNull();
      expect(
        await prisma.authHandoff.findUnique({ where: { tokenHash: recent } }),
      ).not.toBeNull();
    });

    it('User 삭제(탈퇴) 시 handoff 도 Cascade 로 삭제', async () => {
      const session = await devLogin(app, '탈퇴핸드오프');
      await repo.create({
        userId: session.userId,
        tokenHash: sha256hex('cascade'),
        codeChallenge: 'c'.repeat(43),
        expiresAt: new Date(Date.now() + 60_000),
      });
      await api(app)
        .delete('/v1/me')
        .set({ Authorization: `Bearer ${session.token}` })
        .expect(200);
      expect(
        await prisma.authHandoff.count({ where: { userId: session.userId } }),
      ).toBe(0);
    });
  });
});
