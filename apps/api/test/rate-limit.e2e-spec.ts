import { api, auth, createTestApp, devLogin, resetDb, TestApp } from './helpers.js';

/** test-env.ts 의 INTERNAL_API_KEY */
const INTERNAL_KEY = 'e2e-internal-key';

/** (#186) 요청 제한 e2e. 가드 순서(인증보다 먼저), 봉투, Retry-After, 로그인 경로 302, health 제외 */
describe('요청 제한 (e2e)', () => {
  let app: TestApp;

  beforeEach(async () => {
    // 카운터는 앱마다 새로 만든다 (테스트끼리 섞이지 않게)
    app = await createTestApp({ rateLimit: {} });
    await resetDb(app);
  });

  afterEach(async () => {
    await app.close();
  });

  it('handoff 교환은 IP 당 1분 20번. 21번째는 429 RATE_LIMITED + Retry-After', async () => {
    const body = { handoff: 'x'.repeat(43), verifier: 'y'.repeat(43) };
    for (let i = 0; i < 20; i++) {
      const res = await api(app).post('/v1/auth/handoff').set('X-Real-IP', '198.51.100.1').send(body);
      expect(res.status).not.toBe(429);
    }
    const res = await api(app).post('/v1/auth/handoff').set('X-Real-IP', '198.51.100.1').send(body).expect(429);
    expect(res.body).toEqual({
      status: 429,
      data: null,
      message: '잠시 후 다시 시도해 주세요',
      error: { code: 'RATE_LIMITED', details: { retryAfterSec: expect.any(Number) } },
    });
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
    // 다른 IP 는 따로 센다
    await api(app).post('/v1/auth/handoff').set('X-Real-IP', '198.51.100.2').send(body).expect((r) => expect(r.status).not.toBe(429));
  });

  it('로그인 경로는 한 묶음이고, 브라우저가 여는 경로는 웹 로그인 화면으로 302', async () => {
    for (let i = 0; i < 20; i++) await api(app).post('/v1/auth/kakao/native').send({});
    const res = await api(app).get('/v1/auth/kakao').expect(302);
    expect(res.headers.location).toBe('http://localhost:3000/login?error=RATE_LIMITED');
    expect(res.headers['retry-after']).toBeDefined();
  });

  it('내부 키가 맞을 때만 X-Client-IP 로 나눠 센다', async () => {
    const preview = (headers: Record<string, string>) => {
      let req = api(app).get('/v1/invites/ABCDEF');
      for (const [k, v] of Object.entries(headers)) req = req.set(k, v);
      return req;
    };
    // 키 없이 X-Client-IP 만 바꿔도 같은 IP(소켓) 로 센다
    for (let i = 0; i < 30; i++) await preview({ 'X-Client-IP': `203.0.113.${i}` }).expect(404);
    await preview({ 'X-Client-IP': '203.0.113.200' }).expect(429);
    // 웹 서버(키 일치)가 실어 보낸 사용자 IP 는 따로 센다
    await preview({ 'X-Internal-Key': INTERNAL_KEY, 'X-Client-IP': '203.0.113.200' }).expect(404);
  });

  it('초대 합류는 사용자당 10분 10번', async () => {
    const me = await devLogin(app, '합류시도');
    for (let i = 0; i < 10; i++) await api(app).post('/v1/groups/join').set(auth(me)).send({ code: '000000' }).expect(404);
    const res = await api(app).post('/v1/groups/join').set(auth(me)).send({ code: '000000' }).expect(429);
    expect(res.body.error.details.retryAfterSec).toBeGreaterThan(590);
  });

  it('인증보다 먼저 돈다: 토큰 없는 요청도 IP 600/1분에 들어가 401 대신 429', async () => {
    for (let i = 0; i < 600; i++) await api(app).get('/v1/groups').set('X-Real-IP', '192.0.2.9').expect(401);
    await api(app).get('/v1/groups').set('X-Real-IP', '192.0.2.9').expect(429);
    // health 는 세지 않는다
    await api(app).get('/v1/health').set('X-Real-IP', '192.0.2.9').expect(200);
  });
});
