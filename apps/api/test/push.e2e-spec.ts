import { ConfigService } from '@nestjs/config';
import { kstDate } from '../src/events/recurrence.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { AnniversaryPlanner } from '../src/push/anniversary-planner.js';
import { PushDispatcher } from '../src/push/push-dispatcher.js';
import { PushRepository } from '../src/push/push.repository.js';
import { PushScheduler } from '../src/push/push.scheduler.js';
import { ReminderPlanner } from '../src/push/reminder-planner.js';
import { FakeExpo } from './fake-expo.js';
import { api, auth, createTestApp, devLogin, resetDb, type Session, type TestApp } from './helpers.js';

/**
 * 푸시 알림 e2e (#188, 설계 11장). 실제 MySQL + 가짜 Expo 서버(EXPO_PUSH_URL).
 * 인터벌은 꺼져 있고(PUSH_ENABLED 없음) 시계는 `PushScheduler.tick(now)` 로 넘긴다
 */
describe('푸시 알림 (e2e)', () => {
  const fake = new FakeExpo();
  let app: TestApp;
  let prisma: PrismaService;
  let scheduler: PushScheduler;
  let minji: Session;
  let jihun: Session;
  let groupId: number;
  let inviteCode: string;

  const MINJI_TOKEN = 'ExponentPushToken[minji-ios]';
  const JIHUN_TOKEN = 'ExponentPushToken[jihun-android]';
  const DAY_MS = 86_400_000;
  /** 실제 시각 기준 이틀 뒤 KST 날짜. 일정 저장(reminderSetAt = 실제 지금) 보다 알림 시각이 뒤가 되게 */
  const day = kstDate(new Date(Date.now() + 2 * DAY_MS));
  const at = (time: string, date = day) => new Date(`${date}T${time}+09:00`);
  /** 팀원 변경 묶음(2분) 이 끝난 뒤 */
  const afterCoalesce = () => new Date(Date.now() + 2 * 60 * 1000 + 5_000);

  const registerDevice = (session: Session, token: string, platform: 'IOS' | 'ANDROID') =>
    api(app).put('/v1/me/push-devices').set(auth(session)).send({ token, platform, appVersion: '1.1.0' }).expect(200);

  /** (#248) 기존 시나리오는 팀원 모두가 받는 "모두" 일정. 본문에 participants 가 있으면 그 값 */
  const createEvent = async (session: Session, body: Record<string, unknown>) =>
    (await api(app).post(`/v1/groups/${groupId}/events`).set(auth(session)).send({ participants: 'ALL', ...body }).expect(201)).body.data as {
      id: number;
      reminder: string;
    };

  const timed = (title: string, start: string, end: string, extra: Record<string, unknown> = {}) => ({
    title,
    startsAt: at(start).toISOString(),
    endsAt: at(end).toISOString(),
    allDay: false,
    ...extra,
  });

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
    const created = await api(app).post('/v1/groups').set(auth(minji)).send({ name: '우리' }).expect(201);
    groupId = created.body.data.id as number;
    inviteCode = created.body.data.inviteCode as string;
    await api(app).post('/v1/groups/join').set(auth(jihun)).send({ code: inviteCode }).expect(200);
    await registerDevice(minji, MINJI_TOKEN, 'IOS');
    await registerDevice(jihun, JIHUN_TOKEN, 'ANDROID');
    // 준비 단계의 합류 알림은 이 테스트들의 대상이 아니다
    await prisma.pushNotification.updateMany({ where: { status: 'PENDING' }, data: { status: 'SKIPPED' } });
  });

  describe('기기와 설정 API (7-1)', () => {
    it('PUT 검증: 토큰 형식, platform, appVersion. 인증 없으면 401', async () => {
      const put = (body: Record<string, unknown>) => api(app).put('/v1/me/push-devices').set(auth(minji)).send(body);
      expect((await put({ token: 'abc', platform: 'IOS', appVersion: '1.1.0' }).expect(400)).body.error.details[0].field).toBe('token');
      expect((await put({ token: MINJI_TOKEN, platform: 'WEB', appVersion: '1.1.0' }).expect(400)).body.error.details[0].field).toBe('platform');
      expect((await put({ token: MINJI_TOKEN, platform: 'IOS', appVersion: '' }).expect(400)).body.error.details[0].field).toBe('appVersion');
      await put({ token: 'ExpoPushToken[short-form_1]', platform: 'IOS', appVersion: '1.1.0' }).expect(200);
      await api(app).put('/v1/me/push-devices').send({ token: MINJI_TOKEN, platform: 'IOS', appVersion: '1.1.0' }).expect(401);
    });

    it('같은 토큰을 다른 사람이 등록하면 행을 옮긴다 (한 기기는 한 사용자, D-83)', async () => {
      const res = await registerDevice(jihun, MINJI_TOKEN, 'IOS');
      expect(res.body.data).toEqual({ ok: true });
      expect(await prisma.pushDevice.findUniqueOrThrow({ where: { token: MINJI_TOKEN } })).toMatchObject({ userId: jihun.userId });
      expect(await prisma.pushDevice.count()).toBe(2);
    });

    it('사용자당 10대. 넘으면 lastSeenAt 이 가장 오래된 기기를 지운다', async () => {
      await prisma.pushDevice.update({ where: { token: MINJI_TOKEN }, data: { lastSeenAt: new Date(Date.now() - DAY_MS) } });
      for (let i = 0; i < 10; i += 1) await registerDevice(minji, `ExponentPushToken[m${i}]`, 'IOS');
      expect(await prisma.pushDevice.count({ where: { userId: minji.userId } })).toBe(10);
      expect(await prisma.pushDevice.findUnique({ where: { token: MINJI_TOKEN } })).toBeNull();
    });

    it('DELETE 는 내 행만, 없어도 200 (멱등)', async () => {
      await api(app).delete('/v1/me/push-devices').set(auth(minji)).send({ token: JIHUN_TOKEN }).expect(200);
      expect(await prisma.pushDevice.findUnique({ where: { token: JIHUN_TOKEN } })).not.toBeNull();
      await api(app).delete('/v1/me/push-devices').set(auth(jihun)).send({ token: JIHUN_TOKEN }).expect(200);
      await api(app).delete('/v1/me/push-devices').set(auth(jihun)).send({ token: JIHUN_TOKEN }).expect(200);
      expect(await prisma.pushDevice.findUnique({ where: { token: JIHUN_TOKEN } })).toBeNull();
    });

    it('알림 설정: 기본 모두 켬, 불리언만, 빈 본문은 그대로', async () => {
      const get = await api(app).get('/v1/me/notification-settings').set(auth(minji)).expect(200);
      expect(get.body.data).toEqual({ reminder: true, change: true, anniversary: true, join: true });
      const bad = await api(app).patch('/v1/me/notification-settings').set(auth(minji)).send({ change: 'no' }).expect(400);
      expect(bad.body.error.details[0].field).toBe('change');
      const patched = await api(app).patch('/v1/me/notification-settings').set(auth(minji)).send({ change: false }).expect(200);
      expect(patched.body.data).toEqual({ reminder: true, change: false, anniversary: true, join: true });
      expect((await api(app).patch('/v1/me/notification-settings').set(auth(minji)).send({}).expect(200)).body.data.change).toBe(false);
    });

    it('팀 알림: PATCH /groups/:id/me { notify }, GroupDetail.me.notify (다른 멤버 값은 없음)', async () => {
      expect((await api(app).get(`/v1/groups/${groupId}`).set(auth(jihun)).expect(200)).body.data.me.notify).toBe(true);
      const patched = await api(app).patch(`/v1/groups/${groupId}/me`).set(auth(jihun)).send({ notify: false }).expect(200);
      expect(patched.body.data).toMatchObject({ userId: jihun.userId, notify: false });
      const detail = (await api(app).get(`/v1/groups/${groupId}`).set(auth(jihun)).expect(200)).body.data;
      expect(detail.me.notify).toBe(false);
      expect(detail.members.every((member: object) => !('notify' in member))).toBe(true);
      await api(app).patch(`/v1/groups/${groupId}/me`).set(auth(jihun)).send({ notify: 'off' }).expect(400);
    });
  });

  describe('일정 알림 입력 (4장, 7-2)', () => {
    it('생략은 NONE, 종일 여부와 안 맞으면 400, 응답과 목록에 reminder', async () => {
      expect((await createEvent(minji, timed('a', '10:00:00', '11:00:00'))).reminder).toBe('NONE');
      const bad = await api(app).post(`/v1/groups/${groupId}/events`).set(auth(minji)).send(timed('b', '10:00:00', '11:00:00', { reminder: 'DAY_OF_0900' })).expect(400);
      expect(bad.body.error.details[0]).toEqual({ field: 'reminder', message: '시간 일정에는 고를 수 없는 알림이에요' });
      await api(app).post(`/v1/groups/${groupId}/events`).set(auth(minji)).send(timed('c', '10:00:00', '11:00:00', { reminder: 'SOON' })).expect(400);
      const event = await createEvent(minji, timed('d', '12:00:00', '13:00:00', { reminder: 'MIN_10' }));
      expect((await prisma.event.findUniqueOrThrow({ where: { id: event.id } })).remindAt).toEqual(at('11:50:00'));
      const list = await api(app).get(`/v1/groups/${groupId}/events`).query({ from: at('00:00:00').toISOString(), to: at('23:59:00').toISOString() }).set(auth(minji)).expect(200);
      expect(list.body.data.map((e: { reminder: string }) => e.reminder)).toEqual(['NONE', 'MIN_10']);
    });
  });

  describe('(#248) 일정 알림은 참여자에게만 (D-138, 기획 성공 기준 3)', () => {
    const reminderTo = async (participants: unknown) => {
      const body = timed('저녁', '18:00:00', '19:00:00', { reminder: 'HOUR_1' });
      const event = await createEvent(minji, participants === undefined ? { ...body, participants: undefined } : { ...body, participants });
      await scheduler.tick(at('17:00:10'));
      return { event, to: fake.messages.filter((m) => m.data.kind === 'REMINDER').map((m) => m.to).sort() };
    };

    it('생략(= 등록자만) 이면 등록자에게만', async () => {
      expect((await reminderTo(undefined)).to).toEqual([MINJI_TOKEN]);
    });

    it('참여자가 아닌 팀원(등록자 포함)에게는 가지 않는다', async () => {
      expect((await reminderTo([jihun.userId])).to).toEqual([JIHUN_TOKEN]);
    });

    it('모두면 팀원 전원', async () => {
      expect((await reminderTo('ALL')).to).toEqual([JIHUN_TOKEN, MINJI_TOKEN].sort());
    });

    it('참여자 없음이면 0건으로 DISPATCHED (새 상태 없음)', async () => {
      const body = timed('저녁', '18:00:00', '19:00:00', { reminder: 'HOUR_1', participants: [jihun.userId] });
      const event = await createEvent(minji, body);
      await api(app).delete(`/v1/groups/${groupId}/me`).set(auth(jihun)).expect(200);
      await scheduler.tick(at('17:00:10'));
      expect(fake.messages.filter((m) => m.data.kind === 'REMINDER')).toHaveLength(0);
      expect(await prisma.pushNotification.findFirstOrThrow({ where: { kind: 'REMINDER', eventId: event.id } })).toMatchObject({ status: 'DISPATCHED' });
    });

    it('펼치는 순간의 참여자: 예약 뒤에 참여자를 바꾸면 바뀐 사람에게', async () => {
      const event = await createEvent(minji, timed('저녁', '18:00:00', '19:00:00', { reminder: 'HOUR_1', participants: [minji.userId] }));
      await prisma.eventParticipant.deleteMany({ where: { eventId: event.id } });
      await prisma.eventParticipant.create({ data: { eventId: event.id, userId: jihun.userId } });
      await scheduler.tick(at('17:00:10'));
      expect(fake.messages.filter((m) => m.data.kind === 'REMINDER').map((m) => m.to)).toEqual([JIHUN_TOKEN]);
    });

    it('팀원 변경 알림(CHANGE) 은 참여자와 무관하게 팀 전체, 참여자만 바꿔도 "수정"', async () => {
      const event = await createEvent(minji, timed('점심', '12:00:00', '13:00:00', { participants: [minji.userId] }));
      await scheduler.tick(afterCoalesce());
      expect(fake.messages).toEqual([expect.objectContaining({ to: JIHUN_TOKEN, title: '[우리] 민지님이 일정을 추가했어요' })]);
      fake.reset();
      await api(app).patch(`/v1/groups/${groupId}/events/${event.id}`).set(auth(minji)).send({ participants: [jihun.userId] }).expect(200);
      await scheduler.tick(afterCoalesce());
      expect(fake.messages).toEqual([expect.objectContaining({ to: JIHUN_TOKEN, title: '[우리] 민지님이 일정을 수정했어요' })]);
    });
  });

  describe('발송 (5장, 6장)', () => {
    it('1. 18:00 일정 1시간 전 → 17:00:10 틱에 팀원 모두 2건 (IOS 부제, ANDROID 앞머리). 다시 틱해도 추가 없음', async () => {
      const event = await createEvent(minji, timed('저녁 약속', '18:00:00', '20:00:00', { reminder: 'HOUR_1', memo: '비밀 메모' }));
      const result = await scheduler.tick(at('17:00:10'));
      expect(result).toMatchObject({ ran: true, planned: 1 });
      expect(fake.messages).toHaveLength(2);
      const url = `/g/${groupId}/calendar?date=${day}&day=1&event=${event.id}`;
      expect(fake.messages.find((m) => m.to === MINJI_TOKEN)).toMatchObject({ title: '저녁 약속', subtitle: '우리', body: '1시간 뒤 오후 6:00', data: { kind: 'REMINDER', url } });
      const android = fake.messages.find((m) => m.to === JIHUN_TOKEN)!;
      expect(android).toMatchObject({ title: '[우리] 저녁 약속', body: '1시간 뒤 오후 6:00', data: { url } });
      expect(android).not.toHaveProperty('subtitle');
      expect(JSON.stringify(fake.messages)).not.toContain('비밀 메모');
      expect(await prisma.pushDelivery.count({ where: { status: 'SENT', ticketId: { not: null } } })).toBe(2);

      await scheduler.tick(at('17:00:40'));
      expect(fake.messages).toHaveLength(2);
    });

    it('반복 일정: 원본은 알림 없음, "이 일정만" 회차에 10분 전 → 그 회차만', async () => {
      const series = await createEvent(minji, timed('운동', '07:00:00', '08:00:00', { repeat: 'WEEKLY' }));
      const next = kstDate(new Date(at('12:00:00').getTime() + 7 * DAY_MS));
      const patched = await api(app)
        .patch(`/v1/groups/${groupId}/events/${series.id}`)
        .query({ scope: 'this', occurrence: next })
        .set(auth(minji))
        .send({ reminder: 'MIN_10' })
        .expect(200);
      expect(patched.body.data).toMatchObject({ occurrence: next, reminder: 'MIN_10' });
      await scheduler.tick(at('06:50:05'));
      expect(fake.messages).toHaveLength(0);
      await scheduler.tick(at('06:50:05', next));
      expect(fake.messages.map((m) => m.data.url)).toEqual([
        `/g/${groupId}/calendar?date=${next}&day=1&event=${series.id}&occurrence=${next}`,
        `/g/${groupId}/calendar?date=${next}&day=1&event=${series.id}&occurrence=${next}`,
      ]);
    });

    it('2. 2분 안 수정 3번 → 변경한 사람 빼고 1건(마지막 제목). 추가 후 1분 안 삭제 → 0건', async () => {
      const event = await createEvent(minji, timed('점심', '12:00:00', '13:00:00'));
      await scheduler.tick(afterCoalesce());
      expect(fake.messages).toHaveLength(1);
      expect(fake.messages[0]).toMatchObject({ to: JIHUN_TOKEN, title: '[우리] 민지님이 일정을 추가했어요', body: expect.stringMatching(/^점심, /) });
      fake.reset();

      for (const title of ['점심 1', '점심 2', '점심 3']) {
        await api(app).patch(`/v1/groups/${groupId}/events/${event.id}`).set(auth(minji)).send({ title }).expect(200);
      }
      await scheduler.tick(afterCoalesce());
      expect(fake.messages).toHaveLength(1);
      expect(fake.messages[0]).toMatchObject({ to: JIHUN_TOKEN, title: '[우리] 민지님이 일정을 수정했어요', body: expect.stringMatching(/^점심 3, /) });
      expect(fake.messages[0].data.url).toBe(`/g/${groupId}/calendar?date=${day}&day=1&event=${event.id}`);
      fake.reset();

      const temp = await createEvent(minji, timed('잘못 만듦', '15:00:00', '16:00:00'));
      await api(app).delete(`/v1/groups/${groupId}/events/${temp.id}`).set(auth(minji)).expect(200);
      expect(await prisma.pushNotification.findFirstOrThrow({ where: { eventId: temp.id } })).toMatchObject({ status: 'CANCELLED' });
      await scheduler.tick(afterCoalesce());
      expect(fake.messages).toHaveLength(0);
    });

    it('2-1. 수정 후 삭제는 삭제 1건, 새 소식으로. 다른 사람의 변경은 따로 묶는다', async () => {
      const event = await createEvent(minji, timed('회의', '09:00:00', '10:00:00'));
      await scheduler.tick(afterCoalesce());
      fake.reset();
      await api(app).patch(`/v1/groups/${groupId}/events/${event.id}`).set(auth(minji)).send({ title: '회의 2' }).expect(200);
      await api(app).patch(`/v1/groups/${groupId}/events/${event.id}`).set(auth(jihun)).send({ title: '회의 3' }).expect(200);
      await api(app).delete(`/v1/groups/${groupId}/events/${event.id}`).set(auth(minji)).expect(200);
      await scheduler.tick(afterCoalesce());
      const toJihun = fake.messages.filter((m) => m.to === JIHUN_TOKEN);
      const toMinji = fake.messages.filter((m) => m.to === MINJI_TOKEN);
      expect(toJihun).toEqual([expect.objectContaining({ title: '[우리] 민지님이 일정을 삭제했어요', data: expect.objectContaining({ url: `/g/${groupId}/news` }) })]);
      expect(toMinji).toEqual([expect.objectContaining({ title: '지훈님이 일정을 수정했어요', body: expect.stringMatching(/^회의 3, /) })]);
    });

    it('3. 종류 설정, 팀 설정을 끄면 그 사람은 0건. 로그아웃(기기 삭제) 뒤에도 0건', async () => {
      await api(app).patch('/v1/me/notification-settings').set(auth(minji)).send({ reminder: false }).expect(200);
      await createEvent(minji, timed('알림 하나', '18:00:00', '19:00:00', { reminder: 'HOUR_1' }));
      await scheduler.tick(at('17:00:10'));
      expect(fake.messages.map((m) => m.to)).toEqual([JIHUN_TOKEN]);
      fake.reset();

      await api(app).patch('/v1/me/notification-settings').set(auth(jihun)).send({ change: false }).expect(200);
      const event = await createEvent(minji, timed('변경', '10:00:00', '11:00:00'));
      await scheduler.tick(afterCoalesce());
      expect(fake.messages).toHaveLength(0);

      await api(app).patch('/v1/me/notification-settings').set(auth(jihun)).send({ change: true }).expect(200);
      await api(app).patch(`/v1/groups/${groupId}/me`).set(auth(jihun)).send({ notify: false }).expect(200);
      await api(app).patch(`/v1/groups/${groupId}/events/${event.id}`).set(auth(minji)).send({ title: '변경 2' }).expect(200);
      await scheduler.tick(afterCoalesce());
      expect(fake.messages).toHaveLength(0);

      await api(app).patch(`/v1/groups/${groupId}/me`).set(auth(jihun)).send({ notify: true }).expect(200);
      await api(app).delete('/v1/me/push-devices').set(auth(jihun)).send({ token: JIHUN_TOKEN }).expect(200);
      await api(app).patch(`/v1/groups/${groupId}/events/${event.id}`).set(auth(minji)).send({ title: '변경 3' }).expect(200);
      await scheduler.tick(afterCoalesce());
      expect(fake.messages).toHaveLength(0);
    });

    it('4. 티켓 DeviceNotRegistered → 기기 삭제. 15분 뒤 영수증 DeviceNotRegistered → 기기 삭제', async () => {
      fake.ticketFor = (token, index) =>
        token === JIHUN_TOKEN ? { status: 'error', message: 'gone', details: { error: 'DeviceNotRegistered' } } : { status: 'ok', id: `tk-${index}` };
      await createEvent(minji, timed('저녁', '18:00:00', '19:00:00', { reminder: 'HOUR_1' }));
      await scheduler.tick(at('17:00:10'));
      expect(fake.messages).toHaveLength(2);
      expect(await prisma.pushDevice.findUnique({ where: { token: JIHUN_TOKEN } })).toBeNull();
      expect(await prisma.pushDelivery.findFirstOrThrow({ where: { token: JIHUN_TOKEN } })).toMatchObject({ status: 'FAILED', error: 'DeviceNotRegistered' });
      const sent = await prisma.pushDelivery.findFirstOrThrow({ where: { token: MINJI_TOKEN } });
      expect(sent).toMatchObject({ status: 'SENT', receipt: null });

      fake.receipts.set(sent.ticketId!, { status: 'error', details: { error: 'DeviceNotRegistered' } });
      await scheduler.tick(at('17:10:10'));
      expect(fake.receiptRequests).toHaveLength(0);
      await scheduler.tick(at('17:16:00'));
      expect(fake.receiptRequests).toEqual([[sent.ticketId]]);
      expect(await prisma.pushDelivery.findUniqueOrThrow({ where: { id: sent.id } })).toMatchObject({ receipt: 'DeviceNotRegistered', receiptCheckedAt: at('17:16:00') });
      expect(await prisma.pushDevice.findUnique({ where: { token: MINJI_TOKEN } })).toBeNull();
    });

    it('5. 합류 → 기존 멤버 1건씩, 합류자 0건. 탈퇴 → 기기, 발송 기록 삭제', async () => {
      const carol = await devLogin(app, '캐롤');
      await registerDevice(carol, 'ExponentPushToken[carol]', 'IOS');
      await api(app).post('/v1/groups/join').set(auth(carol)).send({ code: inviteCode }).expect(200);
      await api(app).post('/v1/groups/join').set(auth(carol)).send({ code: inviteCode }).expect(200);
      expect(await prisma.pushNotification.count({ where: { kind: 'JOIN', status: 'PENDING' } })).toBe(1);
      await scheduler.tick(new Date(Date.now() + 1_000));
      expect(fake.messages.map((m) => m.to).sort()).toEqual([JIHUN_TOKEN, MINJI_TOKEN].sort());
      expect(fake.messages.find((m) => m.to === MINJI_TOKEN)).toMatchObject({ title: "캐롤님이 '우리' 에 들어왔어요", data: { url: `/g/${groupId}/calendar`, kind: 'JOIN' } });
      expect(fake.messages.find((m) => m.to === MINJI_TOKEN)).not.toHaveProperty('subtitle');
      expect(fake.messages.find((m) => m.to === JIHUN_TOKEN)?.title).toBe("캐롤님이 '우리' 에 들어왔어요");

      expect(await prisma.pushDelivery.count({ where: { userId: jihun.userId } })).toBe(1);
      await api(app).delete('/v1/me').set(auth(jihun)).expect(200);
      expect(await prisma.pushDevice.count({ where: { userId: jihun.userId } })).toBe(0);
      expect(await prisma.pushDelivery.count({ where: { userId: jihun.userId } })).toBe(0);
    });

    it('6. 프로세스 둘(holder 둘) 이 같은 틱 → 임대 하나만, 발송 1벌. 임대가 넘어가도 중복 없음', async () => {
      await createEvent(minji, timed('저녁', '18:00:00', '19:00:00', { reminder: 'HOUR_1' }));
      const other = new PushScheduler(app.get(ConfigService), app.get(PushRepository), app.get(ReminderPlanner), app.get(AnniversaryPlanner), app.get(PushDispatcher));
      const now = at('17:00:10');
      const results = await Promise.all([scheduler.tick(now), other.tick(now)]);
      expect(results.filter((result) => result.ran)).toHaveLength(1);
      expect(fake.messages).toHaveLength(2);

      // 임대가 만료돼 다른 프로세스가 받아도 같은 알림은 다시 생기지 않는다 (유일 키)
      await other.tick(new Date(now.getTime() + 61_000));
      await scheduler.tick(new Date(now.getTime() + 125_000));
      expect(fake.messages).toHaveLength(2);
      expect(await prisma.pushNotification.count({ where: { kind: 'REMINDER' } })).toBe(1);
    });

    it('따라잡기: 서버가 30분 멈췄다 돌아오면 10분 안의 알림만, 늦은 PENDING 은 SKIPPED', async () => {
      await createEvent(minji, timed('지난 것', '18:00:00', '19:00:00', { reminder: 'HOUR_1' }));
      await createEvent(minji, timed('10분 안', '18:25:00', '19:00:00', { reminder: 'HOUR_1' }));
      await scheduler.tick(at('16:59:00'));
      await scheduler.tick(at('17:29:00'));
      expect(fake.messages.map((m) => m.title).filter((title) => title.includes('10분 안'))).toHaveLength(2);
      expect(fake.messages.some((m) => m.title.includes('지난 것'))).toBe(false);

      // PUSH_ENABLED 를 늦게 켠 경우처럼 쌓인 옛 예약
      await prisma.pushNotification.create({ data: { kind: 'JOIN', dedupeKey: 'J:old', groupId, scheduledAt: at('17:17:00'), actorId: jihun.userId } });
      await scheduler.tick(at('17:28:30'));
      expect(await prisma.pushNotification.findUniqueOrThrow({ where: { dedupeKey: 'J:old' } })).toMatchObject({ status: 'SKIPPED' });
    });

    it('기념일 당일 09:00 KST, 기념일 하나에 1건', async () => {
      const date = kstDate(new Date(at('12:00:00').getTime() - 99 * DAY_MS));
      await api(app).post(`/v1/groups/${groupId}/anniversaries`).set(auth(minji)).send({ name: '처음 만난 날', date, kind: 'COUNT_UP' }).expect(201);
      await prisma.anniversary.updateMany({ data: { updatedAt: new Date(Date.now() - DAY_MS) } });
      await scheduler.tick(at('09:00:20'));
      expect(fake.messages.map((m) => m.body)).toEqual(['오늘은 처음 만난 날 100일이에요', '오늘은 처음 만난 날 100일이에요']);
      expect(fake.messages[0].data).toMatchObject({ kind: 'ANNIVERSARY', url: `/g/${groupId}/anniversaries` });
    });
  });
});
