import { kstDate } from '../src/events/recurrence.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { PushScheduler } from '../src/push/push.scheduler.js';
import { FakeExpo } from './fake-expo.js';
import { api, auth, createTestApp, devLogin, resetDb, type Session, type TestApp } from './helpers.js';

/**
 * (#297) 팀에 들어오기 전 일은 새 소식과 알림에서 뺀다 (D-180).
 * - 새 소식(v1, v2)과 안 읽은 수: createdAt >= 내 joinedAt 만
 * - 지난 일을 알리는 CHANGE, JOIN: 예약을 만든 시각까지 들어와 있던 팀원만
 * - 앞날 알림 REMINDER: 펼칠 때 팀원이면 받는다 (그대로)
 */
describe('들어오기 전 일 빼기 (e2e, #297)', () => {
  const fake = new FakeExpo();
  let app: TestApp;
  let prisma: PrismaService;
  let scheduler: PushScheduler;
  let minji: Session;
  let jihun: Session;
  let carol: Session;
  let groupId: number;
  let inviteCode: string;

  const MINJI_TOKEN = 'ExponentPushToken[minji]';
  const JIHUN_TOKEN = 'ExponentPushToken[jihun]';
  const CAROL_TOKEN = 'ExponentPushToken[carol]';
  const DAY_MS = 86_400_000;
  const day = kstDate(new Date(Date.now() + 2 * DAY_MS));
  const at = (time: string) => new Date(`${day}T${time}+09:00`);
  const afterCoalesce = () => new Date(Date.now() + 2 * 60 * 1000 + 5_000);
  /** 같은 밀리초에 기록과 합류가 겹치지 않게 (경계는 단위 테스트가 본다) */
  const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

  const registerDevice = (session: Session, token: string) =>
    api(app).put('/v1/me/push-devices').set(auth(session)).send({ token, platform: 'IOS', appVersion: '1.1.0' }).expect(200);
  const join = async (session: Session) => {
    await tick();
    await api(app).post('/v1/groups/join').set(auth(session)).send({ code: inviteCode }).expect(200);
    await tick();
  };
  const createEvent = async (session: Session, title: string, extra: Record<string, unknown> = {}) =>
    (
      await api(app)
        .post(`/v1/groups/${groupId}/events`)
        .set(auth(session))
        .send({ title, startsAt: at('18:00:00').toISOString(), endsAt: at('20:00:00').toISOString(), allDay: false, participants: 'ALL', ...extra })
        .expect(201)
    ).body.data as { id: number };
  const news = async (who: Session, v2 = true) => {
    const req = api(app).get(`/v1/groups/${groupId}/news`).set(auth(who));
    return (await (v2 ? req.query({ v: '2' }) : req).expect(200)).body.data.items as Record<string, unknown>[];
  };
  const badge = async (who: Session) => {
    const res = await api(app).get('/v1/groups').set(auth(who)).expect(200);
    return (res.body.data as { id: number; unreadNewsCount: number }[]).find((g) => g.id === groupId)!.unreadNewsCount;
  };
  const to = (token: string) => fake.messages.filter((m) => m.to === token);

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
    minji = await devLogin(app, '민지');
    jihun = await devLogin(app, '지훈');
    carol = await devLogin(app, '캐롤');
    const created = await api(app).post('/v1/groups').set(auth(minji)).send({ name: '우리' }).expect(201);
    groupId = created.body.data.id as number;
    inviteCode = created.body.data.inviteCode as string;
    await join(jihun);
    for (const [session, token] of [
      [minji, MINJI_TOKEN],
      [jihun, JIHUN_TOKEN],
      [carol, CAROL_TOKEN],
    ] as const)
      await registerDevice(session, token);
    // 준비 단계의 합류 알림은 대상이 아니다
    await prisma.pushNotification.updateMany({ where: { status: 'PENDING' }, data: { status: 'SKIPPED' } });
  });

  it('새 소식: 들어오기 전 일정 기록, 팀 활동은 안 보이고 안 읽은 수에도 없다. 먼저 있던 팀원은 둘 다 본다', async () => {
    await createEvent(minji, '들어오기 전 일정');
    await api(app).patch(`/v1/groups/${groupId}`).set(auth(minji)).send({ name: '우리 집' }).expect(200);
    await join(carol);

    expect(await news(carol)).toEqual([]);
    expect(await news(carol, false)).toEqual([]);
    expect(await badge(carol)).toBe(0);
    const forJihun = await news(jihun);
    expect(forJihun.map((item) => item.kind)).toEqual(expect.arrayContaining(['EVENT', 'ACTIVITY']));
    expect(forJihun.some((item) => item.kind === 'EVENT' && item.title === '들어오기 전 일정')).toBe(true);

    await createEvent(minji, '들어온 뒤 일정');
    const after = await news(carol);
    expect(after).toEqual([expect.objectContaining({ kind: 'EVENT', title: '들어온 뒤 일정', isNew: true })]);
    expect(await badge(carol)).toBe(1);
  });

  it('알림: 2분 묶음 중에 들어오면 그 변경은 받지 않는다. 먼저 있던 팀원은 받는다', async () => {
    const event = await createEvent(minji, '점심');
    await join(carol);
    await scheduler.tick(afterCoalesce());
    const changes = fake.messages.filter((m) => m.data.kind === 'CHANGE');
    expect(changes.map((m) => m.to)).toEqual([JIHUN_TOKEN]);
    expect(to(CAROL_TOKEN)).toEqual([]);
    fake.reset();

    // 묶음이 열린 뒤 들어오면, 들어온 뒤의 수정이 같은 묶음에 합쳐져도 받지 않는다 (묶음의 첫 변경 시각 기준)
    await api(app).patch(`/v1/groups/${groupId}/events/${event.id}`).set(auth(minji)).send({ title: '점심 1' }).expect(200);
    await prisma.membership.updateMany({ where: { userId: carol.userId }, data: { joinedAt: new Date() } });
    await tick();
    await api(app).patch(`/v1/groups/${groupId}/events/${event.id}`).set(auth(minji)).send({ title: '점심 2' }).expect(200);
    await scheduler.tick(afterCoalesce());
    expect(to(CAROL_TOKEN)).toEqual([]);
    expect(to(JIHUN_TOKEN)).toEqual([expect.objectContaining({ body: expect.stringMatching(/^점심 2, /) })]);
    fake.reset();

    // 들어온 뒤의 변경은 받는다
    await api(app).patch(`/v1/groups/${groupId}/events/${event.id}`).set(auth(minji)).send({ title: '점심 3' }).expect(200);
    await scheduler.tick(afterCoalesce());
    expect(to(CAROL_TOKEN)).toEqual([expect.objectContaining({ body: expect.stringMatching(/^점심 3, /) })]);
  });

  it('합류 알림: 남의 합류 뒤에 들어온 사람은 그 합류 알림을 받지 않는다', async () => {
    await join(carol);
    const dave = await devLogin(app, '데이브');
    await registerDevice(dave, 'ExponentPushToken[dave]');
    await join(dave);
    await scheduler.tick(new Date(Date.now() + 1_000));
    const joins = fake.messages.filter((m) => m.data.kind === 'JOIN');
    expect(joins.filter((m) => m.title.startsWith('캐롤')).map((m) => m.to).sort()).toEqual([JIHUN_TOKEN, MINJI_TOKEN].sort());
    expect(joins.filter((m) => m.title.startsWith('데이브')).map((m) => m.to).sort()).toEqual([CAROL_TOKEN, JIHUN_TOKEN, MINJI_TOKEN].sort());
  });

  it('일정 알림(앞날): 예약된 일정이 들어오기 전 것이어도 펼칠 때 팀원이면 받는다', async () => {
    await createEvent(minji, '저녁 약속', { reminder: 'HOUR_1' });
    await join(carol);
    await scheduler.tick(at('17:00:10'));
    const reminders = fake.messages.filter((m) => m.data.kind === 'REMINDER');
    expect(reminders.map((m) => m.to).sort()).toEqual([CAROL_TOKEN, JIHUN_TOKEN, MINJI_TOKEN].sort());
  });

  it('다시 들어오면 멤버십을 새로 만들어 joinedAt 이 다시 들어온 시각. 나가 있던 동안과 그 전 기록은 안 보인다', async () => {
    await join(carol);
    await createEvent(minji, '함께 있을 때');
    expect((await news(carol)).some((item) => item.title === '함께 있을 때')).toBe(true);
    await api(app).delete(`/v1/groups/${groupId}/me`).set(auth(carol)).expect(200);
    await createEvent(minji, '나가 있을 때');
    await join(carol);

    const items = await news(carol);
    expect(items.filter((item) => item.kind === 'EVENT')).toEqual([]);
    expect(await badge(carol)).toBe(0);
  });
});
