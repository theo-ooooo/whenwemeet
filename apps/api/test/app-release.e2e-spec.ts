import { PrismaService } from '../src/prisma/prisma.service.js';
import { api, auth, createTestApp, devLogin, resetDb, Session, TestApp } from './helpers.js';

/**
 * (#539) 앱 업데이트 안내 (api.md 2.17, D-292).
 * 공개 GET /app/version (로그인 없이, 값 없으면 null 과 기본 스토어 주소), 관리자 목록과 수정(가드, 검증, 최소 ≤ 최신, null 로 지우기), 조치 기록
 */
describe('앱 업데이트 안내 (e2e, #539)', () => {
  let app: TestApp;
  let prisma: PrismaService;
  let admin: Session;
  let user: Session;

  const put = (platform: string, body: Record<string, unknown>, who: Session = admin) => api(app).put(`/v1/admin/app-releases/${platform}`).set(auth(who)).send(body);

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    await resetDb(app);
    await prisma.appRelease.deleteMany();
    admin = await devLogin(app, '운영자');
    user = await devLogin(app, '사용자');
    await prisma.user.update({ where: { id: admin.userId }, data: { role: 'admin' } });
  });

  afterAll(async () => {
    await prisma.appRelease.deleteMany();
    await app.close();
  });

  it('GET /app/version: 로그인 없이 열리고 값이 없으면 버전 null, 기본 스토어 주소', async () => {
    const ios = await api(app).get('/v1/app/version?platform=ios').expect(200);
    expect(ios.body.data).toEqual({ platform: 'ios', latestVersion: null, minVersion: null, storeUrl: 'https://apps.apple.com/kr/app/id6832865813', updatedAt: null });
    const android = await api(app).get('/v1/app/version?platform=android').expect(200);
    expect(android.body.data.storeUrl).toBe('https://play.google.com/store/apps/details?id=day.whenwemeet.app');
    for (const bad of ['', '?platform=web', '?platform=IOS']) {
      const res = await api(app).get(`/v1/app/version${bad}`).expect(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
    }
  });

  it('관리자 엔드포인트: 익명 401, 일반 사용자 403', async () => {
    await api(app).get('/v1/admin/app-releases').expect(401);
    await api(app).get('/v1/admin/app-releases').set(auth(user)).expect(403);
    await put('ios', { latestVersion: '1.4.0' }, user).expect(403);
    expect(await prisma.appRelease.count()).toBe(0);
  });

  it('관리자 수정: 처음이면 행을 만들고 공개 응답과 목록에 바로 보인다, 조치 기록 한 줄', async () => {
    const res = await put('ios', { latestVersion: '1.4.0', minVersion: '1.1.0' }).expect(200);
    expect(res.body.data).toMatchObject({ platform: 'ios', latestVersion: '1.4.0', minVersion: '1.1.0', storeUrl: 'https://apps.apple.com/kr/app/id6832865813' });
    expect((await api(app).get('/v1/app/version?platform=ios').expect(200)).body.data).toMatchObject({ latestVersion: '1.4.0', minVersion: '1.1.0' });

    const list = await api(app).get('/v1/admin/app-releases').set(auth(admin)).expect(200);
    expect(list.body.data.map((r: { platform: string; latestVersion: string | null }) => [r.platform, r.latestVersion])).toEqual([
      ['ios', '1.4.0'],
      ['android', null],
    ]);

    const logs = await api(app).get('/v1/admin/logs').set(auth(admin)).expect(200);
    const row = await prisma.appRelease.findUniqueOrThrow({ where: { platform: 'ios' } });
    expect(logs.body.data.items[0]).toMatchObject({ action: 'app_release_update', targetType: 'app_release', targetId: row.id, reason: 'ios 최신 1.4.0, 최소 1.1.0', admin: { id: admin.userId } });
  });

  it('검증: 버전 형식, https 스토어 주소, 모르는 필드, 기종, 최소 > 최신은 400 이고 바뀌지 않는다', async () => {
    for (const body of [{ latestVersion: 'v1.5' }, { minVersion: '1.0.0-beta' }, { latestVersion: '' }, { storeUrl: 'http://apps.apple.com/x' }, { storeUrl: 'https://' + 'a'.repeat(500) }, { platform: 'ios' }]) {
      await put('ios', body).expect(400);
    }
    await put('web', { latestVersion: '1.0.0' }).expect(400);
    const res = await put('ios', { minVersion: '1.10.0' }).expect(400);
    expect(res.body.error.details).toEqual([expect.objectContaining({ field: 'minVersion' })]);
    expect(await prisma.appRelease.findUniqueOrThrow({ where: { platform: 'ios' } })).toMatchObject({ latestVersion: '1.4.0', minVersion: '1.1.0' });
  });

  it('준 값만 고친다(1.10.0 은 1.9.0 보다 높다), null 은 지우고 스토어 주소를 바꿀 수 있다', async () => {
    await put('ios', { latestVersion: '1.10.0', minVersion: '1.9.0' }).expect(200);
    await put('ios', { storeUrl: 'https://apps.apple.com/kr/app/id1' }).expect(200);
    expect((await api(app).get('/v1/app/version?platform=ios').expect(200)).body.data).toMatchObject({ latestVersion: '1.10.0', minVersion: '1.9.0', storeUrl: 'https://apps.apple.com/kr/app/id1' });
    await put('ios', { minVersion: null, storeUrl: null }).expect(200);
    expect((await api(app).get('/v1/app/version?platform=ios').expect(200)).body.data).toMatchObject({ latestVersion: '1.10.0', minVersion: null, storeUrl: 'https://apps.apple.com/kr/app/id6832865813' });
    await put('android', { latestVersion: '1.3.0' }).expect(200);
    expect((await api(app).get('/v1/app/version?platform=android').expect(200)).body.data.latestVersion).toBe('1.3.0');
    expect(await prisma.adminAction.count({ where: { action: 'app_release_update' } })).toBe(5);
  });
});
