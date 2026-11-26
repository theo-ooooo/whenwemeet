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
 * (#343) 일정 색 e2e (D-215). 실제 MySQL.
 * - 팔레트 키 8개만 받고 대문자로 저장, null = 자동
 * - 색만 바꾼 수정은 로그(새 소식)와 푸시를 만들지 않는다
 * - 반복 일정은 원본 단위: "이 일정만" 은 400, "이후 모두" 는 원본(그 뒤 회차면 새 원본)에
 */
describe('일정 색 (e2e)', () => {
  let app: TestApp;
  let prisma: PrismaService;
  let alice: Session;
  let bob: Session;
  let team: number;

  const PINK = '#F279B5';
  const BLUE = '#F26D6D';
  const kst = (date: string, time: string) =>
    new Date(`${date}T${time}+09:00`).toISOString();
  const events = () => `/v1/groups/${team}/events`;
  const body = (
    title: string,
    date: string,
    extra: Record<string, unknown> = {},
  ) => ({
    title,
    startsAt: kst(date, '10:00:00'),
    endsAt: kst(date, '11:00:00'),
    allDay: false,
    ...extra,
  });
  const create = async (input: Record<string, unknown>) =>
    (await api(app).post(events()).set(auth(alice)).send(input).expect(201))
      .body.data;
  const counts = async () => ({
    logs: await prisma.eventLog.count(),
    pushes: await prisma.pushNotification.count(),
  });
  const listColors = async (from: string, to: string) => {
    const res = await api(app)
      .get(events())
      .set(auth(bob))
      .query({ from: kst(from, '00:00:00'), to: kst(to, '00:00:00') })
      .expect(200);
    return (
      res.body.data as {
        occurrence: string | null;
        title: string;
        color: string | null;
      }[]
    ).map((e) => [e.occurrence ?? e.title, e.color]);
  };

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await resetDb(app);
    await app.close();
  });

  beforeEach(async () => {
    await resetDb(app);
    alice = await devLogin(app, '앨리스');
    bob = await devLogin(app, '밥');
    const created = await api(app)
      .post('/v1/groups')
      .set(auth(alice))
      .send({ name: '저녁 모임' })
      .expect(201);
    team = created.body.data.id;
    await api(app)
      .post('/v1/groups/join')
      .set(auth(bob))
      .send({ code: created.body.data.inviteCode })
      .expect(200);
  });

  it('생성: 생략 = null(자동), 팔레트 키는 대문자로 저장. 목록, 단건, 공개 코드 조회 모두 color', async () => {
    const auto = await create(body('자동', '2027-03-10'));
    expect(auto.color).toBeNull();
    const pink = await create(
      body('핑크', '2027-03-10', { color: PINK.toLowerCase() }),
    );
    expect(pink.color).toBe(PINK);
    const explicitNull = await create(
      body('널', '2027-03-10', { color: null }),
    );
    expect(explicitNull.color).toBeNull();

    expect(await listColors('2027-03-10', '2027-03-11')).toEqual([
      ['자동', null],
      ['핑크', PINK],
      ['널', null],
    ]);
    expect(
      (await api(app).get(`${events()}/${pink.id}`).set(auth(bob)).expect(200))
        .body.data.color,
    ).toBe(PINK);
    expect(
      (
        await api(app)
          .get(`/v1/events/${pink.publicCode}`)
          .set(auth(bob))
          .expect(200)
      ).body.data.color,
    ).toBe(PINK);
  });

  it('팔레트 밖 값은 VALIDATION_FAILED (field color). 생성, 수정 모두', async () => {
    for (const color of ['#123456', 'pink', '#F279B', 7, true, '']) {
      const res = await api(app)
        .post(events())
        .set(auth(alice))
        .send(body('틀림', '2027-03-10', { color }))
        .expect(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
      expect(res.body.error.details).toEqual([
        { field: 'color', message: '색은 정해진 8색 중 하나여야 해요' },
      ]);
    }
    const ev = await create(body('맞음', '2027-03-10'));
    const res = await api(app)
      .patch(`${events()}/${ev.id}`)
      .set(auth(alice))
      .send({ color: '#000000' })
      .expect(400);
    expect(res.body.error.details[0].field).toBe('color');
    expect(await prisma.event.count()).toBe(1);
  });

  it('한 번짜리: 색만 바꾸면 로그, 푸시 없음. 같은 색은 그대로, 다른 값과 같이 바꾸면 로그 하나', async () => {
    const ev = await create(body('저녁', '2027-03-10'));
    const before = await counts();

    const pinked = await api(app)
      .patch(`${events()}/${ev.id}`)
      .set(auth(bob))
      .send({ color: PINK })
      .expect(200);
    expect(pinked.body.data.color).toBe(PINK);
    expect(await counts()).toEqual(before);

    // 같은 색, null → 자동
    await api(app)
      .patch(`${events()}/${ev.id}`)
      .set(auth(bob))
      .send({ color: PINK, title: '저녁' })
      .expect(200);
    expect(await counts()).toEqual(before);
    const auto = await api(app)
      .patch(`${events()}/${ev.id}`)
      .set(auth(bob))
      .send({ color: null })
      .expect(200);
    expect(auto.body.data.color).toBeNull();
    expect(await counts()).toEqual(before);

    // 색 생략은 그대로, 다른 값과 같이 바꾸면 보통 수정 (로그 1)
    const both = await api(app)
      .patch(`${events()}/${ev.id}`)
      .set(auth(bob))
      .send({ color: BLUE, title: '늦은 저녁' })
      .expect(200);
    expect(both.body.data).toMatchObject({ color: BLUE, title: '늦은 저녁' });
    expect((await counts()).logs).toBe(before.logs + 1);
    const kept = await api(app)
      .patch(`${events()}/${ev.id}`)
      .set(auth(bob))
      .send({ memo: '메모' })
      .expect(200);
    expect(kept.body.data.color).toBe(BLUE);
  });

  it('반복: "이 일정만" 은 색을 받지 않는다 (참여자와 같은 규칙)', async () => {
    const series = await create(
      body('주간', '2027-03-10', { repeat: 'WEEKLY' }),
    );
    const res = await api(app)
      .patch(`${events()}/${series.id}?occurrence=2027-03-17&scope=this`)
      .set(auth(alice))
      .send({ color: PINK })
      .expect(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(res.body.error.details).toEqual([
      {
        field: 'color',
        message: '반복 일정의 색은 이후 모두로만 바꿀 수 있어요',
      },
    ]);
    // null(자동) 도 마찬가지
    await api(app)
      .patch(`${events()}/${series.id}?occurrence=2027-03-17&scope=this`)
      .set(auth(alice))
      .send({ color: null })
      .expect(400);
    // 색 없이 "이 일정만" 은 되고, 회차도 원본 색을 따른다
    await api(app)
      .patch(`${events()}/${series.id}?occurrence=2027-03-17&scope=this`)
      .set(auth(alice))
      .send({ title: '옮김' })
      .expect(200);
  });

  it('반복 첫 회차 "이후 모두" 색만: 원본 색만 바뀌고 예외, 로그, 푸시는 그대로', async () => {
    const series = await create(
      body('주간', '2027-03-10', { repeat: 'WEEKLY' }),
    );
    const before = await counts();
    const res = await api(app)
      .patch(`${events()}/${series.id}?occurrence=2027-03-10&scope=following`)
      .set(auth(bob))
      .send({ color: PINK })
      .expect(200);
    expect(res.body.data).toMatchObject({
      id: series.id,
      color: PINK,
      occurrence: '2027-03-10',
    });
    expect(await counts()).toEqual(before);
    expect(await listColors('2027-03-10', '2027-03-25')).toEqual([
      ['2027-03-10', PINK],
      ['2027-03-17', PINK],
      ['2027-03-24', PINK],
    ]);
  });

  it('반복 그 뒤 회차 "이후 모두" 색만: 그날부터 새 원본에 색, 앞 회차는 원래 색. 로그, 푸시 없음', async () => {
    const series = await create(
      body('주간', '2027-03-10', { repeat: 'WEEKLY', color: BLUE }),
    );
    const before = await counts();
    const res = await api(app)
      .patch(`${events()}/${series.id}?occurrence=2027-03-17&scope=following`)
      .set(auth(bob))
      .send({ color: PINK })
      .expect(200);
    expect(res.body.data.id).not.toBe(series.id);
    expect(res.body.data.color).toBe(PINK);
    expect(await counts()).toEqual(before);
    expect(await listColors('2027-03-10', '2027-03-25')).toEqual([
      ['2027-03-10', BLUE],
      ['2027-03-17', PINK],
      ['2027-03-24', PINK],
    ]);
  });

  it('반복 "이후 모두" 에서 다른 값과 같이 바꾸면 보통 수정 (로그 1). 색을 생략하면 새 원본이 원본 색을 잇는다', async () => {
    const series = await create(
      body('주간', '2027-03-10', { repeat: 'WEEKLY', color: PINK }),
    );
    const before = await counts();
    const split = await api(app)
      .patch(`${events()}/${series.id}?occurrence=2027-03-17&scope=following`)
      .set(auth(bob))
      .send({ title: '새 주간' })
      .expect(200);
    expect(split.body.data).toMatchObject({ title: '새 주간', color: PINK });
    expect((await counts()).logs).toBe(before.logs + 1);

    const changed = await api(app)
      .patch(`${events()}/${series.id}?occurrence=2027-03-10&scope=following`)
      .set(auth(bob))
      .send({ title: '첫 주간', color: null })
      .expect(200);
    expect(changed.body.data).toMatchObject({ title: '첫 주간', color: null });
    expect((await counts()).logs).toBe(before.logs + 2);
  });

  it('공유 링크 미리보기에 일정 색', async () => {
    const ev = await create(body('공유', '2099-03-10', { color: PINK }));
    const link = (
      await api(app)
        .post(`${events()}/${ev.id}/share`)
        .set(auth(alice))
        .send({})
        .expect(201)
    ).body.data;
    const preview = await api(app)
      .get(`/v1/event-shares/${link.token}`)
      .expect(200);
    expect(preview.body.data.event.color).toBe(PINK);
  });
});
