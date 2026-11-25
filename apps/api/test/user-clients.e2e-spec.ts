import type { MockInstance } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { UserClientsRepository } from '../src/user-clients/user-clients.repository.js';
import { UserClientsClock } from '../src/user-clients/user-clients.service.js';
import { api, auth, createTestApp, devLogin, resetDb, type Session, type TestApp } from './helpers.js';

const KEY = 'e2e-internal-key';
const IOS_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 WhenwemeetApp/1.3.0 (ios)';
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/131.0 Mobile Safari/537.36 WhenwemeetApp/1.2.1 (android)';
const WEB_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/131.0 Safari/537.36';

/**
 * (#532) 접속 기종 기록 (D-288). 웹 프록시가 X-Internal-Key 와 같이 넘긴 X-Client-UA 에서 기종과 앱 버전을 뽑아
 * 로그인한 사용자의 UserClient 에 남긴다. 같은 사용자, 기종은 1시간에 한 번. 키 없는 요청의 헤더는 믿지 않는다
 */
describe('접속 기종 기록 (e2e, #532)', () => {
  let app: TestApp;
  let prisma: PrismaService;
  let now: number;
  let touch: MockInstance<UserClientsRepository['touch']>;
  let admin: Session;
  let alice: Session;
  let bob: Session;

  const viaWeb = (session: Session, ua: string) => api(app).get('/v1/me').set(auth(session)).set({ 'X-Internal-Key': KEY, 'X-Client-UA': ua }).expect(200);
  const rowsOf = (userId: number) => prisma.userClient.findMany({ where: { userId }, orderBy: { platform: 'asc' }, select: { platform: true, appVersion: true, firstSeenAt: true, lastSeenAt: true } });
  /** 기록은 응답을 기다리지 않으므로 써질 때까지 잠깐 기다린다 */
  async function waitRows(userId: number, count: number) {
    for (let i = 0; i < 50; i++) {
      const rows = await rowsOf(userId);
      if (rows.length >= count) return rows;
      await new Promise((r) => setTimeout(r, 20));
    }
    return rowsOf(userId);
  }
  async function waitTouched(times: number) {
    for (let i = 0; i < 50 && touch.mock.calls.length < times; i++) await new Promise((r) => setTimeout(r, 20));
    // 마지막 upsert 가 끝나도록 한 번 더
    await Promise.all(touch.mock.results.map((r) => r.value));
  }

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    now = Date.parse('2026-11-25T01:00:00.000Z');
    app.get(UserClientsClock).now = () => now;
    touch = vi.spyOn(app.get(UserClientsRepository), 'touch');
    await resetDb(app);
    admin = await devLogin(app, '운영자');
    alice = await devLogin(app, '앨리스');
    bob = await devLogin(app, '밥');
    await prisma.user.update({ where: { id: admin.userId }, data: { role: 'admin' } });
  });

  afterAll(async () => {
    await resetDb(app);
    await app.close();
  });

  it('앱 UA 로 온 요청은 기종과 앱 버전 한 줄. 1시간 안의 두 번째 요청은 쓰지 않고, 지나면 lastSeenAt 만 고친다', async () => {
    touch.mockClear();
    await viaWeb(alice, IOS_UA);
    await waitTouched(1);
    const [first] = await waitRows(alice.userId, 1);
    expect(first).toMatchObject({ platform: 'ios', appVersion: '1.3.0' });
    expect(first.firstSeenAt.toISOString()).toBe('2026-11-25T01:00:00.000Z');
    expect(first.lastSeenAt.toISOString()).toBe('2026-11-25T01:00:00.000Z');

    now += 30 * 60_000;
    await viaWeb(alice, IOS_UA);
    expect(touch).toHaveBeenCalledTimes(1);
    expect((await rowsOf(alice.userId))[0].lastSeenAt.toISOString()).toBe('2026-11-25T01:00:00.000Z');

    now += 31 * 60_000;
    await viaWeb(alice, IOS_UA);
    await waitTouched(2);
    const rows = await rowsOf(alice.userId);
    expect(rows).toHaveLength(1);
    expect(rows[0].firstSeenAt.toISOString()).toBe('2026-11-25T01:00:00.000Z');
    expect(rows[0].lastSeenAt.toISOString()).toBe('2026-11-25T02:01:00.000Z');
  });

  it('기종이 다르면 따로(web 은 버전 없음). 원문 UA 는 어디에도 남지 않는다', async () => {
    await viaWeb(alice, WEB_UA);
    await viaWeb(alice, ANDROID_UA);
    const rows = await waitRows(alice.userId, 3);
    expect(rows.map((r) => [r.platform, r.appVersion])).toEqual([
      ['ios', '1.3.0'],
      ['android', '1.2.1'],
      ['web', null],
    ]);
    const raw = await prisma.$queryRawUnsafe<Record<string, unknown>[]>('SELECT * FROM `UserClient`');
    expect(JSON.stringify(raw)).not.toMatch(/Mozilla|Chrome|iPhone/);
  });

  it('내부 키 없이 온 헤더, 틀린 키, 웹 서버 자신의 호출(UA 없음), 로그인 안 한 요청은 기록하지 않는다', async () => {
    touch.mockClear();
    await api(app).get('/v1/me').set(auth(bob)).set({ 'X-Client-UA': IOS_UA, 'User-Agent': IOS_UA }).expect(200);
    await api(app).get('/v1/me').set(auth(bob)).set({ 'X-Internal-Key': 'wrong', 'X-Client-UA': IOS_UA }).expect(200);
    await api(app).get('/v1/me').set(auth(bob)).set({ 'X-Internal-Key': KEY }).expect(200);
    await api(app).get('/v1/me').set({ 'X-Internal-Key': KEY, 'X-Client-UA': IOS_UA }).expect(401);
    await api(app).get('/v1/health').set({ 'X-Internal-Key': KEY, 'X-Client-UA': IOS_UA }).expect(200);
    expect(touch).not.toHaveBeenCalled();
    expect(await rowsOf(bob.userId)).toEqual([]);
  });

  it('사용자는 서명된 토큰에서만 정해진다: 밥의 토큰으로는 밥의 줄만 생긴다', async () => {
    await viaWeb(bob, ANDROID_UA);
    expect((await waitRows(bob.userId, 1)).map((r) => r.platform)).toEqual(['android']);
    expect((await rowsOf(alice.userId)).filter((r) => r.platform === 'android')).toHaveLength(1);
  });

  it('관리자 목록, 상세의 쓰는 곳은 접속 기록을 먼저 (기종마다 앱 버전, 마지막 접속). 기종 필터도 접속 기록으로', async () => {
    // 밥은 푸시 기기가 없지만 접속 기록으로 Android. 옛 규칙이면 앱 로그인 기록 때문에 "기종 모름" 이었을 사람
    await prisma.user.update({ where: { id: bob.userId }, data: { lastAppLoginAt: new Date() } });
    // 앨리스는 iOS 푸시 기기(옛 버전)도 있지만 접속 기록이 먼저
    await api(app).put('/v1/me/push-devices').set(auth(alice)).send({ token: 'ExponentPushToken[alice-ios]', platform: 'IOS', appVersion: '1.1.0' }).expect(200);

    type Row = { id: number; platforms: string[]; platformLastSeen: { platform: string; appVersion: string | null; lastSeenAt: string }[] };
    const list = async (query: Record<string, string> = {}) =>
      (await api(app).get('/v1/admin/users').query({ limit: '50', ...query }).set(auth(admin)).expect(200)).body.data.items as Row[];
    const byId = new Map((await list()).map((u) => [u.id, u]));
    expect(byId.get(alice.userId)!.platforms).toEqual(['ios', 'android', 'web']);
    expect(byId.get(alice.userId)!.platformLastSeen).toEqual([
      { platform: 'ios', appVersion: '1.3.0', lastSeenAt: '2026-11-25T02:01:00.000Z' },
      { platform: 'android', appVersion: '1.2.1', lastSeenAt: '2026-11-25T02:01:00.000Z' },
      { platform: 'web', appVersion: null, lastSeenAt: '2026-11-25T02:01:00.000Z' },
    ]);
    expect(byId.get(bob.userId)!.platforms).toEqual(['android']);
    expect(byId.get(admin.userId)!.platforms).toEqual(['web']);

    const ids = async (platform: string) => (await list({ platform })).map((u) => u.id).sort((a, b) => a - b);
    expect(await ids('ios')).toEqual([alice.userId]);
    expect(await ids('android')).toEqual([alice.userId, bob.userId].sort((a, b) => a - b));
    expect(await ids('web')).toEqual([admin.userId, alice.userId].sort((a, b) => a - b));

    const detail = await api(app).get(`/v1/admin/users/${bob.userId}`).set(auth(admin)).expect(200);
    expect(detail.body.data.user).toMatchObject({ platforms: ['android'], platformLastSeen: [{ platform: 'android', appVersion: '1.2.1' }] });
  });

  it('탈퇴하면 접속 기록도 지워진다', async () => {
    await prisma.user.delete({ where: { id: bob.userId } });
    expect(await rowsOf(bob.userId)).toEqual([]);
  });
});
