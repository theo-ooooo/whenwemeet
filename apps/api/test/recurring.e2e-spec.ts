import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  api,
  auth,
  createTestApp,
  devLogin,
  resetDb,
  Session,
  TestApp,
} from './helpers.js';

/**
 * 반복 일정 (#187, 설계 `반복-일정.md` 4장). 실제 DB 로 Repository 트랜잭션을 확인한다.
 * 2027-01-06(수) 19:00~21:00 KST 매주. 빈 시간 찾기가 현재 시각 이후만 보므로 미래 날짜를 쓴다
 */
describe('반복 일정 (e2e)', () => {
  let app: TestApp;
  let prisma: PrismaService;
  let alice: Session;
  let bob: Session;
  let groupId: number;
  let seriesId: number;
  let splitId: number;
  const base = () => `/v1/groups/${groupId}/events`;
  const kst = (value: string) => new Date(`${value}+09:00`).toISOString();

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    await resetDb(app);
    alice = await devLogin(app, '앨리스');
    bob = await devLogin(app, '밥');
    const team = await api(app)
      .post('/v1/groups')
      .set(auth(alice))
      .send({ name: '반복 팀' })
      .expect(201);
    groupId = team.body.data.id;
    await api(app)
      .post('/v1/groups/join')
      .set(auth(bob))
      .send({ code: team.body.data.inviteCode })
      .expect(200);
  });

  afterAll(async () => {
    await resetDb(app);
    await app.close();
  });

  it('POST: repeat 로 만들면 첫 회차를 돌려주고 CREATED 로그에 repeat 이 남는다', async () => {
    const res = await api(app)
      .post(base())
      .set(auth(alice))
      .send({
        title: '저녁',
        startsAt: '2027-01-06T19:00:00+09:00',
        endsAt: '2027-01-06T21:00:00+09:00',
        allDay: false,
        memo: '메모',
        repeat: 'WEEKLY',
      })
      .expect(201);
    seriesId = res.body.data.id;
    expect(res.body.data).toMatchObject({
      repeat: 'WEEKLY',
      repeatUntil: null,
      occurrence: '2027-01-06',
      seriesStartsAt: kst('2027-01-06T19:00:00'),
    });
    const log = await prisma.eventLog.findFirstOrThrow({
      where: { eventId: seriesId },
    });
    expect(log).toMatchObject({
      action: 'CREATED',
      repeat: 'WEEKLY',
      scope: null,
      occurrence: null,
    });
  });

  it('POST 검증: 없는 주기, 없는 날짜, 주기보다 긴 일정, repeatUntil 만', async () => {
    const input = {
      title: 't',
      startsAt: '2027-01-06T19:00:00+09:00',
      endsAt: '2027-01-06T21:00:00+09:00',
      allDay: false,
    };
    const daily = await api(app)
      .post(base())
      .set(auth(alice))
      .send({ ...input, repeat: 'DAILY' })
      .expect(400);
    expect(daily.body.error).toMatchObject({
      code: 'VALIDATION_FAILED',
      details: [{ field: 'repeat' }],
    });
    const badDate = await api(app)
      .post(base())
      .set(auth(alice))
      .send({ ...input, repeat: 'WEEKLY', repeatUntil: '2027-02-30' })
      .expect(400);
    expect(badDate.body.error.details[0].field).toBe('repeatUntil');
    const tooLong = await api(app)
      .post(base())
      .set(auth(alice))
      .send({ ...input, endsAt: '2027-01-13T19:00:00+09:00', repeat: 'WEEKLY' })
      .expect(400);
    expect(tooLong.body).toMatchObject({
      message: '반복 간격보다 긴 일정은 반복할 수 없어요',
      error: { code: 'EVENT_RANGE_INVALID' },
    });
    const untilOnly = await api(app)
      .post(base())
      .set(auth(alice))
      .send({ ...input, repeatUntil: '2027-02-01' })
      .expect(400);
    expect(untilOnly.body.error).toMatchObject({
      code: 'VALIDATION_FAILED',
      details: [{ field: 'repeatUntil' }],
    });
  });

  it('GET 목록: 기간 안 회차로 펼친다', async () => {
    const res = await api(app)
      .get(base())
      .set(auth(bob))
      .query({
        from: kst('2027-01-01T00:00:00'),
        to: kst('2027-02-01T00:00:00'),
      })
      .expect(200);
    expect(
      res.body.data.map((e: { id: number; occurrence: string }) => [
        e.id,
        e.occurrence,
      ]),
    ).toEqual([
      [seriesId, '2027-01-06'],
      [seriesId, '2027-01-13'],
      [seriesId, '2027-01-20'],
      [seriesId, '2027-01-27'],
    ]);
    expect(res.body.data[1]).toMatchObject({
      startsAt: kst('2027-01-13T19:00:00'),
      endsAt: kst('2027-01-13T21:00:00'),
      title: '저녁',
      memo: '메모',
    });
  });

  it('PATCH this: 예외 행에는 바뀐 필드만, 원래 값으로 되돌리면 예외 행을 지운다', async () => {
    const q = { scope: 'this', occurrence: '2027-01-13' };
    const missing = await api(app)
      .patch(`${base()}/${seriesId}`)
      .set(auth(bob))
      .send({ title: 'x' })
      .expect(400);
    expect(missing.body.error.details[0].field).toBe('scope');
    const withRepeat = await api(app)
      .patch(`${base()}/${seriesId}`)
      .query(q)
      .set(auth(bob))
      .send({ repeat: 'MONTHLY' })
      .expect(400);
    expect(withRepeat.body.error.details[0].field).toBe('repeat');

    const res = await api(app)
      .patch(`${base()}/${seriesId}`)
      .query(q)
      .set(auth(bob))
      .send({
        startsAt: '2027-01-13T20:00:00+09:00',
        endsAt: '2027-01-13T22:00:00+09:00',
      })
      .expect(200);
    expect(res.body.data).toMatchObject({
      id: seriesId,
      occurrence: '2027-01-13',
      startsAt: kst('2027-01-13T20:00:00'),
      title: '저녁',
    });
    const row = await prisma.eventException.findFirstOrThrow({
      where: { eventId: seriesId },
    });
    expect(row).toMatchObject({
      cancelled: false,
      title: null,
      allDay: null,
      memo: null,
      startsAt: new Date(kst('2027-01-13T20:00:00')),
    });

    const first = await api(app)
      .get(`${base()}/${seriesId}`)
      .query({ occurrence: '2027-01-06' })
      .set(auth(bob))
      .expect(200);
    expect(first.body.data).toMatchObject({
      occurrence: '2027-01-06',
      hasLaterExceptions: true,
    });

    // 같은 값이면 로그도 없다 (#62)
    const before = await prisma.eventLog.count();
    await api(app)
      .patch(`${base()}/${seriesId}`)
      .query(q)
      .set(auth(bob))
      .send({ startsAt: '2027-01-13T11:00:00Z' })
      .expect(200);
    expect(await prisma.eventLog.count()).toBe(before);

    await api(app)
      .patch(`${base()}/${seriesId}`)
      .query(q)
      .set(auth(bob))
      .send({
        startsAt: '2027-01-13T19:00:00+09:00',
        endsAt: '2027-01-13T21:00:00+09:00',
      })
      .expect(200);
    expect(
      await prisma.eventException.count({ where: { eventId: seriesId } }),
    ).toBe(0);
    expect(await prisma.eventLog.count()).toBe(before + 1);
  });

  it('DELETE this: 그 회차만 사라지고 단건 GET 은 404', async () => {
    await api(app)
      .delete(`${base()}/${seriesId}`)
      .query({ scope: 'this', occurrence: '2027-01-20' })
      .set(auth(bob))
      .expect(200);
    await api(app)
      .get(`${base()}/${seriesId}`)
      .query({ occurrence: '2027-01-20' })
      .set(auth(bob))
      .expect(404);
    const res = await api(app)
      .get(base())
      .set(auth(bob))
      .query({
        from: kst('2027-01-15T00:00:00'),
        to: kst('2027-01-25T00:00:00'),
      })
      .expect(200);
    expect(res.body.data).toEqual([]);
    const log = await prisma.eventLog.findFirstOrThrow({
      where: { action: 'DELETED' },
      orderBy: { id: 'desc' },
    });
    expect(log).toMatchObject({
      eventId: seriesId,
      scope: 'THIS',
      repeat: 'WEEKLY',
      occurrence: new Date('2027-01-20T00:00:00.000Z'),
      startsAt: new Date(kst('2027-01-20T19:00:00')),
    });
  });

  it('PATCH following (그 뒤 회차): 원본을 전날에서 끊고 새 원본은 원본 등록자로 만든다', async () => {
    await api(app)
      .patch(`${base()}/${seriesId}`)
      .query({ scope: 'this', occurrence: '2027-02-03' })
      .set(auth(bob))
      .send({ title: '뒤 예외' })
      .expect(200);
    const res = await api(app)
      .patch(`${base()}/${seriesId}`)
      .query({ scope: 'following', occurrence: '2027-01-27' })
      .set(auth(bob))
      .send({ title: '새 제목', repeatUntil: '2027-03-31' })
      .expect(200);
    splitId = res.body.data.id;
    expect(splitId).not.toBe(seriesId);
    expect(res.body.data).toMatchObject({
      title: '새 제목',
      occurrence: '2027-01-27',
      repeat: 'WEEKLY',
      repeatUntil: '2027-03-31',
      creator: { userId: alice.userId },
    });

    const original = await prisma.event.findUniqueOrThrow({
      where: { id: seriesId },
      include: { exceptions: true },
    });
    expect(original.repeatUntil).toEqual(new Date('2027-01-26T00:00:00.000Z'));
    // 01-20 취소는 남고 02-03 예외는 지워졌다 (D-67)
    expect(
      original.exceptions.map((e) => e.occurrence.toISOString().slice(0, 10)),
    ).toEqual(['2027-01-20']);

    const list = await api(app)
      .get(base())
      .set(auth(alice))
      .query({
        from: kst('2027-01-01T00:00:00'),
        to: kst('2027-02-11T00:00:00'),
      })
      .expect(200);
    expect(
      list.body.data.map(
        (e: { id: number; occurrence: string; title: string }) => [
          e.id,
          e.occurrence,
          e.title,
        ],
      ),
    ).toEqual([
      [seriesId, '2027-01-06', '저녁'],
      [seriesId, '2027-01-13', '저녁'],
      [splitId, '2027-01-27', '새 제목'],
      [splitId, '2027-02-03', '새 제목'],
      [splitId, '2027-02-10', '새 제목'],
    ]);
    const log = await prisma.eventLog.findFirstOrThrow({
      where: { action: 'UPDATED' },
      orderBy: { id: 'desc' },
    });
    expect(log).toMatchObject({
      eventId: splitId,
      scope: 'FOLLOWING',
      occurrence: new Date('2027-01-27T00:00:00.000Z'),
      title: '새 제목',
    });
  });

  it('PATCH following (첫 회차): 원본 수정 + 예외 전부 삭제', async () => {
    await api(app)
      .delete(`${base()}/${splitId}`)
      .query({ scope: 'this', occurrence: '2027-02-10' })
      .set(auth(bob))
      .expect(200);
    const res = await api(app)
      .patch(`${base()}/${splitId}`)
      .query({ scope: 'following', occurrence: '2027-01-27' })
      .set(auth(bob))
      .send({
        startsAt: '2027-01-28T19:00:00+09:00',
        endsAt: '2027-01-28T20:00:00+09:00',
      })
      .expect(200);
    expect(res.body.data).toMatchObject({
      id: splitId,
      occurrence: '2027-01-28',
      startsAt: kst('2027-01-28T19:00:00'),
    });
    expect(
      await prisma.eventException.count({ where: { eventId: splitId } }),
    ).toBe(0);
  });

  it('빈 시간 찾기: 반복 회차도 바쁨으로 센다', async () => {
    const res = await api(app)
      .get(`/v1/groups/${groupId}/free-slots`)
      .set(auth(bob))
      .query({
        from: kst('2027-01-13T00:00:00'),
        to: kst('2027-01-14T00:00:00'),
        dayStart: '18:00',
        dayEnd: '23:00',
        minMinutes: 60,
      })
      .expect(200);
    expect(res.body.data.slots).toEqual([
      {
        startsAt: kst('2027-01-13T18:00:00'),
        endsAt: kst('2027-01-13T19:00:00'),
      },
      {
        startsAt: kst('2027-01-13T21:00:00'),
        endsAt: kst('2027-01-13T23:00:00'),
      },
    ]);
  });

  it('새 소식: repeat, scope, occurrence 를 싣는다', async () => {
    const res = await api(app)
      .get(`/v1/groups/${groupId}/news`)
      .set(auth(alice))
      .expect(200);
    const items = res.body.data.items as {
      action: string;
      scope: string | null;
      occurrence: string | null;
      repeat: string | null;
    }[];
    expect(
      items.some(
        (i) =>
          i.action === 'UPDATED' &&
          i.scope === 'FOLLOWING' &&
          i.occurrence === '2027-01-27' &&
          i.repeat === 'WEEKLY',
      ),
    ).toBe(true);
    expect(items.some((i) => i.action === 'CREATED')).toBe(false); // 만든 사람(앨리스) 본인 로그는 빠진다
    expect(
      items.some(
        (i) =>
          i.action === 'DELETED' &&
          i.scope === 'THIS' &&
          i.occurrence === '2027-01-20',
      ),
    ).toBe(true);
  });

  it('DELETE following: 그 뒤 회차는 끊고, 첫 회차는 원본 삭제 (예외 cascade)', async () => {
    await api(app)
      .delete(`${base()}/${seriesId}`)
      .query({ scope: 'following', occurrence: '2027-01-13' })
      .set(auth(bob))
      .expect(200);
    expect(
      (await prisma.event.findUniqueOrThrow({ where: { id: seriesId } }))
        .repeatUntil,
    ).toEqual(new Date('2027-01-12T00:00:00.000Z'));
    expect(
      await prisma.eventException.count({ where: { eventId: seriesId } }),
    ).toBe(0);

    await api(app)
      .delete(`${base()}/${seriesId}`)
      .query({ scope: 'following', occurrence: '2027-01-06' })
      .set(auth(bob))
      .expect(200);
    expect(
      await prisma.event.findUnique({ where: { id: seriesId } }),
    ).toBeNull();
    const log = await prisma.eventLog.findFirstOrThrow({
      orderBy: { id: 'desc' },
    });
    expect(log).toMatchObject({
      action: 'DELETED',
      eventId: null,
      scope: 'FOLLOWING',
      occurrence: new Date('2027-01-06T00:00:00.000Z'),
    });
  });

  it('한 번짜리 일정은 occurrence, scope 를 무시하고 반복 필드는 null', async () => {
    const created = await api(app)
      .post(base())
      .set(auth(alice))
      .send({
        title: '한 번',
        startsAt: '2027-01-08T10:00:00+09:00',
        endsAt: '2027-01-08T11:00:00+09:00',
        allDay: false,
      })
      .expect(201);
    const id = created.body.data.id;
    expect(created.body.data).toMatchObject({
      repeat: null,
      repeatUntil: null,
      occurrence: null,
      seriesStartsAt: null,
    });
    const got = await api(app)
      .get(`${base()}/${id}`)
      .query({ occurrence: 'garbage' })
      .set(auth(alice))
      .expect(200);
    expect(got.body.data.hasLaterExceptions).toBe(false);
    await api(app)
      .patch(`${base()}/${id}`)
      .query({ scope: 'nope' })
      .set(auth(alice))
      .send({ title: '바뀜' })
      .expect(200);
    await api(app)
      .delete(`${base()}/${id}`)
      .query({ scope: 'nope' })
      .set(auth(alice))
      .expect(200);
  });
});
