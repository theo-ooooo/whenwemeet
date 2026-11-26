import request from 'supertest';
import { kstDate } from '../src/events/recurrence.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { PushPlanningRepository } from '../src/push/push-planning.repository.js';
import { PushScheduler } from '../src/push/push.scheduler.js';
import { FakeExpo } from './fake-expo.js';
import { api, auth, createTestApp, devLogin, resetDb, type Session, type TestApp } from './helpers.js';

/**
 * 멤버 생일 (#305, D-230 ~ D-233): 내 정보에서 월일 저장, 팀 달력 목록, 팀별 끄기, 나가기와 탈퇴, 푸시, 구독 피드
 */
describe('멤버 생일 (e2e)', () => {
  const fake = new FakeExpo();
  let app: TestApp;
  let prisma: PrismaService;
  let scheduler: PushScheduler;
  let alice: Session;
  let bob: Session;
  let carol: Session;
  let teamId: number;
  let aliceHomeId: number;

  const DAY_MS = 86_400_000;
  const ALICE_TOKEN = 'ExponentPushToken[alice-ios]';
  const BOB_TOKEN = 'ExponentPushToken[bob-ios]';

  const setBirthday = (session: Session, body: Record<string, unknown>) => api(app).patch('/v1/me/birthday').set(auth(session)).send(body);
  const birthdaysOf = async (session: Session, groupId: number) =>
    (await api(app).get(`/v1/groups/${groupId}/birthdays`).set(auth(session)).expect(200)).body.data as { member: { userId: number; displayName: string }; date: string }[];
  const personalOf = async (session: Session) =>
    ((await api(app).get('/v1/groups').set(auth(session)).expect(200)).body.data as { id: number; type: string }[]).find((g) => g.type === 'PERSONAL')!.id;
  /** 실제 시각 기준 n 일 뒤 KST 날짜 */
  const kstIn = (days: number) => kstDate(new Date(Date.now() + days * DAY_MS));

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
    alice = await devLogin(app, '앨리스');
    bob = await devLogin(app, '밥');
    carol = await devLogin(app, '캐럴');
    const team = await api(app).post('/v1/groups').set(auth(alice)).send({ name: '우리' }).expect(201);
    teamId = team.body.data.id as number;
    await api(app).post('/v1/groups/join').set(auth(bob)).send({ code: team.body.data.inviteCode }).expect(200);
    aliceHomeId = await personalOf(alice);
  });

  describe('내 정보 PATCH /me/birthday', () => {
    it('처음엔 없음 + 당일만. 월일 저장, 2월 29일 허용, 지우면 null', async () => {
      expect((await api(app).get('/v1/me').set(auth(alice)).expect(200)).body.data.birthday).toEqual({ date: null, calendar: 'SOLAR', isLeapMonth: false, reminders: ['DAY_OF'] });
      expect((await setBirthday(alice, { date: '02-29' }).expect(200)).body.data).toEqual({ date: '02-29', calendar: 'SOLAR', isLeapMonth: false, reminders: ['DAY_OF'] });
      expect((await setBirthday(alice, { date: '02-29', reminders: ['DAY_BEFORE', 'DAY_OF'] }).expect(200)).body.data).toEqual({
        date: '02-29',
        calendar: 'SOLAR',
        isLeapMonth: false,
        reminders: ['DAY_OF', 'DAY_BEFORE'],
      });
      expect((await api(app).get('/v1/me').set(auth(alice)).expect(200)).body.data.birthday).toEqual({ date: '02-29', calendar: 'SOLAR', isLeapMonth: false, reminders: ['DAY_OF', 'DAY_BEFORE'] });
      // 지워도 알림 시점은 남아 다시 넣을 때 이어 쓴다
      expect((await setBirthday(alice, { date: null }).expect(200)).body.data).toEqual({ date: null, calendar: 'SOLAR', isLeapMonth: false, reminders: ['DAY_OF', 'DAY_BEFORE'] });
    });

    it('검증: 형식, 없는 날, 키 없음, 연도 포함, 알림 값은 400', async () => {
      for (const body of [{ date: '02-30' }, { date: '13-01' }, { date: '2-3' }, { date: '1990-02-03' }, {}, { date: 1203 }, { date: '03-05', reminders: ['NOW'] }, { date: '03-05', year: 1990 }]) {
        const res = await setBirthday(alice, body).expect(400);
        expect(res.body.error.code).toBe('VALIDATION_FAILED');
      }
      expect((await setBirthday(alice, { date: '02-30' }).expect(400)).body.error.details).toEqual([{ field: 'date', message: '생일은 MM-DD 형식의 실제 날짜여야 해요' }]);
      await api(app).patch('/v1/me/birthday').send({ date: '03-05' }).expect(401);
    });
  });

  describe('팀 달력 GET /groups/:id/birthdays', () => {
    it('생일을 넣으면 내 팀과 내 달력에 보이고, 팀원은 팀 표시 이름으로 본다', async () => {
      expect(await birthdaysOf(bob, teamId)).toEqual([]);
      await setBirthday(alice, { date: '03-05' }).expect(200);
      await api(app).patch(`/v1/groups/${teamId}/me`).set(auth(alice)).send({ displayName: '앨리' }).expect(200);
      const seen = await birthdaysOf(bob, teamId);
      expect(seen).toEqual([{ member: { userId: alice.userId, displayName: '앨리', color: expect.any(String), profileImageUrl: null }, date: '03-05', calendar: 'SOLAR', isLeapMonth: false }]);
      expect((await birthdaysOf(alice, aliceHomeId)).map((b) => [b.member.displayName, b.date])).toEqual([['앨리스', '03-05']]);
      // 다른 사람 개인 달력, 남의 팀은 403
      await api(app).get(`/v1/groups/${aliceHomeId}/birthdays`).set(auth(bob)).expect(403);
      await api(app).get(`/v1/groups/${teamId}/birthdays`).set(auth(carol)).expect(403);
    });

    it('새 팀에 들어가면 자동으로 보이고, 팀마다 끌 수 있다 (기본 켬)', async () => {
      await setBirthday(alice, { date: '03-05' }).expect(200);
      const other = await api(app).post('/v1/groups').set(auth(carol)).send({ name: '동아리' }).expect(201);
      const otherId = other.body.data.id as number;
      const joined = await api(app).post('/v1/groups/join').set(auth(alice)).send({ code: other.body.data.inviteCode }).expect(200);
      expect(joined.body.data.me.showBirthday).toBe(true);
      expect((await birthdaysOf(carol, otherId)).map((b) => b.member.userId)).toEqual([alice.userId]);

      const off = await api(app).patch(`/v1/groups/${otherId}/me`).set(auth(alice)).send({ showBirthday: false }).expect(200);
      expect(off.body.data.showBirthday).toBe(false);
      expect(await birthdaysOf(carol, otherId)).toEqual([]);
      // 다른 팀은 그대로
      expect((await birthdaysOf(bob, teamId)).map((b) => b.member.userId)).toEqual([alice.userId]);
      expect((await api(app).get(`/v1/groups/${otherId}`).set(auth(alice)).expect(200)).body.data.me.showBirthday).toBe(false);
      await api(app).patch(`/v1/groups/${otherId}/me`).set(auth(alice)).send({ showBirthday: 'no' }).expect(400);
    });

    it('팀을 나가거나 탈퇴하면 그 팀 달력에서 바로 사라진다. 생일을 지워도 사라진다', async () => {
      await setBirthday(alice, { date: '03-05' }).expect(200);
      await setBirthday(bob, { date: '12-24' }).expect(200);
      expect((await birthdaysOf(alice, teamId)).map((b) => b.date)).toEqual(['03-05', '12-24']);

      await api(app).delete(`/v1/groups/${teamId}/me`).set(auth(bob)).expect(200);
      expect((await birthdaysOf(alice, teamId)).map((b) => b.date)).toEqual(['03-05']);

      await api(app).post('/v1/groups/join').set(auth(bob)).send({ code: (await api(app).get(`/v1/groups/${teamId}`).set(auth(alice))).body.data.inviteCode }).expect(200);
      await setBirthday(alice, { date: null }).expect(200);
      expect((await birthdaysOf(bob, teamId)).map((b) => b.date)).toEqual(['12-24']);

      await setBirthday(alice, { date: '03-05' }).expect(200);
      await api(app).delete('/v1/me').set(auth(alice)).expect(200);
      expect((await birthdaysOf(bob, teamId)).map((b) => b.date)).toEqual(['12-24']);
    });
  });

  describe('푸시 (D-232)', () => {
    const at = (date: string, time: string) => new Date(`${date}T${time}+09:00`);

    beforeEach(async () => {
      await api(app).put('/v1/me/push-devices').set(auth(alice)).send({ token: ALICE_TOKEN, platform: 'IOS', appVersion: '1.1.0' }).expect(200);
      await api(app).put('/v1/me/push-devices').set(auth(bob)).send({ token: BOB_TOKEN, platform: 'IOS', appVersion: '1.1.0' }).expect(200);
      await prisma.pushNotification.updateMany({ where: { status: 'PENDING' }, data: { status: 'SKIPPED' } });
    });

    it('생일 당일 09:00 에 팀원에게만 (생일인 사람과 개인 팀은 없음)', async () => {
      const day = kstIn(2);
      await setBirthday(alice, { date: day.slice(5) }).expect(200);
      await scheduler.tick(at(day, '09:00:20'));
      expect(fake.messages.map((m) => [m.to, m.title, m.body])).toEqual([[BOB_TOKEN, '앨리스 생일', '오늘은 앨리스 생일이에요']]);
      expect(fake.messages[0].data).toMatchObject({ kind: 'ANNIVERSARY', url: expect.stringMatching(/^\/anniversaries\?team=[a-z0-9]{8}$/) });
      const rows = await prisma.pushNotification.findMany({ where: { kind: 'ANNIVERSARY' }, select: { dedupeKey: true, groupId: true, actorId: true } });
      expect(rows).toEqual([{ dedupeKey: `B:${alice.userId}:${teamId}:${day}`, groupId: teamId, actorId: alice.userId }]);
    });

    it('하루 전을 고르면 그 전날, 이 팀에서 끄면 보내지 않는다', async () => {
      const day = kstIn(3);
      await setBirthday(alice, { date: day.slice(5), reminders: ['DAY_BEFORE'] }).expect(200);
      const eve = kstIn(2);
      await scheduler.tick(at(eve, '09:00:20'));
      expect(fake.messages.map((m) => m.body)).toEqual(['내일은 앨리스 생일이에요']);

      fake.reset();
      await api(app).patch(`/v1/groups/${teamId}/me`).set(auth(alice)).send({ showBirthday: false }).expect(200);
      await setBirthday(alice, { date: day.slice(5), reminders: ['DAY_OF'] }).expect(200);
      await scheduler.tick(at(day, '09:00:20'));
      expect(fake.messages).toEqual([]);
    });

    it('(#277) 주간 요약의 그 주 기념일 재료에 이 팀에 보이는 생일이 붙는다', async () => {
      await setBirthday(alice, { date: '03-05' }).expect(200);
      await setBirthday(bob, { date: '12-24' }).expect(200);
      await api(app).patch(`/v1/groups/${teamId}/me`).set(auth(bob)).send({ showBirthday: false }).expect(200);
      expect(await app.get(PushPlanningRepository).listGroupAnniversaries(teamId)).toEqual([{ name: '앨리스 생일', date: '2000-03-05', kind: 'YEARLY', calendar: 'SOLAR', isLeapMonth: false }]);
    });

    it('예약 뒤 팀을 나가면 펼칠 때 SKIPPED', async () => {
      const day = kstIn(2);
      await setBirthday(alice, { date: day.slice(5) }).expect(200);
      // 예약만 먼저 있고(펼치기 전) 나간다. 같은 키라 틱이 다시 만들지 않는다
      const dedupeKey = `B:${alice.userId}:${teamId}:${day}`;
      const payload = { title: '앨리스 생일', subtitle: '우리', body: '오늘은 앨리스 생일이에요', url: '/', expiration: 0 };
      await prisma.pushNotification.create({ data: { kind: 'ANNIVERSARY', dedupeKey, groupId: teamId, scheduledAt: at(day, '09:00:00'), actorId: alice.userId, payload } });
      await api(app).delete(`/v1/groups/${teamId}/me`).set(auth(alice)).expect(200);
      await scheduler.tick(at(day, '09:00:20'));
      expect(fake.messages).toEqual([]);
      expect((await prisma.pushNotification.findUniqueOrThrow({ where: { dedupeKey } })).status).toBe('SKIPPED');
    });
  });

  describe('구독 피드 (D-233)', () => {
    it('"기념일 포함" 이면 멤버 생일이 매년 종일 일정으로, 끄면 빠진다', async () => {
      await setBirthday(bob, { date: '02-29' }).expect(200);
      const feedPath = `/v1/groups/${teamId}/calendar-feed`;
      const { httpsUrl } = (await api(app).put(feedPath).set(auth(alice)).send({}).expect(200)).body.data as { httpsUrl: string };
      const body = (await request(app.getHttpServer()).get(new URL(httpsUrl).pathname).expect(200)).text;
      expect(body).toContain('SUMMARY:밥 생일');
      // 평년이면 2월 28일, 윤년이면 2월 29일
      expect(body).toMatch(new RegExp(`UID:b${bob.userId}-\\d{4}02(28|29)@whenwemeet\\.day`));

      await api(app).put(feedPath).set(auth(alice)).send({ includeAnniversaries: false }).expect(200);
      expect((await request(app.getHttpServer()).get(new URL(httpsUrl).pathname).expect(200)).text).not.toContain('생일');
    });
  });
});
