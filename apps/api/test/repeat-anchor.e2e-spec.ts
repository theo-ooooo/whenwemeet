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
 * 반복 기준 날짜 repeatAnchor (#228, QA3-M3, D-71). 말일 보정된 회차나 옮긴 회차에서 "이후 모두" 를 골라도
 * 날짜를 바꾸지 않았으면 이후 회차 날짜가 그대로여야 한다. 웹이 보내는 본문 그대로 재현한다
 */
describe('반복 기준 날짜 (e2e)', () => {
  let app: TestApp;
  let prisma: PrismaService;
  let alice: Session;
  let groupId: number;
  const base = () => `/v1/groups/${groupId}/events`;
  const kst = (value: string) => new Date(`${value}+09:00`).toISOString();
  type Item = {
    id: number;
    occurrence: string;
    startsAt: string;
    title: string;
    repeatAnchor: string | null;
  };
  const listDates = async (from: string, to: string, id?: number) => {
    const res = await api(app)
      .get(base())
      .set(auth(alice))
      .query({ from: kst(`${from}T00:00:00`), to: kst(`${to}T00:00:00`) })
      .expect(200);
    return (res.body.data as Item[]).filter(
      (e) => id === undefined || e.id === id,
    );
  };
  const create = async (
    title: string,
    startsAt: string,
    endsAt: string,
    repeat: string,
  ) => {
    const res = await api(app)
      .post(base())
      .set(auth(alice))
      .send({ title, startsAt, endsAt, allDay: false, repeat })
      .expect(201);
    return res.body.data as Item;
  };

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    await resetDb(app);
    alice = await devLogin(app, '앨리스');
    const team = await api(app)
      .post('/v1/groups')
      .set(auth(alice))
      .send({ name: '기준 팀' })
      .expect(201);
    groupId = team.body.data.id;
  });

  afterAll(async () => {
    await resetDb(app);
    await app.close();
  });

  it('매월 31일: 2027-02-28 회차에서 "이후 모두" 로 제목만 바꿔도 3-31, 4-30, 5-31', async () => {
    const series = await create(
      '31일 회비',
      '2026-10-31T09:00:00+09:00',
      '2026-10-31T10:00:00+09:00',
      'MONTHLY',
    );
    expect(series.repeatAnchor).toBeNull();
    // QA 재현 본문 (그 회차 시각 포함)
    const res = await api(app)
      .patch(`${base()}/${series.id}`)
      .query({ scope: 'following', occurrence: '2027-02-28' })
      .set(auth(alice))
      .send({
        title: '31일 회비 (인상)',
        startsAt: '2027-02-28T09:00:00+09:00',
        endsAt: '2027-02-28T10:00:00+09:00',
        repeat: 'MONTHLY',
        repeatUntil: null,
      })
      .expect(200);
    const splitId = res.body.data.id;
    expect(res.body.data).toMatchObject({
      occurrence: '2027-02-28',
      repeat: 'MONTHLY',
      repeatAnchor: '2026-10-31',
    });
    const row = await prisma.event.findUniqueOrThrow({
      where: { id: splitId },
    });
    expect(row.repeatAnchor).toEqual(new Date('2026-10-31T00:00:00.000Z'));

    const items = await listDates('2027-03-01', '2027-04-01', splitId);
    expect(
      items.map((e) => [e.occurrence, e.startsAt, e.repeatAnchor]),
    ).toEqual([['2027-03-31', kst('2027-03-31T09:00:00'), '2026-10-31']]);
    expect(
      (await listDates('2027-04-01', '2027-06-01', splitId)).map(
        (e) => e.occurrence,
      ),
    ).toEqual(['2027-04-30', '2027-05-31']);
    // 단건 GET 도 기준 날짜를 싣고, 기준에 맞지 않는 날짜는 404
    const got = await api(app)
      .get(`${base()}/${splitId}`)
      .query({ occurrence: '2027-04-30' })
      .set(auth(alice))
      .expect(200);
    expect(got.body.data).toMatchObject({
      repeatAnchor: '2026-10-31',
      seriesStartsAt: kst('2027-02-28T09:00:00'),
    });
    await api(app)
      .get(`${base()}/${splitId}`)
      .query({ occurrence: '2027-04-28' })
      .set(auth(alice))
      .expect(404);

    // 나눈 원본을 첫 회차에서 제목만 고치면 기준 유지, 날짜를 바꾸면 기준이 사라진다
    await api(app)
      .patch(`${base()}/${splitId}`)
      .query({ scope: 'following', occurrence: '2027-02-28' })
      .set(auth(alice))
      .send({ title: '회비' })
      .expect(200);
    expect(
      (await prisma.event.findUniqueOrThrow({ where: { id: splitId } }))
        .repeatAnchor,
    ).toEqual(new Date('2026-10-31T00:00:00.000Z'));
    const moved = await api(app)
      .patch(`${base()}/${splitId}`)
      .query({ scope: 'following', occurrence: '2027-02-28' })
      .set(auth(alice))
      .send({
        startsAt: '2027-03-01T09:00:00+09:00',
        endsAt: '2027-03-01T10:00:00+09:00',
      })
      .expect(200);
    expect(moved.body.data).toMatchObject({
      occurrence: '2027-03-01',
      repeatAnchor: null,
    });
    expect(
      (await listDates('2027-04-01', '2027-05-01', splitId)).map(
        (e) => e.occurrence,
      ),
    ).toEqual(['2027-04-01']);
  });

  it('매년 2/29: 2027-02-28 회차에서 "이후 모두" 로 제목만 바꿔도 2028-02-29', async () => {
    const series = await create(
      '윤일',
      '2024-02-29T09:00:00+09:00',
      '2024-02-29T10:00:00+09:00',
      'YEARLY',
    );
    const res = await api(app)
      .patch(`${base()}/${series.id}`)
      .query({ scope: 'following', occurrence: '2027-02-28' })
      .set(auth(alice))
      .send({ title: '윤일 (바뀜)' })
      .expect(200);
    expect(res.body.data).toMatchObject({
      startsAt: kst('2027-02-28T09:00:00'),
      repeatAnchor: '2024-02-29',
    });
    expect(
      (await listDates('2028-02-01', '2028-03-15', res.body.data.id)).map(
        (e) => e.occurrence,
      ),
    ).toEqual(['2028-02-29']);
  });

  it('매주: "이 일정만" 으로 옮긴 회차에서 "이후 모두" 로 제목만 바꾸면 원래 요일에서 잇는다', async () => {
    // 2027-01-06(수) 19:00 매주, 01-13 회차를 01-15(금) 로
    const series = await create(
      '저녁',
      '2027-01-06T19:00:00+09:00',
      '2027-01-06T21:00:00+09:00',
      'WEEKLY',
    );
    await api(app)
      .patch(`${base()}/${series.id}`)
      .query({ scope: 'this', occurrence: '2027-01-13' })
      .set(auth(alice))
      .send({
        startsAt: '2027-01-15T19:00:00+09:00',
        endsAt: '2027-01-15T21:00:00+09:00',
      })
      .expect(200);
    const res = await api(app)
      .patch(`${base()}/${series.id}`)
      .query({ scope: 'following', occurrence: '2027-01-13' })
      .set(auth(alice))
      .send({ title: '저녁 (바뀜)', repeat: 'WEEKLY', repeatUntil: null })
      .expect(200);
    expect(res.body.data).toMatchObject({
      occurrence: '2027-01-13',
      startsAt: kst('2027-01-13T19:00:00'),
      repeatAnchor: null,
    });
    expect(
      (await listDates('2027-01-12', '2027-01-28', res.body.data.id)).map(
        (e) => e.occurrence,
      ),
    ).toEqual(['2027-01-13', '2027-01-20', '2027-01-27']);
  });

  it('기존 행(기준 null) 은 지금과 같이 펼친다', async () => {
    const series = await create(
      '28일',
      '2027-02-28T09:00:00+09:00',
      '2027-02-28T10:00:00+09:00',
      'MONTHLY',
    );
    expect(
      (await prisma.event.findUniqueOrThrow({ where: { id: series.id } }))
        .repeatAnchor,
    ).toBeNull();
    expect(
      (await listDates('2027-03-01', '2027-05-01', series.id)).map(
        (e) => e.occurrence,
      ),
    ).toEqual(['2027-03-28', '2027-04-28']);
  });
});
