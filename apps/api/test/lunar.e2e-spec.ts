import request from 'supertest';
import { lunarOccurrence, solarToLunar } from '../src/common/lunar.js';
import { addDays, kstDate } from '../src/events/recurrence.js';
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
 * 음력 (#562, D-297): 음력 기념일, 음력 생일, 매년(음력) 반복, 달력 음력 표시 설정.
 * 해마다 양력으로 바꾼 날이 목록, 알림, 구독 피드에 같이 나오는지
 */
describe('음력 (e2e)', () => {
  const fake = new FakeExpo();
  let app: TestApp;
  let prisma: PrismaService;
  let scheduler: PushScheduler;
  let alice: Session;
  let bob: Session;
  let teamId: number;

  const DAY_MS = 86_400_000;
  const BOB_TOKEN = 'ExponentPushToken[bob-ios]';
  const kst = (value: string) => new Date(`${value}+09:00`).toISOString();
  const anniversaries = () => `/v1/groups/${teamId}/anniversaries`;
  const events = () => `/v1/groups/${teamId}/events`;
  /** 실제 오늘 기준 n 일 뒤 KST 날짜 */
  const kstIn = (days: number) => kstDate(new Date(Date.now() + days * DAY_MS));
  /** 그날을 작년 음력 같은 월일로 넣으면 올해 그날이 되도록 (30일, 윤달처럼 해마다 다른 날은 피한다) */
  const lunarLastYearOf = (day: string): string => {
    const lunar = solarToLunar(day)!;
    return `${lunar.year - 1}-${String(lunar.month).padStart(2, '0')}-${String(lunar.day).padStart(2, '0')}`;
  };
  /** 앞으로 n 일 뒤부터 작년 같은 음력 월일이 올해 그날로 오는 첫 날 */
  const stableLunarDayFrom = (days: number): string => {
    for (let i = days; ; i += 1) {
      const day = kstIn(i);
      const lunar = solarToLunar(day)!;
      if (
        !lunar.leap &&
        lunar.day <= 28 &&
        lunarOccurrence(lunar.year - 1, lunar.month, lunar.day, false) !== null
      )
        return day;
    }
  };

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
    const team = await api(app)
      .post('/v1/groups')
      .set(auth(alice))
      .send({ name: '가족' })
      .expect(201);
    teamId = team.body.data.id as number;
    await api(app)
      .post('/v1/groups/join')
      .set(auth(bob))
      .send({ code: team.body.data.inviteCode })
      .expect(200);
  });

  describe('음력 기념일', () => {
    it('만들기: 음력 윤달을 저장하고 목록에 싣는다. 생략하면 양력', async () => {
      const lunar = await api(app)
        .post(anniversaries())
        .set(auth(alice))
        .send({
          name: '할머니 제사',
          date: '2025-06-15',
          kind: 'YEARLY',
          calendar: 'LUNAR',
          isLeapMonth: true,
        })
        .expect(201);
      expect(lunar.body.data).toMatchObject({
        name: '할머니 제사',
        date: '2025-06-15',
        kind: 'YEARLY',
        calendar: 'LUNAR',
        isLeapMonth: true,
      });
      const solar = await api(app)
        .post(anniversaries())
        .set(auth(alice))
        .send({ name: '처음 만난 날', date: '2024-03-15' })
        .expect(201);
      expect(solar.body.data).toMatchObject({
        calendar: 'SOLAR',
        isLeapMonth: false,
      });
      const list = (
        await api(app).get(anniversaries()).set(auth(bob)).expect(200)
      ).body.data as { name: string; calendar: string; isLeapMonth: boolean }[];
      expect(list.map((a) => [a.name, a.calendar, a.isLeapMonth])).toEqual([
        ['처음 만난 날', 'SOLAR', false],
        ['할머니 제사', 'LUNAR', true],
      ]);
      // 새 소식 기록에 음력 키가 남는다
      const activity = await prisma.groupActivity.findFirstOrThrow({
        where: { anniversaryId: lunar.body.data.id },
      });
      expect(activity.payload).toMatchObject({
        date: '2025-06-15',
        calendar: 'LUNAR',
        isLeapMonth: true,
      });
    });

    it('검사: 없는 윤달, 그 해에 없는 30일, 2050년 뒤, 양력 윤달은 400 VALIDATION_FAILED', async () => {
      const bad = async (body: Record<string, unknown>, field: string) => {
        const res = await api(app)
          .post(anniversaries())
          .set(auth(alice))
          .send({ name: '제사', kind: 'YEARLY', ...body })
          .expect(400);
        expect(res.body.error).toMatchObject({ code: 'VALIDATION_FAILED' });
        expect(res.body.error.details[0].field).toBe(field);
      };
      await bad(
        { date: '2026-06-15', calendar: 'LUNAR', isLeapMonth: true },
        'isLeapMonth',
      );
      await bad({ date: '2026-02-30', calendar: 'LUNAR' }, 'date');
      await bad({ date: '2051-01-01', calendar: 'LUNAR' }, 'date');
      await bad({ date: '2026-02-28', isLeapMonth: true }, 'isLeapMonth');
      await bad({ date: '2026-02-30' }, 'date');
      // 음력 2월 30일이 있는 해는 된다 (2027)
      await api(app)
        .post(anniversaries())
        .set(auth(alice))
        .send({ name: '제사', date: '2027-02-30', calendar: 'LUNAR' })
        .expect(201);
    });

    it('수정: 윤달만 켜도 저장된 날짜와 합쳐 검사, 양력으로 바꾸면 윤달은 꺼진다', async () => {
      const created = await api(app)
        .post(anniversaries())
        .set(auth(alice))
        .send({ name: '제사', date: '2025-06-15', calendar: 'LUNAR' })
        .expect(201);
      const path = `${anniversaries()}/${created.body.data.id}`;
      expect(
        (
          await api(app)
            .patch(path)
            .set(auth(alice))
            .send({ isLeapMonth: true })
            .expect(200)
        ).body.data,
      ).toMatchObject({ calendar: 'LUNAR', isLeapMonth: true });
      // 2026 에는 윤6월이 없다
      await api(app)
        .patch(path)
        .set(auth(alice))
        .send({ date: '2026-06-15' })
        .expect(400);
      expect(
        (
          await api(app)
            .patch(path)
            .set(auth(alice))
            .send({ calendar: 'SOLAR' })
            .expect(200)
        ).body.data,
      ).toMatchObject({
        date: '2025-06-15',
        calendar: 'SOLAR',
        isLeapMonth: false,
      });
      // 양력으로 바꾸면서 양력에 없는 날짜는 막는다
      const lunar30 = await api(app)
        .post(anniversaries())
        .set(auth(alice))
        .send({ name: '30일', date: '2026-01-30', calendar: 'LUNAR' })
        .expect(201);
      await api(app)
        .patch(`${anniversaries()}/${lunar30.body.data.id}`)
        .set(auth(alice))
        .send({ date: '2026-02-30', calendar: 'LUNAR' })
        .expect(400);
    });

    it('알림: 작년 음력 날짜로 넣어도 올해 그 음력 날의 양력 09:00 에 보낸다', async () => {
      await api(app)
        .put('/v1/me/push-devices')
        .set(auth(bob))
        .send({ token: BOB_TOKEN, platform: 'IOS', appVersion: '1.1.0' })
        .expect(200);
      await prisma.pushNotification.updateMany({
        where: { status: 'PENDING' },
        data: { status: 'SKIPPED' },
      });
      const day = stableLunarDayFrom(2);
      await api(app)
        .post(anniversaries())
        .set(auth(alice))
        .send({
          name: '할머니 제사',
          date: lunarLastYearOf(day),
          kind: 'YEARLY',
          calendar: 'LUNAR',
          reminders: ['DAY_OF'],
        })
        .expect(201);
      // 양력 같은 월일(작년 음력 날짜의 월일)에는 보내지 않고, 그날 보낸다
      await scheduler.tick(new Date(`${addDays(day, -1)}T09:00:20+09:00`));
      expect(fake.messages).toEqual([]);
      await scheduler.tick(new Date(`${day}T09:00:20+09:00`));
      expect(fake.messages.map((m) => [m.to, m.title, m.body])).toEqual([
        [BOB_TOKEN, '할머니 제사', '오늘은 할머니 제사예요'],
      ]);
    });

    it('구독 피드: 음력 기념일이 그해 양력 날짜의 종일 일정으로', async () => {
      const day = stableLunarDayFrom(10);
      const created = await api(app)
        .post(anniversaries())
        .set(auth(alice))
        .send({
          name: '제사',
          date: lunarLastYearOf(day),
          kind: 'YEARLY',
          calendar: 'LUNAR',
        })
        .expect(201);
      const feedPath = `/v1/groups/${teamId}/calendar-feed`;
      const { httpsUrl } = (
        await api(app).put(feedPath).set(auth(alice)).send({}).expect(200)
      ).body.data as { httpsUrl: string };
      const body = (
        await request(app.getHttpServer())
          .get(new URL(httpsUrl).pathname)
          .expect(200)
      ).text;
      expect(body).toContain(
        `UID:a${created.body.data.id}-${day.replace(/-/g, '')}@whenwemeet.day`,
      );
      expect(body).toContain(`DTSTART;VALUE=DATE:${day.replace(/-/g, '')}`);
    });
  });

  describe('음력 생일', () => {
    it('PATCH /me/birthday 음력 윤달 → GET /me, 팀 생일 목록에 달력 종류와 윤달', async () => {
      const saved = await api(app)
        .patch('/v1/me/birthday')
        .set(auth(alice))
        .send({ date: '04-30', calendar: 'LUNAR', isLeapMonth: true })
        .expect(200);
      expect(saved.body.data).toMatchObject({
        date: '04-30',
        calendar: 'LUNAR',
        isLeapMonth: true,
      });
      expect(
        (await api(app).get('/v1/me').set(auth(alice)).expect(200)).body.data
          .birthday,
      ).toMatchObject({ date: '04-30', calendar: 'LUNAR', isLeapMonth: true });
      const list = (
        await api(app)
          .get(`/v1/groups/${teamId}/birthdays`)
          .set(auth(bob))
          .expect(200)
      ).body.data as { date: string; calendar: string; isLeapMonth: boolean }[];
      expect(list).toEqual([
        expect.objectContaining({
          date: '04-30',
          calendar: 'LUNAR',
          isLeapMonth: true,
        }),
      ]);
    });

    it('검사: 음력 31일, 양력 윤달은 400. 지우면 양력으로 돌아간다', async () => {
      await api(app)
        .patch('/v1/me/birthday')
        .set(auth(alice))
        .send({ date: '04-31', calendar: 'LUNAR' })
        .expect(400);
      await api(app)
        .patch('/v1/me/birthday')
        .set(auth(alice))
        .send({ date: '04-15', isLeapMonth: true })
        .expect(400);
      // 음력 2월 30일은 받는다 (29일인 해에는 29일)
      await api(app)
        .patch('/v1/me/birthday')
        .set(auth(alice))
        .send({ date: '02-30', calendar: 'LUNAR' })
        .expect(200);
      const cleared = await api(app)
        .patch('/v1/me/birthday')
        .set(auth(alice))
        .send({ date: null })
        .expect(200);
      expect(cleared.body.data).toMatchObject({
        date: null,
        calendar: 'SOLAR',
        isLeapMonth: false,
      });
    });
  });

  describe('매년(음력) 반복 일정', () => {
    it('추석 저녁: 2027 은 9-15, 2028 은 10-03 같은 시각. 단건 GET 도 음력 회차만', async () => {
      const created = await api(app)
        .post(events())
        .set(auth(alice))
        .send({
          title: '추석 저녁',
          startsAt: kst('2026-09-25T19:00:00'),
          endsAt: kst('2026-09-25T21:00:00'),
          allDay: false,
          repeat: 'YEARLY_LUNAR',
        })
        .expect(201);
      expect(created.body.data).toMatchObject({
        repeat: 'YEARLY_LUNAR',
        occurrence: '2026-09-25',
      });
      const id = created.body.data.id as number;
      const list = async (from: string, to: string) =>
        (
          (
            await api(app)
              .get(events())
              .set(auth(bob))
              .query({
                from: kst(`${from}T00:00:00`),
                to: kst(`${to}T00:00:00`),
              })
              .expect(200)
          ).body.data as { id: number; occurrence: string; startsAt: string }[]
        )
          .filter((e) => e.id === id)
          .map((e) => [e.occurrence, e.startsAt]);
      expect(await list('2027-09-01', '2027-10-01')).toEqual([
        ['2027-09-15', kst('2027-09-15T19:00:00')],
      ]);
      expect(await list('2028-09-15', '2028-10-15')).toEqual([
        ['2028-10-03', kst('2028-10-03T19:00:00')],
      ]);
      await api(app)
        .get(`${events()}/${id}`)
        .query({ occurrence: '2027-09-15' })
        .set(auth(bob))
        .expect(200);
      await api(app)
        .get(`${events()}/${id}`)
        .query({ occurrence: '2027-09-25' })
        .set(auth(bob))
        .expect(404);
    });

    it('2050년 뒤 시작은 400 (변환표 범위 밖)', async () => {
      const res = await api(app)
        .post(events())
        .set(auth(alice))
        .send({
          title: '먼 제사',
          startsAt: kst('2051-03-01T09:00:00'),
          endsAt: kst('2051-03-01T10:00:00'),
          allDay: false,
          repeat: 'YEARLY_LUNAR',
        })
        .expect(400);
      expect(res.body.error.details[0].field).toBe('repeat');
    });
  });

  describe('(#566) 음력으로 넣은 일정 lunarInput', () => {
    it('만들기, 단건, 목록, 수정으로 오간다. 생략은 false, 수정 생략은 그대로, 이것만 바꾸면 새 소식 로그 없음', async () => {
      const created = await api(app)
        .post(events())
        .set(auth(alice))
        .send({
          title: '할머니 생신 잔치',
          startsAt: kst('2026-11-24T18:00:00'),
          endsAt: kst('2026-11-24T20:00:00'),
          allDay: false,
          lunarInput: true,
        })
        .expect(201);
      expect(created.body.data).toMatchObject({ lunarInput: true });
      const id = created.body.data.id as number;
      expect(
        (await api(app).get(`${events()}/${id}`).set(auth(bob)).expect(200))
          .body.data.lunarInput,
      ).toBe(true);
      const list = (
        await api(app)
          .get(events())
          .set(auth(bob))
          .query({
            from: kst('2026-11-24T00:00:00'),
            to: kst('2026-11-25T00:00:00'),
          })
          .expect(200)
      ).body.data as {
        id: number;
        lunarInput: boolean;
      }[];
      expect(list.find((e) => e.id === id)?.lunarInput).toBe(true);

      // 수정에서 생략하면 그대로
      const renamed = await api(app)
        .patch(`${events()}/${id}`)
        .set(auth(alice))
        .send({ title: '생신 잔치' })
        .expect(200);
      expect(renamed.body.data).toMatchObject({
        title: '생신 잔치',
        lunarInput: true,
      });
      // 이것만 끄면 저장하되 UPDATED 로그는 늘지 않는다 (색과 같은 규칙)
      const logs = await prisma.eventLog.count({ where: { eventId: id } });
      const off = await api(app)
        .patch(`${events()}/${id}`)
        .set(auth(alice))
        .send({ lunarInput: false })
        .expect(200);
      expect(off.body.data.lunarInput).toBe(false);
      expect(await prisma.eventLog.count({ where: { eventId: id } })).toBe(
        logs,
      );

      const plain = await api(app)
        .post(events())
        .set(auth(alice))
        .send({
          title: '저녁',
          startsAt: kst('2026-11-25T18:00:00'),
          endsAt: kst('2026-11-25T19:00:00'),
          allDay: false,
        })
        .expect(201);
      expect(plain.body.data.lunarInput).toBe(false);
      await api(app)
        .post(events())
        .set(auth(alice))
        .send({
          title: '틀림',
          startsAt: kst('2026-11-25T18:00:00'),
          endsAt: kst('2026-11-25T19:00:00'),
          allDay: false,
          lunarInput: 'yes',
        })
        .expect(400);
    });

    it('반복 일정: "이 일정만" 은 400, "이후 모두" 는 원본에 저장. 구독 피드 설명 첫 줄에 음력 날짜', async () => {
      const created = await api(app)
        .post(events())
        .set(auth(alice))
        .send({
          title: '모임',
          startsAt: kst('2026-11-24T18:00:00'),
          endsAt: kst('2026-11-24T19:00:00'),
          allDay: false,
          repeat: 'WEEKLY',
        })
        .expect(201);
      const id = created.body.data.id as number;
      const thisOnly = await api(app)
        .patch(`${events()}/${id}`)
        .query({ occurrence: '2026-12-01', scope: 'this' })
        .set(auth(alice))
        .send({ lunarInput: true })
        .expect(400);
      expect(thisOnly.body.error.details[0].field).toBe('lunarInput');
      const following = await api(app)
        .patch(`${events()}/${id}`)
        .query({ occurrence: '2026-11-24', scope: 'following' })
        .set(auth(alice))
        .send({ lunarInput: true })
        .expect(200);
      expect(following.body.data.lunarInput).toBe(true);
      expect(
        (
          await api(app)
            .get(`${events()}/${id}`)
            .query({ occurrence: '2026-12-01' })
            .set(auth(bob))
            .expect(200)
        ).body.data.lunarInput,
      ).toBe(true);

      const feedPath = `/v1/groups/${teamId}/calendar-feed`;
      const { httpsUrl } = (
        await api(app).put(feedPath).set(auth(alice)).send({}).expect(200)
      ).body.data as { httpsUrl: string };
      const body = (
        await request(app.getHttpServer())
          .get(new URL(httpsUrl).pathname)
          .expect(200)
      ).text.replace(/\r\n /g, '');
      // 2026-11-24 = 음력 10월 16일, 2026-12-01 = 음력 10월 23일
      expect(body).toContain('DESCRIPTION:음력 10월 16일\\n참여: 앨리스');
      expect(body).toContain('DESCRIPTION:음력 10월 23일\\n참여: 앨리스');
    });
  });

  it('달력 음력 표시: 기본 끔, PATCH /me/lunar-display 로 켜고 GET /me 에 실린다', async () => {
    expect(
      (await api(app).get('/v1/me').set(auth(alice)).expect(200)).body.data
        .showLunar,
    ).toBe(false);
    expect(
      (
        await api(app)
          .patch('/v1/me/lunar-display')
          .set(auth(alice))
          .send({ showLunar: true })
          .expect(200)
      ).body.data,
    ).toEqual({ showLunar: true });
    expect(
      (await api(app).get('/v1/me').set(auth(alice)).expect(200)).body.data
        .showLunar,
    ).toBe(true);
    expect(
      (await api(app).get('/v1/me').set(auth(bob)).expect(200)).body.data
        .showLunar,
    ).toBe(false);
    await api(app)
      .patch('/v1/me/lunar-display')
      .set(auth(alice))
      .send({ showLunar: 'yes' })
      .expect(400);
  });
});
