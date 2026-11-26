import { PrismaService } from '../src/prisma/prisma.service.js';
import { PushScheduler } from '../src/push/push.scheduler.js';
import { FakeExpo } from './fake-expo.js';
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
 * (#544) 공지 읽은 사람과 푸시 결과 e2e (D-293). 실제 MySQL + 가짜 Expo 서버.
 * 처음 한 번만 기록(경로도 처음 것), 로그인하지 않으면 기록 없음, 초안과 없는 공지 404,
 * 관리자 결과(기기별 발송 집계, 경로별 읽음, 읽은 비율), 읽은 사람과 안 읽은 사람(푸시 대상 중) 목록, 관리자만
 */
describe('공지 읽음과 결과 (e2e, #544)', () => {
  const fake = new FakeExpo();
  let app: TestApp;
  let prisma: PrismaService;
  let scheduler: PushScheduler;
  let admin: Session;
  let jiwoo: Session;
  let minsu: Session;
  let noDevice: Session;
  let off: Session;

  const registerDevice = (
    session: Session,
    token: string,
    platform: 'IOS' | 'ANDROID',
  ) =>
    api(app)
      .put('/v1/me/push-devices')
      .set(auth(session))
      .send({ token, platform, appVersion: '1.3.0' })
      .expect(200);
  const createNotice = async (body: Record<string, unknown> = {}) =>
    (
      await api(app)
        .post('/v1/admin/notices')
        .set(auth(admin))
        .send({
          kind: 'notice',
          title: '새 기능 안내',
          body: '본문',
          published: true,
          ...body,
        })
        .expect(201)
    ).body.data as { id: number };
  const read = (
    session: Session | null,
    id: number,
    body: Record<string, unknown> = {},
  ) => {
    const req = api(app).post(`/v1/notices/${id}/read`);
    return (session ? req.set(auth(session)) : req).send(body);
  };
  const stats = (id: number) =>
    api(app).get(`/v1/admin/notices/${id}/stats`).set(auth(admin));
  const readers = (id: number, query = '') =>
    api(app).get(`/v1/admin/notices/${id}/readers${query}`).set(auth(admin));

  beforeAll(async () => {
    await fake.start();
    process.env.EXPO_PUSH_URL = fake.url;
    app = await createTestApp();
    prisma = app.get(PrismaService);
    scheduler = app.get(PushScheduler);
  });

  afterAll(async () => {
    await resetDb(app);
    await app.close();
    await fake.stop();
  });

  beforeEach(async () => {
    await resetDb(app);
    fake.reset();
    admin = await devLogin(app, '운영자');
    jiwoo = await devLogin(app, '지우');
    minsu = await devLogin(app, '민수');
    noDevice = await devLogin(app, '기기없음');
    off = await devLogin(app, '끈사람');
    await prisma.user.update({
      where: { id: admin.userId },
      data: { role: 'admin' },
    });
    await registerDevice(admin, 'ExponentPushToken[admin]', 'IOS');
    await registerDevice(jiwoo, 'ExponentPushToken[jiwoo-ios]', 'IOS');
    await registerDevice(jiwoo, 'ExponentPushToken[jiwoo-android]', 'ANDROID');
    await registerDevice(minsu, 'ExponentPushToken[minsu]', 'IOS');
    await registerDevice(off, 'ExponentPushToken[off]', 'IOS');
    await api(app)
      .patch('/v1/me/notification-settings')
      .set(auth(off))
      .send({ notice: false })
      .expect(200);
  });

  it('처음 한 번만: 경로와 시각은 처음 것 그대로, 다시 불러도 200 (멱등). via 생략은 detail', async () => {
    const { id } = await createNotice();
    const first = await read(jiwoo, id, { via: 'push' }).expect(200);
    expect(first.body.data).toMatchObject({ via: 'push', first: true });
    const again = await read(jiwoo, id, { via: 'list' }).expect(200);
    expect(again.body.data).toEqual({ ...first.body.data, first: false });
    expect(
      await prisma.noticeRead.findMany({ where: { noticeId: id } }),
    ).toEqual([
      {
        userId: jiwoo.userId,
        noticeId: id,
        firstReadAt: new Date(first.body.data.firstReadAt as string),
        via: 'push',
      },
    ]);

    // 경로마다 (팝업, 띠, 목록, 생략 = detail)
    const vias = await Promise.all([
      read(minsu, id, { via: 'popup' }).expect(200),
      read(noDevice, id, { via: 'banner' }).expect(200),
      read(off, id).expect(200),
    ]);
    expect(vias.map((r) => r.body.data.via)).toEqual([
      'popup',
      'banner',
      'detail',
    ]);
    await read(admin, id, { via: 'email' }).expect(400);
    expect(await prisma.noticeRead.count({ where: { noticeId: id } })).toBe(4);
  });

  it('로그인하지 않으면 기록하지 않는다: POST 401, GET /notices/:id 는 익명이든 로그인이든 기록하지 않는다', async () => {
    const { id } = await createNotice();
    await read(null, id, { via: 'push' }).expect(401);
    await api(app).get(`/v1/notices/${id}`).expect(200);
    await api(app).get(`/v1/notices/${id}`).set(auth(jiwoo)).expect(200);
    expect(await prisma.noticeRead.count()).toBe(0);
  });

  it('초안과 없는 공지는 404 이고 기록하지 않는다. 공지를 지우면 기록도 지워진다', async () => {
    const draft = (
      await api(app)
        .post('/v1/admin/notices')
        .set(auth(admin))
        .send({ kind: 'notice', title: '초안', body: '본문' })
        .expect(201)
    ).body.data as { id: number };
    await read(admin, draft.id).expect(404);
    await read(jiwoo, 999_999).expect(404);
    const { id } = await createNotice();
    await read(jiwoo, id).expect(200);
    await api(app)
      .delete(`/v1/admin/notices/${id}`)
      .set(auth(admin))
      .expect(200);
    expect(await prisma.noticeRead.count()).toBe(0);
  });

  it('결과: 기기별 발송(전달 성공 = 영수증 ok, 실패 = 오류나 영수증 오류, 대기), 경로별 읽음, 푸시 대상 중 읽은 비율', async () => {
    const { id } = await createNotice({ push: true });
    await scheduler.tick(new Date(Date.now() + 5_000));
    const notification = await prisma.pushNotification.findUniqueOrThrow({
      where: { dedupeKey: `N:${id}` },
    });
    // 대상은 운영자(1), 지우(2), 민수(1). 기기 없는 사람, 공지 알림 끈 사람은 빠진다
    const deliveries = await prisma.pushDelivery.findMany({
      where: { notificationId: notification.id },
      orderBy: { token: 'asc' },
    });
    expect(deliveries.map((d) => d.token)).toEqual([
      'ExponentPushToken[admin]',
      'ExponentPushToken[jiwoo-android]',
      'ExponentPushToken[jiwoo-ios]',
      'ExponentPushToken[minsu]',
    ]);
    const byToken = (token: string) =>
      deliveries.find((d) => d.token === token)!.id;
    // 운영자: 영수증 ok, 지우 iOS: 영수증 ok, 지우 Android: 영수증 오류, 민수: 보내기 실패
    await prisma.pushDelivery.updateMany({
      where: {
        id: {
          in: [
            byToken('ExponentPushToken[admin]'),
            byToken('ExponentPushToken[jiwoo-ios]'),
          ],
        },
      },
      data: { receipt: 'ok' },
    });
    await prisma.pushDelivery.update({
      where: { id: byToken('ExponentPushToken[jiwoo-android]') },
      data: { receipt: 'DeviceNotRegistered' },
    });
    await prisma.pushDelivery.update({
      where: { id: byToken('ExponentPushToken[minsu]') },
      data: { status: 'FAILED', error: 'TIMEOUT', ticketId: null },
    });

    await read(jiwoo, id, { via: 'push' }).expect(200);
    await read(admin, id, { via: 'popup' }).expect(200);
    // 푸시 대상이 아닌 사람의 읽음은 전체 읽음에는 들고 비율에는 들지 않는다
    await read(noDevice, id, { via: 'list' }).expect(200);

    const res = (await stats(id).expect(200)).body.data;
    expect(res).toMatchObject({
      noticeId: id,
      push: {
        status: 'DISPATCHED',
        targetUsers: 3,
        devices: 4,
        sent: 3,
        delivered: 2,
        failed: 2,
        pending: 0,
      },
      reads: {
        total: 3,
        byVia: { list: 1, detail: 0, push: 1, popup: 1, banner: 0 },
        pushOpened: 1,
      },
      readRateBasis: { of: 'push', read: 2, total: 3 },
    });
    expect(res.pushedAt).not.toBeNull();
    expect(res.readRate).toBeCloseTo(2 / 3);

    // 영수증을 아직 확인하지 않은 기기는 대기
    await prisma.pushDelivery.update({
      where: { id: byToken('ExponentPushToken[jiwoo-ios]') },
      data: { receipt: null },
    });
    expect((await stats(id).expect(200)).body.data.push).toMatchObject({
      delivered: 1,
      failed: 2,
      pending: 1,
    });
  });

  it('결과: 푸시를 보내지 않은 공지는 push null, 전체 사용자 중 읽은 비율. 아직 펼치기 전이면 대상 0 과 비율 null', async () => {
    const { id } = await createNotice();
    await read(jiwoo, id, { via: 'list' }).expect(200);
    const res = (await stats(id).expect(200)).body.data;
    expect(res).toMatchObject({
      push: null,
      reads: { total: 1 },
      readRate: 0.2,
      readRateBasis: { of: 'users', read: 1, total: 5 },
    });

    const pushed = await createNotice({ push: true });
    expect((await stats(pushed.id).expect(200)).body.data).toMatchObject({
      push: { status: 'PENDING', targetUsers: 0, devices: 0 },
      readRate: null,
    });
    await api(app)
      .get('/v1/admin/notices/999999/stats')
      .set(auth(admin))
      .expect(404);
  });

  it('읽은 사람: 읽은 시각 내림차순, 이름 검색, 경로 필터, 페이지. 안 읽은 사람(unread=1)은 푸시 대상 중 읽지 않은 사람만', async () => {
    const { id } = await createNotice({ push: true });
    await scheduler.tick(new Date(Date.now() + 5_000));
    await read(jiwoo, id, { via: 'push' }).expect(200);
    await prisma.noticeRead.update({
      where: { userId_noticeId: { userId: jiwoo.userId, noticeId: id } },
      data: { firstReadAt: new Date(Date.now() - 60_000) },
    });
    await read(noDevice, id, { via: 'list' }).expect(200);

    const all = (await readers(id).expect(200)).body.data;
    expect(all.nextCursor).toBeNull();
    expect(all.items).toEqual([
      {
        id: noDevice.userId,
        nickname: '기기없음',
        profileImageUrl: null,
        firstReadAt: expect.any(String),
        via: 'list',
      },
      {
        id: jiwoo.userId,
        nickname: '지우',
        profileImageUrl: null,
        firstReadAt: expect.any(String),
        via: 'push',
      },
    ]);
    expect(
      (await readers(id, '?via=push').expect(200)).body.data.items.map(
        (r: { id: number }) => r.id,
      ),
    ).toEqual([jiwoo.userId]);
    expect(
      (
        await readers(id, `?q=${encodeURIComponent('지')}`).expect(200)
      ).body.data.items.map((r: { id: number }) => r.id),
    ).toEqual([jiwoo.userId]);
    await readers(id, '?via=email').expect(400);

    const first = (await readers(id, '?limit=1').expect(200)).body.data;
    expect(first.items.map((r: { id: number }) => r.id)).toEqual([
      noDevice.userId,
    ]);
    expect(first.nextCursor).toBe(noDevice.userId);
    const second = (
      await readers(id, `?limit=1&cursor=${first.nextCursor}`).expect(200)
    ).body.data;
    expect(second).toMatchObject({
      items: [{ id: jiwoo.userId }],
      nextCursor: null,
    });

    // 대상: 운영자, 지우, 민수. 지우는 읽었고 기기없음은 대상이 아니다. id 내림차순
    const unread = (await readers(id, '?unread=1').expect(200)).body.data;
    expect(unread.items).toEqual([
      {
        id: minsu.userId,
        nickname: '민수',
        profileImageUrl: null,
        firstReadAt: null,
        via: null,
      },
      {
        id: admin.userId,
        nickname: '운영자',
        profileImageUrl: null,
        firstReadAt: null,
        via: null,
      },
    ]);
    const unreadPage = (await readers(id, '?unread=1&limit=1').expect(200)).body
      .data;
    expect(unreadPage).toMatchObject({
      items: [{ id: minsu.userId }],
      nextCursor: minsu.userId,
    });
    expect(
      (
        await readers(id, `?unread=1&limit=1&cursor=${minsu.userId}`).expect(
          200,
        )
      ).body.data,
    ).toMatchObject({ items: [{ id: admin.userId }], nextCursor: null });
    expect(
      (
        await readers(id, `?unread=1&q=${encodeURIComponent('운영')}`).expect(
          200,
        )
      ).body.data.items.map((r: { id: number }) => r.id),
    ).toEqual([admin.userId]);

    // 푸시를 보내지 않은 공지의 안 읽은 사람은 빈 목록
    const quiet = await createNotice();
    expect(
      (await readers(quiet.id, '?unread=1').expect(200)).body.data,
    ).toEqual({ items: [], nextCursor: null });
  });

  it('관리자 공지 목록에 readCount', async () => {
    const a = await createNotice({ title: '가' });
    const b = await createNotice({ title: '나' });
    await read(jiwoo, a.id).expect(200);
    await read(minsu, a.id).expect(200);
    const items = (
      await api(app).get('/v1/admin/notices').set(auth(admin)).expect(200)
    ).body.data.items as { id: number; readCount: number }[];
    expect(items.map((n) => [n.id, n.readCount])).toEqual([
      [b.id, 0],
      [a.id, 2],
    ]);
  });

  it('관리자만: 일반 사용자는 결과와 읽은 사람 403, 로그인하지 않으면 401', async () => {
    const { id } = await createNotice();
    await api(app)
      .get(`/v1/admin/notices/${id}/stats`)
      .set(auth(jiwoo))
      .expect(403);
    await api(app)
      .get(`/v1/admin/notices/${id}/readers`)
      .set(auth(jiwoo))
      .expect(403);
    await api(app)
      .get(`/v1/admin/notices/${id}/readers?unread=1`)
      .set(auth(jiwoo))
      .expect(403);
    await api(app).get(`/v1/admin/notices/${id}/stats`).expect(401);
  });
});
