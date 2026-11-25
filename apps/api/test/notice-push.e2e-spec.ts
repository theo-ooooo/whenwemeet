import { PrismaService } from '../src/prisma/prisma.service.js';
import { PushScheduler } from '../src/push/push.scheduler.js';
import { FakeExpo } from './fake-expo.js';
import { api, auth, createTestApp, devLogin, resetDb, type Session, type TestApp } from './helpers.js';

/**
 * (#528) 공지 푸시 e2e (D-287). 실제 MySQL + 가짜 Expo 서버.
 * 게시와 같이 한 번만 예약, 초안 400, 두 번째 409, 받는 사람(공지 알림 끈 사람, 기기 없는 사람 제외, 기기마다 1건),
 * 문구와 경로, 조치 기록 notice_push
 */
describe('공지 푸시 (e2e, #528)', () => {
  const fake = new FakeExpo();
  let app: TestApp;
  let prisma: PrismaService;
  let scheduler: PushScheduler;
  let admin: Session;
  let on: Session;
  let off: Session;
  let noDevice: Session;

  const TOKENS = {
    admin: 'ExponentPushToken[admin-ios]',
    onIos: 'ExponentPushToken[on-ios]',
    onAndroid: 'ExponentPushToken[on-android]',
    off: 'ExponentPushToken[off-ios]',
  };

  const registerDevice = (session: Session, token: string, platform: 'IOS' | 'ANDROID') =>
    api(app).put('/v1/me/push-devices').set(auth(session)).send({ token, platform, appVersion: '1.3.0' }).expect(200);
  const create = (body: Record<string, unknown>) => api(app).post('/v1/admin/notices').set(auth(admin)).send({ kind: 'notice', title: '점검 안내', body: '본문', ...body });
  const patch = (id: number, body: Record<string, unknown>) => api(app).patch(`/v1/admin/notices/${id}`).set(auth(admin)).send(body);
  /** 예약 시각(요청 시각) 뒤로 틱 */
  const tick = () => scheduler.tick(new Date(Date.now() + 5_000));
  const noticeMessages = () => fake.messages.filter((m) => m.data.kind === 'NOTICE');

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
    on = await devLogin(app, '받는사람');
    off = await devLogin(app, '끈사람');
    noDevice = await devLogin(app, '기기없음');
    await prisma.user.update({ where: { id: admin.userId }, data: { role: 'admin' } });
    await registerDevice(admin, TOKENS.admin, 'IOS');
    await registerDevice(on, TOKENS.onIos, 'IOS');
    await registerDevice(on, TOKENS.onAndroid, 'ANDROID');
    await registerDevice(off, TOKENS.off, 'IOS');
    await api(app).patch('/v1/me/notification-settings').set(auth(off)).send({ notice: false }).expect(200);
  });

  it('게시하며 push: pushedAt 을 적고 예약 1건, 틱 뒤 기기 있고 공지를 켠 사람의 모든 기기로 1번씩', async () => {
    const res = await create({ title: '12월 점검 안내', body: '\n  12월 1일 새벽 2시부터 30분 동안 점검해요  \n자세한 내용은 아래', published: true, push: true }).expect(201);
    const notice = res.body.data as { id: number; pushedAt: string | null; publishedAt: string | null };
    expect(notice.pushedAt).not.toBeNull();
    expect(notice.publishedAt).not.toBeNull();

    const rows = await prisma.pushNotification.findMany({ where: { kind: 'NOTICE' } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ dedupeKey: `N:${notice.id}`, groupId: null, status: 'PENDING' });

    await tick();
    const messages = noticeMessages();
    // 끈 사람(off), 기기 없는 사람(noDevice)은 빠지고, 관리자 자신은 받는다. 기기마다 한 번
    expect(messages.map((m) => m.to).sort()).toEqual([TOKENS.admin, TOKENS.onAndroid, TOKENS.onIos].sort());
    for (const m of messages) {
      expect(m).toMatchObject({ title: '12월 점검 안내', body: '12월 1일 새벽 2시부터 30분 동안 점검해요', data: { url: `/notices/${notice.id}?from=push`, kind: 'NOTICE' } });
      // 팀이 없어 iOS 부제, Android 앞머리가 없다
      expect(m.subtitle).toBeUndefined();
    }
    expect(await prisma.pushDelivery.count({ where: { userId: { in: [off.userId, noDevice.userId] } } })).toBe(0);
    expect(await prisma.pushNotification.findFirstOrThrow({ where: { kind: 'NOTICE' } })).toMatchObject({ status: 'DISPATCHED' });

    // 다시 틱해도 더 가지 않는다
    await tick();
    expect(noticeMessages()).toHaveLength(3);

    const actions = await prisma.adminAction.findMany({ where: { targetType: 'notice', targetId: notice.id }, orderBy: { id: 'asc' } });
    expect(actions.map((a) => a.action)).toEqual(['notice_create', 'notice_push']);
    expect(actions[1]).toMatchObject({ adminId: admin.userId });
  });

  it('두 번째 push 는 409 NOTICE_ALREADY_PUSHED 이고 고친 내용도 저장되지 않는다. push 없이 고치기는 된다', async () => {
    const { id } = (await create({ published: true, push: true }).expect(201)).body.data as { id: number };
    const again = await patch(id, { title: '바꾼 제목', push: true }).expect(409);
    expect(again.body.error.code).toBe('NOTICE_ALREADY_PUSHED');
    expect((await prisma.notice.findUniqueOrThrow({ where: { id } })).title).toBe('점검 안내');
    expect(await prisma.pushNotification.count({ where: { kind: 'NOTICE' } })).toBe(1);

    // 게시 취소 뒤 다시 게시해도 다시 보내지 않는다 (push 를 주지 않으면)
    await patch(id, { published: false }).expect(200);
    const back = await patch(id, { published: true, title: '바꾼 제목' }).expect(200);
    expect(back.body.data.pushedAt).not.toBeNull();
    expect(await prisma.pushNotification.count({ where: { kind: 'NOTICE' } })).toBe(1);
    expect(await prisma.adminAction.count({ where: { action: 'notice_push' } })).toBe(1);
  });

  it('초안은 못 보낸다: 만들기, 초안 고치기, 게시 취소와 같이 push 는 400 (field push). 초안을 게시하며 push 는 된다', async () => {
    const draft = await create({ push: true }).expect(400);
    expect(draft.body.error).toMatchObject({ code: 'VALIDATION_FAILED', details: [{ field: 'push' }] });
    expect(await prisma.notice.count()).toBe(0);

    const { id } = (await create({}).expect(201)).body.data as { id: number };
    await patch(id, { push: true }).expect(400);
    await patch(id, { published: false, push: true }).expect(400);
    expect(await prisma.pushNotification.count({ where: { kind: 'NOTICE' } })).toBe(0);

    const published = await patch(id, { published: true, push: true }).expect(200);
    expect(published.body.data.pushedAt).not.toBeNull();
    expect(await prisma.pushNotification.count({ where: { kind: 'NOTICE', dedupeKey: `N:${id}` } })).toBe(1);

    // 이미 게시된 공지에 push 를 더한 것과 같은 결과 + push 값 검증
    await patch(id, { push: 'yes' }).expect(400);
  });

  it('펼치기 전에 게시 취소하거나 지우면 보내지 않는다(SKIPPED). 펼칠 때의 제목으로 보낸다', async () => {
    const first = (await create({ title: '처음 제목', published: true, push: true }).expect(201)).body.data as { id: number };
    await patch(first.id, { title: '고친 제목' }).expect(200);
    const second = (await create({ title: '곧 내림', published: true, push: true }).expect(201)).body.data as { id: number };
    await patch(second.id, { published: false }).expect(200);
    const third = (await create({ title: '곧 지움', published: true, push: true }).expect(201)).body.data as { id: number };
    await api(app).delete(`/v1/admin/notices/${third.id}`).set(auth(admin)).expect(200);

    await tick();
    expect([...new Set(noticeMessages().map((m) => m.title))]).toEqual(['고친 제목']);
    const statuses = await prisma.pushNotification.findMany({ where: { kind: 'NOTICE' }, select: { dedupeKey: true, status: true }, orderBy: { id: 'asc' } });
    expect(statuses).toEqual([
      { dedupeKey: `N:${first.id}`, status: 'DISPATCHED' },
      { dedupeKey: `N:${second.id}`, status: 'SKIPPED' },
      { dedupeKey: `N:${third.id}`, status: 'SKIPPED' },
    ]);
  });

  it('공지 설정: GET 기본 켬, 끈 사람은 다시 켜면 받는다', async () => {
    expect((await api(app).get('/v1/me/notification-settings').set(auth(on)).expect(200)).body.data.notice).toBe(true);
    expect((await api(app).get('/v1/me/notification-settings').set(auth(off)).expect(200)).body.data.notice).toBe(false);
    await api(app).patch('/v1/me/notification-settings').set(auth(off)).send({ notice: true }).expect(200);
    await create({ published: true, push: true }).expect(201);
    await tick();
    expect(noticeMessages().map((m) => m.to)).toContain(TOKENS.off);
  });
});
