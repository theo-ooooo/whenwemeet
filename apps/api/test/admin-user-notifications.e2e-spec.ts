import { PrismaService } from '../src/prisma/prisma.service.js';
import { api, auth, createTestApp, devLogin, resetDb, type Session, type TestApp } from './helpers.js';

/**
 * (#528) 관리자 사용자 상세의 알림 설정 (읽기 전용). 종류별 켜짐/꺼짐은 그 사람의 내 정보 > 알림 과 같은 키(공지 포함),
 * 기기는 종류, 앱 버전, 등록, 마지막 확인만. 푸시 토큰은 응답 어디에도 싣지 않는다
 */
describe('관리자 사용자 상세 알림 설정 (e2e, #528)', () => {
  let app: TestApp;
  let prisma: PrismaService;
  let admin: Session;
  let on: Session;
  let off: Session;
  let noDevice: Session;

  const registerDevice = (session: Session, token: string, platform: 'IOS' | 'ANDROID') =>
    api(app).put('/v1/me/push-devices').set(auth(session)).send({ token, platform, appVersion: '1.3.0' }).expect(200);

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    await resetDb(app);
    admin = await devLogin(app, '운영자');
    on = await devLogin(app, '받는사람');
    off = await devLogin(app, '끈사람');
    noDevice = await devLogin(app, '기기없음');
    await prisma.user.update({ where: { id: admin.userId }, data: { role: 'admin' } });
    await registerDevice(on, 'ExponentPushToken[on-ios]', 'IOS');
    await registerDevice(on, 'ExponentPushToken[on-android]', 'ANDROID');
    await registerDevice(off, 'ExponentPushToken[off-ios]', 'IOS');
    await api(app).patch('/v1/me/notification-settings').set(auth(off)).send({ notice: false, change: false }).expect(200);
  });

  afterAll(async () => {
    await resetDb(app);
    await app.close();
  });

  it('관리자 사용자 상세: 알림 설정(공지 포함, 내 정보 > 알림 과 같은 키)과 기기 요약. 토큰은 응답 어디에도 없다', async () => {
    const res = await api(app).get(`/v1/admin/users/${on.userId}`).set(auth(admin)).expect(200);
    const mine = (await api(app).get('/v1/me/notification-settings').set(auth(on)).expect(200)).body.data as Record<string, boolean>;
    const { notifications } = res.body.data as { notifications: { settings: Record<string, boolean>; devices: Record<string, unknown>[] } };
    expect(notifications.settings).toEqual(mine);
    expect(Object.keys(notifications.settings).sort((a, b) => a.localeCompare(b))).toEqual(['anniversary', 'change', 'join', 'notice', 'poll', 'reminder', 'weekly', 'weeklyNudge']);
    expect(notifications.devices.map((d) => String(d.platform)).sort((a, b) => a.localeCompare(b))).toEqual(['ANDROID', 'IOS']);
    for (const device of notifications.devices) expect(Object.keys(device).sort()).toEqual(['appVersion', 'createdAt', 'lastSeenAt', 'platform']);
    expect(JSON.stringify(res.body)).not.toMatch(/ExponentPushToken/);

    const offDetail = await api(app).get(`/v1/admin/users/${off.userId}`).set(auth(admin)).expect(200);
    expect(offDetail.body.data.notifications.settings).toMatchObject({ notice: false, change: false, reminder: true });
    const none = await api(app).get(`/v1/admin/users/${noDevice.userId}`).set(auth(admin)).expect(200);
    expect(none.body.data.notifications.devices).toEqual([]);
    await api(app).get(`/v1/admin/users/${noDevice.userId}`).set(auth(on)).expect(403);
  });

  it('(#528) 쓰는 곳: 푸시 기기 기종, 기기도 앱 로그인도 없으면 web, 앱 로그인만 있으면 모름. 목록 필터 platform', async () => {
    const appOnly = await devLogin(app, '앱만');
    await prisma.user.update({ where: { id: appOnly.userId }, data: { lastAppLoginAt: new Date() } });
    type Row = { id: number; platforms: string[]; platformLastSeen: { platform: string; lastSeenAt: string }[]; lastAppLoginAt: string | null };
    const users = async (query: Record<string, string> = {}) =>
      (await api(app).get('/v1/admin/users').query({ limit: '50', ...query }).set(auth(admin)).expect(200)).body.data.items as Row[];
    const byId = new Map((await users()).map((u) => [u.id, u]));
    expect(byId.get(on.userId)!.platforms).toEqual(['ios', 'android']);
    expect(byId.get(off.userId)!.platforms).toEqual(['ios']);
    expect(byId.get(noDevice.userId)!.platforms).toEqual(['web']);
    expect(byId.get(appOnly.userId)!.platforms).toEqual([]);
    expect(byId.get(on.userId)!.platformLastSeen.map((p) => p.platform)).toEqual(['ios', 'android']);

    const ids = async (platform: string) => (await users({ platform })).map((u) => u.id).sort((a, b) => a - b);
    expect(await ids('ios')).toEqual([on.userId, off.userId].sort((a, b) => a - b));
    expect(await ids('android')).toEqual([on.userId]);
    expect(await ids('web')).toEqual([admin.userId, noDevice.userId].sort((a, b) => a - b));
    await api(app).get('/v1/admin/users').query({ platform: 'IOS' }).set(auth(admin)).expect(400);

    const detail = await api(app).get(`/v1/admin/users/${on.userId}`).set(auth(admin)).expect(200);
    expect(detail.body.data.user).toMatchObject({ platforms: ['ios', 'android'], lastAppLoginAt: null });
    expect(JSON.stringify(detail.body)).not.toMatch(/ExponentPushToken/);
  });
});
