import { ConfigService } from '@nestjs/config';
import { addDays, kstDate } from '../src/events/recurrence.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { AnniversaryPlanner } from '../src/push/anniversary-planner.js';
import { PushDispatcher } from '../src/push/push-dispatcher.js';
import { PushRepository } from '../src/push/push.repository.js';
import { PushScheduler } from '../src/push/push.scheduler.js';
import { ReminderPlanner } from '../src/push/reminder-planner.js';
import { WeeklyPlanner } from '../src/push/weekly-planner.js';
import { PollPlanner } from '../src/push/poll-planner.js';
import { EventDeletionsRepository } from '../src/event-deletions/event-deletions.repository.js';
import { FakeExpo } from './fake-expo.js';
import { api, auth, createTestApp, devLogin, resetDb, type Session, type TestApp } from './helpers.js';

/**
 * (#277) 주간 요약과 조용한 팀 깨우기 e2e (설계 5-9, D-203 ~ D-205). 실제 MySQL + 가짜 Expo.
 * 시계는 `PushScheduler.tick(now)` 로 월요일 경계를 넘긴다. 일정 저장 시각(createdAt) 은 실제 지금이라
 * 깨우기 조건(생성 14일, 90일)은 DB 행을 직접 옮겨 맞춘다
 */
describe('주간 알림 (e2e, #277)', () => {
  const fake = new FakeExpo();
  let app: TestApp;
  let prisma: PrismaService;
  let scheduler: PushScheduler;
  let minji: Session;
  let jihun: Session;
  let groupId: number;
  let groupCode: string;
  let inviteCode: string;

  const MINJI_TOKEN = 'ExponentPushToken[minji-ios]';
  const JIHUN_TOKEN = 'ExponentPushToken[jihun-android]';
  const DAY_MS = 86_400_000;
  /** 실제 오늘에서 3주 넘게 뒤의 월요일 (KST) */
  const MONDAY = (() => {
    let day = addDays(kstDate(new Date()), 21);
    while (new Date(`${day}T00:00:00.000Z`).getUTCDay() !== 1) day = addDays(day, 1);
    return day;
  })();
  const at = (date: string, time: string) => new Date(`${date}T${time}+09:00`);
  const mon = (time: string, weeks = 0) => at(addDays(MONDAY, weeks * 7), time);

  const registerDevice = (session: Session, token: string, platform: 'IOS' | 'ANDROID') =>
    api(app).put('/v1/me/push-devices').set(auth(session)).send({ token, platform, appVersion: '1.1.0' }).expect(200);

  const createEvent = async (session: Session, body: Record<string, unknown>) =>
    (await api(app).post(`/v1/groups/${groupId}/events`).set(auth(session)).send({ participants: 'ALL', allDay: false, ...body }).expect(201)).body
      .data as { id: number };

  const weeklyRows = () => prisma.pushNotification.findMany({ where: { kind: 'WEEKLY' }, orderBy: { id: 'asc' } });
  const teamRow = async (weeks = 0) => prisma.pushNotification.findUnique({ where: { dedupeKey: `W:${groupId}:${addDays(MONDAY, weeks * 7)}` } });

  /**
   * 몇 주 뒤로 시계를 넘기면 하루 청소(만든 지 30일, D-99)가 실제 지금 만든 행을 지운다.
   * 운영에서는 createdAt 이 그 틱 시각이라 일어나지 않는 일이므로 그날 청소는 이미 한 것으로 둔다
   */
  const skipCleanup = (weeks: number) =>
    prisma.schedulerLease.update({ where: { name: 'push' }, data: { dailyDoneOn: new Date(`${addDays(MONDAY, weeks * 7)}T00:00:00.000Z`) } });

  /** 깨우기 후보: 만든 지 오래된 조용한 팀 (일정 없음) */
  const makeQuiet = async (createdDaysAgo = 30) => {
    await prisma.group.update({ where: { id: groupId }, data: { createdAt: new Date(mon('09:00:00').getTime() - createdDaysAgo * DAY_MS) } });
  };

  beforeAll(async () => {
    await fake.start();
    process.env.EXPO_PUSH_URL = fake.url;
    app = await createTestApp({ weeklyPush: true });
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
    groupCode = created.body.data.publicCode as string;
    inviteCode = created.body.data.inviteCode as string;
    await api(app).post('/v1/groups/join').set(auth(jihun)).send({ code: inviteCode }).expect(200);
    await registerDevice(minji, MINJI_TOKEN, 'IOS');
    await registerDevice(jihun, JIHUN_TOKEN, 'ANDROID');
    await prisma.pushNotification.updateMany({ where: { status: 'PENDING' }, data: { status: 'SKIPPED' } });
  });

  it('월요일 경계: 일요일 밤, 월요일 08:59 에는 없고 09:00 에 팀마다 1건, 회차 수는 반복 펼침, 취소 회차, 여러 날, 참여자 무관', async () => {
    const lastSat = addDays(MONDAY, -2);
    const wed = addDays(MONDAY, 2);
    // 지난주 토요일부터 화요일까지 여행 (종일, 1개)
    await createEvent(minji, { title: '여행', startsAt: at(lastSat, '00:00:00').toISOString(), endsAt: at(addDays(MONDAY, 2), '00:00:00').toISOString(), allDay: true });
    // 수요일 저녁 (민지만 참여해도 팀 전체로 센다)
    await createEvent(minji, { title: '저녁 약속', startsAt: at(wed, '19:00:00').toISOString(), endsAt: at(wed, '21:00:00').toISOString(), participants: [minji.userId] });
    // 매주 목요일 운동 (이번 주 회차 1개), 매주 화요일 스터디 (이번 주 회차 취소)
    const thu = addDays(MONDAY, 3);
    await createEvent(jihun, { title: '운동', startsAt: at(addDays(thu, -14), '07:00:00').toISOString(), endsAt: at(addDays(thu, -14), '08:00:00').toISOString(), repeat: 'WEEKLY' });
    const tue = addDays(MONDAY, 1);
    const study = await createEvent(jihun, { title: '스터디', startsAt: at(addDays(tue, -7), '20:00:00').toISOString(), endsAt: at(addDays(tue, -7), '21:00:00').toISOString(), repeat: 'WEEKLY' });
    await api(app).delete(`/v1/groups/${groupId}/events/${study.id}`).query({ scope: 'this', occurrence: tue }).set(auth(jihun)).expect(200);
    // 다음 주 일정은 세지 않는다
    await createEvent(minji, { title: '다음 주', startsAt: mon('10:00:00', 1).toISOString(), endsAt: mon('11:00:00', 1).toISOString() });
    await api(app).post(`/v1/groups/${groupId}/anniversaries`).set(auth(minji)).send({ name: '하늘 생일', date: `2000-${addDays(MONDAY, 4).slice(5)}`, kind: 'YEARLY' }).expect(201);
    await prisma.pushNotification.updateMany({ where: { status: 'PENDING' }, data: { status: 'SKIPPED' } });

    await scheduler.tick(at(addDays(MONDAY, -1), '23:59:50'));
    await scheduler.tick(mon('08:59:50'));
    expect(await weeklyRows()).toHaveLength(0);

    const planned = await scheduler.tick(mon('09:00:00'));
    // 팀 '우리' + 두 사람의 개인 팀 = 3건 예약 (기기 있고 주간 요약 켬)
    expect(planned.weekly).toBe(3);
    const row = await teamRow();
    expect(row).toMatchObject({ status: 'PENDING', scheduledAt: new Date(mon('09:00:00').getTime() + (groupId % 600) * 1000) });

    // 10분 안에 모두 펼친다
    await scheduler.tick(mon('09:10:30'));
    const sent = await teamRow();
    expect(sent?.status).toBe('DISPATCHED');
    const dow = ['일', '월', '화', '수', '목', '금', '토'][new Date(`${addDays(MONDAY, 4)}T00:00:00Z`).getUTCDay()];
    expect(sent?.payload).toMatchObject({
      title: '이번 주 일정 3개',
      subtitle: '우리',
      body: `월 여행, 수 저녁 약속 외 1개. ${dow}요일은 하늘 생일이에요`,
      url: `/upcoming?team=${groupCode}`,
      variant: 'SUMMARY',
      expiration: Math.floor(at(addDays(MONDAY, 1), '00:00:00').getTime() / 1000),
    });
    const deliveries = await prisma.pushDelivery.findMany({ where: { notificationId: sent!.id }, orderBy: { userId: 'asc' } });
    expect(deliveries.map((d) => [d.userId, d.status])).toEqual([
      [minji.userId, 'SENT'],
      [jihun.userId, 'SENT'],
    ]);
    expect(fake.messages.find((m) => m.to === JIHUN_TOKEN)).toMatchObject({ title: '[우리] 이번 주 일정 3개', data: { kind: 'WEEKLY' } });
    // 개인 팀은 일정이 없고 깨우기 대상이 아니라 CANCELLED (보내지 않음)
    const personal = (await weeklyRows()).filter((r) => r.groupId !== groupId);
    expect(personal.map((r) => r.status)).toEqual(['CANCELLED', 'CANCELLED']);
    expect(fake.messages).toHaveLength(2);
  });

  it('재시작: 다른 프로세스가 09:30, 11:00 에 돌아도, 표시 행이 지워져도 같은 주는 한 번만', async () => {
    await createEvent(minji, { title: '저녁', startsAt: mon('19:00:00').toISOString(), endsAt: mon('20:00:00').toISOString() });
    await prisma.pushNotification.updateMany({ where: { status: 'PENDING' }, data: { status: 'SKIPPED' } });
    await scheduler.tick(mon('09:00:05'));
    await scheduler.tick(mon('09:10:30'));
    expect(fake.messages).toHaveLength(2);

    const restarted = new PushScheduler(
      app.get(ConfigService),
      app.get(PushRepository),
      app.get(ReminderPlanner),
      app.get(AnniversaryPlanner),
      app.get(WeeklyPlanner),
      app.get(PushDispatcher),
      app.get(PollPlanner),
      app.get(EventDeletionsRepository),
    );
    // 임대가 만료된 뒤 다른 holder
    expect((await restarted.tick(mon('09:30:00'))).weekly).toBe(0);
    await prisma.schedulerLease.deleteMany({ where: { name: 'weekly' } });
    expect((await restarted.tick(mon('11:00:00'))).weekly).toBe(0);
    expect(await prisma.pushNotification.count({ where: { kind: 'WEEKLY', groupId } })).toBe(1);
    expect(fake.messages).toHaveLength(2);
  });

  it('늦음 허용 3시간: 서버가 11:50 에 돌아오면 그 주 요약을 보내고, 12:10 에 돌아오면 그 주는 건너뛴다', async () => {
    await createEvent(minji, { title: '저녁', startsAt: mon('19:00:00').toISOString(), endsAt: mon('20:00:00').toISOString() });
    await prisma.pushNotification.updateMany({ where: { status: 'PENDING' }, data: { status: 'SKIPPED' } });
    await scheduler.tick(mon('11:50:00'));
    expect((await teamRow())?.status).toBe('DISPATCHED');
    expect(fake.messages).toHaveLength(2);

    fake.reset();
    await createEvent(minji, { title: '다음 저녁', startsAt: mon('19:00:00', 1).toISOString(), endsAt: mon('20:00:00', 1).toISOString() });
    await prisma.pushNotification.updateMany({ where: { status: 'PENDING' }, data: { status: 'SKIPPED' } });
    await skipCleanup(1);
    await scheduler.tick(mon('12:10:00', 1));
    expect(await teamRow(1)).toBeNull();
    expect(fake.messages).toHaveLength(0);
  });

  it('받는 사람: 주간 요약 끔, 팀 알림 끔은 빠지고, 예약 뒤 들어온 사람은 받는다 (joinedAt 조건 없음, D-180 앞날 알림)', async () => {
    await createEvent(minji, { title: '저녁', startsAt: mon('19:00:00').toISOString(), endsAt: mon('20:00:00').toISOString() });
    await prisma.pushNotification.updateMany({ where: { status: 'PENDING' }, data: { status: 'SKIPPED' } });
    await api(app).patch('/v1/me/notification-settings').set(auth(jihun)).send({ weekly: false }).expect(200);
    const caro = await devLogin(app, '캐롤');
    await registerDevice(caro, 'ExponentPushToken[caro-ios]', 'IOS');

    // 예약 (팀 행은 아직 예약 시각 전이 되도록 정각에)
    await scheduler.tick(mon('09:00:00'));
    const planned = await teamRow();
    expect(planned?.status).toBe('PENDING');
    // 예약 뒤 합류 (joinedAt > 예약 createdAt). 민지는 팀 알림을 끈다
    await api(app).post('/v1/groups/join').set(auth(caro)).send({ code: inviteCode }).expect(200);
    await prisma.pushNotification.updateMany({ where: { kind: 'JOIN' }, data: { status: 'SKIPPED' } });
    await api(app).patch(`/v1/groups/${groupId}/me`).set(auth(minji)).send({ notify: false }).expect(200);

    await scheduler.tick(mon('09:10:30'));
    const deliveries = await prisma.pushDelivery.findMany({ where: { notificationId: planned!.id } });
    expect(deliveries.map((d) => d.userId)).toEqual([caro.userId]);
  });

  it('깨우기는 기본 끔: 조건을 만족해도 켠 사람이 없으면 CANCELLED, 켠 사람에게만 NUDGE', async () => {
    await makeQuiet();
    await scheduler.tick(mon('09:00:00'));
    await scheduler.tick(mon('09:10:30'));
    expect((await teamRow())?.status).toBe('CANCELLED');
    expect(fake.messages).toHaveLength(0);

    // 지훈만 켠다 (요약 토글과 별개)
    await api(app).patch('/v1/me/notification-settings').set(auth(jihun)).send({ weeklyNudge: true }).expect(200);
    await skipCleanup(4);
    await scheduler.tick(mon('09:00:00', 4));
    await scheduler.tick(mon('09:10:30', 4));
    const nudge = await teamRow(4);
    expect(nudge?.status).toBe('DISPATCHED');
    expect(nudge?.payload).toMatchObject({
      title: '2주 동안 같이 잡은 일정이 없어요',
      url: `/free?team=${groupCode}`,
      variant: 'NUDGE',
    });
    expect((nudge!.payload as { body: string }).body).toBe('이번 주 다 같이 비는 시간: 월 오전 9:30~오후 11:00 외 6개');
    expect(fake.messages.map((m) => m.to)).toEqual([JIHUN_TOKEN]);
  });

  it('깨우기 4주 간격: 보낸 다음 3주는 CANCELLED, 4주 뒤 다시. 마지막 일정 생성 90일이 지나면 멈춘다', async () => {
    await makeQuiet();
    await api(app).patch('/v1/me/notification-settings').set(auth(minji)).send({ weeklyNudge: true }).expect(200);
    const run = async (weeks: number) => {
      await skipCleanup(weeks);
      await scheduler.tick(mon('09:00:00', weeks));
      await scheduler.tick(mon('09:10:30', weeks));
      return (await teamRow(weeks))?.status;
    };
    expect(await run(0)).toBe('DISPATCHED');
    expect(await run(1)).toBe('CANCELLED');
    expect(await run(2)).toBe('CANCELLED');
    expect(await run(3)).toBe('CANCELLED');
    expect(await run(4)).toBe('DISPATCHED');
    expect(fake.messages.map((m) => m.to)).toEqual([MINJI_TOKEN, MINJI_TOKEN]);

    // 일정 없는 팀이 만든 지 90일을 넘으면 (마지막 일정 생성 = 팀 생성) 더 깨우지 않는다
    await makeQuiet(8 * 7 + 91);
    expect(await run(8)).toBe('CANCELLED');
  });

  it('깨우기 조건: 지난 14일 일정 추가 기록, 지난 14일 회차, 멤버 1명이면 보내지 않는다', async () => {
    await makeQuiet();
    await api(app).patch('/v1/me/notification-settings').set(auth(minji)).send({ weeklyNudge: true }).expect(200);
    // 3주 뒤 일정을 지금 추가 → 추가 기록은 월요일 기준 14일 안이 아니다(실제 지금은 3주 넘게 전). 회차는 지난 14일 안
    const lastWeek = addDays(MONDAY, -3);
    await createEvent(minji, { title: '지난 약속', startsAt: at(lastWeek, '19:00:00').toISOString(), endsAt: at(lastWeek, '20:00:00').toISOString() });
    await prisma.pushNotification.updateMany({ where: { status: 'PENDING' }, data: { status: 'SKIPPED' } });
    await scheduler.tick(mon('09:00:00'));
    await scheduler.tick(mon('09:10:30'));
    expect((await teamRow())?.status).toBe('CANCELLED');

    // 지훈이 나가면 멤버 1명 → 2주 뒤에도 보내지 않는다 (지난 약속은 14일 밖)
    await api(app).delete(`/v1/groups/${groupId}/me`).set(auth(jihun)).expect(200);
    await skipCleanup(3);
    await scheduler.tick(mon('09:00:00', 3));
    await scheduler.tick(mon('09:10:30', 3));
    expect((await teamRow(3))?.status).toBe('CANCELLED');
    expect(fake.messages).toHaveLength(0);
  });
});
