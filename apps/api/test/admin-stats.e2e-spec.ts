import { AdminStatsClock } from '../src/admin/admin-stats.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  api,
  auth,
  createTestApp,
  devLogin,
  resetDb,
  type Session,
  type TestApp,
} from './helpers.js';

/**
 * (#537) 관리자 대시보드 지표 (api.md 2.19, D-290). KST 날짜 경계, 빈 날 0, 쓰는 곳 규칙(관리자 사용자 목록과 같다), 60초 캐시.
 * 시계를 2027-01-10 12:00 KST 로 고정하고, devLogin 으로 만든 사람(가입 시각 = 실제 지금)은 기간 밖이라 날짜별 수에 들지 않는다
 */
describe('관리자 대시보드 (e2e, #537)', () => {
  let app: TestApp;
  let prisma: PrismaService;
  let clock: AdminStatsClock;
  let admin: Session;
  let now = Date.parse('2027-01-10T03:00:00.000Z');

  const at = (iso: string) => new Date(iso);

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    clock = app.get(AdminStatsClock);
    clock.now = () => now;
    await resetDb(app);
    admin = await devLogin(app, '운영자');
    await prisma.user.update({
      where: { id: admin.userId },
      data: { role: 'admin' },
    });
    const ios = await devLogin(app, '아이폰');
    const android = await devLogin(app, '안드');
    const web = await devLogin(app, '웹만');
    const unknown = await devLogin(app, '기종모름');
    // 가입: 01-10 00:30 KST(=01-09 15:30 UTC) 는 10일, 01-10 00:00 KST 1분 전은 9일, 첫날(01-04 KST) 자정 1초 전은 기간 밖이라 빠진다
    await prisma.user.update({
      where: { id: ios.userId },
      data: { createdAt: at('2027-01-09T15:30:00.000Z') },
    });
    await prisma.user.update({
      where: { id: android.userId },
      data: { createdAt: at('2027-01-09T14:59:00.000Z') },
    });
    await prisma.user.update({
      where: { id: web.userId },
      data: { createdAt: at('2027-01-04T15:00:00.000Z') },
    });
    await prisma.user.update({
      where: { id: unknown.userId },
      data: {
        createdAt: at('2027-01-03T14:59:59.000Z'),
        lastAppLoginAt: at('2027-01-05T00:00:00.000Z'),
      },
    });
    // 접속: 아이폰은 iOS 와 웹(같은 날 두 기종이어도 한 명), 안드는 푸시 기기만(활동에는 안 든다), 웹만은 6일
    await prisma.userClient.createMany({
      data: [
        {
          userId: ios.userId,
          platform: 'ios',
          appVersion: '1.3.0',
          lastSeenAt: at('2027-01-10T01:00:00.000Z'),
        },
        {
          userId: ios.userId,
          platform: 'web',
          lastSeenAt: at('2027-01-10T02:00:00.000Z'),
        },
        {
          userId: web.userId,
          platform: 'web',
          lastSeenAt: at('2027-01-06T10:00:00.000Z'),
        },
        {
          userId: admin.userId,
          platform: 'web',
          lastSeenAt: at('2026-12-20T00:00:00.000Z'),
        },
      ],
    });
    await prisma.pushDevice.create({
      data: {
        userId: android.userId,
        token: 'ExponentPushToken[stats]',
        platform: 'ANDROID',
        appVersion: '1.2.1',
      },
    });
    await prisma.assistantUsage.createMany({
      data: [
        { userId: ios.userId, day: at('2027-01-10T00:00:00.000Z'), count: 4 },
        { userId: web.userId, day: at('2027-01-10T00:00:00.000Z'), count: 2 },
        { userId: web.userId, day: at('2027-01-08T00:00:00.000Z'), count: 1 },
        { userId: web.userId, day: at('2026-12-20T00:00:00.000Z'), count: 9 },
      ],
    });
    const team = await api(app)
      .post('/v1/groups')
      .set(auth(ios))
      .send({ name: '팀' })
      .expect(201);
    await api(app)
      .post(`/v1/groups/${team.body.data.id}/events`)
      .set(auth(ios))
      .send({
        title: '회식',
        allDay: false,
        startsAt: '2027-01-12T19:00:00+09:00',
        endsAt: '2027-01-12T21:00:00+09:00',
      })
      .expect(201);
    await api(app)
      .post('/v1/reports')
      .set(auth(ios))
      .send({
        targetType: 'group',
        targetId: team.body.data.id,
        reason: 'spam',
      })
      .expect(201);
  });

  afterAll(async () => {
    await resetDb(app);
    await app.close();
  });

  it('관리자만, range 는 7 또는 30', async () => {
    const user = await devLogin(app, '일반');
    await api(app).get('/v1/admin/stats').set(auth(user)).expect(403);
    await api(app)
      .get('/v1/admin/stats')
      .query({ range: '14' })
      .set(auth(admin))
      .expect(400);
    await api(app).delete('/v1/me').set(auth(user)).expect(200);
  });

  it('7일: 날짜마다 한 줄(오래된 날 먼저, 빈 날 0), KST 경계, 합계와 쓰는 곳', async () => {
    const { data } = (
      await api(app).get('/v1/admin/stats').set(auth(admin)).expect(200)
    ).body;
    expect(data).toMatchObject({
      range: 7,
      from: '2027-01-04',
      to: '2027-01-10',
    });
    expect(data.days.map((d: { day: string }) => d.day)).toEqual([
      '2027-01-04',
      '2027-01-05',
      '2027-01-06',
      '2027-01-07',
      '2027-01-08',
      '2027-01-09',
      '2027-01-10',
    ]);
    const byDay = Object.fromEntries(
      data.days.map((d: { day: string }) => [d.day, d]),
    );
    expect(byDay['2027-01-10']).toEqual({
      day: '2027-01-10',
      signups: 1,
      activeUsers: 1,
      assistantMessages: 6,
      assistantUsers: 2,
    });
    expect(byDay['2027-01-09']).toMatchObject({ signups: 1, activeUsers: 0 });
    expect(byDay['2027-01-05']).toMatchObject({ signups: 1 });
    expect(byDay['2027-01-04']).toMatchObject({ signups: 0 });
    expect(byDay['2027-01-06']).toMatchObject({ activeUsers: 1 });
    expect(byDay['2027-01-08']).toMatchObject({
      assistantMessages: 1,
      assistantUsers: 1,
    });
    expect(data.totals).toEqual({
      users: 5,
      teams: 1,
      personalCalendars: 5,
      events: 1,
      notices: 0,
      openReports: 1,
      activeUsers: 2,
      signupsInRange: 3,
      assistantMessagesInRange: 7,
    });
    // 아이폰(ios, web), 안드(android, 기기만), 웹만(web), 기종모름(앱 로그인만), 운영자(web)
    expect(data.platforms).toEqual({ ios: 1, android: 1, web: 3, unknown: 1 });
  });

  it('30일과 60초 캐시: 같은 기간은 60초 동안 그대로, 지나면 새로', async () => {
    const month = (
      await api(app)
        .get('/v1/admin/stats')
        .query({ range: '30' })
        .set(auth(admin))
        .expect(200)
    ).body.data;
    expect(month.days).toHaveLength(30);
    expect(month.from).toBe('2026-12-12');
    expect(month.totals.assistantMessagesInRange).toBe(16);
    expect(month.totals.activeUsers).toBe(3);
    await prisma.notice.create({
      data: {
        title: '새 공지',
        body: '본문',
        kind: 'notice',
        publishedAt: at('2027-01-10T00:00:00.000Z'),
      },
    });
    const cached = (
      await api(app)
        .get('/v1/admin/stats')
        .query({ range: '30' })
        .set(auth(admin))
        .expect(200)
    ).body.data;
    expect(cached.totals.notices).toBe(0);
    expect(cached.generatedAt).toBe(month.generatedAt);
    now += 60_000;
    const fresh = (
      await api(app)
        .get('/v1/admin/stats')
        .query({ range: '30' })
        .set(auth(admin))
        .expect(200)
    ).body.data;
    expect(fresh.totals.notices).toBe(1);
  });
});
