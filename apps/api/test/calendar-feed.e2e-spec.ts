import ICAL from 'ical.js';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { api, auth, createTestApp, devLogin, resetDb, Session, TestApp } from './helpers.js';

/**
 * (#193) 외부 캘린더 구독 (api.md 2.12, D-217 ~ D-220). 주소 수명(만들기, 설정, 재발급, 끄기, 나가기, 탈퇴),
 * 피드 내용(반복 펼침, 예외, 종일, 메모 토글, 기념일), ETag 304, 요청 제한 429, 무효 토큰 404 (본문 없음).
 * 피드 창이 오늘 기준이라 2027-01 날짜를 쓴다 (과거 60일 ~ 미래 400일 안)
 */
describe('외부 캘린더 구독 (e2e)', () => {
  let app: TestApp;
  let prisma: PrismaService;
  let alice: Session;
  let bob: Session;
  let carol: Session;
  let groupId: number;
  const feedPath = (id = groupId) => `/v1/groups/${id}/calendar-feed`;
  /** 공개 피드는 봉투가 없어 api() 의 봉투 검사를 쓰지 않는다 */
  const raw = () => request(app.getHttpServer());
  const pathOf = (httpsUrl: string) => new URL(httpsUrl).pathname;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    await resetDb(app);
    alice = await devLogin(app, '앨리스');
    bob = await devLogin(app, '밥');
    carol = await devLogin(app, '캐럴');
    const team = await api(app).post('/v1/groups').set(auth(alice)).send({ name: '우리, 팀' }).expect(201);
    groupId = team.body.data.id;
    await api(app).post('/v1/groups/join').set(auth(bob)).send({ code: team.body.data.inviteCode }).expect(200);
    const events = `/v1/groups/${groupId}/events`;
    await api(app)
      .post(events)
      .set(auth(alice))
      .send({ title: '토요일 저녁', startsAt: '2027-01-09T19:00:00+09:00', endsAt: '2027-01-09T21:00:00+09:00', allDay: false, memo: '비밀 메모', participants: [alice.userId, bob.userId] })
      .expect(201);
    await api(app)
      .post(events)
      .set(auth(alice))
      .send({ title: '제주 여행', startsAt: '2027-01-15T00:00:00+09:00', endsAt: '2027-01-18T00:00:00+09:00', allDay: true })
      .expect(201);
    const series = await api(app)
      .post(events)
      .set(auth(alice))
      .send({ title: '주간 회의', startsAt: '2027-01-06T10:00:00+09:00', endsAt: '2027-01-06T11:00:00+09:00', allDay: false, repeat: 'WEEKLY', repeatUntil: '2027-01-27' })
      .expect(201);
    const seriesId = series.body.data.id;
    await api(app).delete(`${events}/${seriesId}`).query({ scope: 'this', occurrence: '2027-01-13' }).set(auth(alice)).expect(200);
    await api(app)
      .patch(`${events}/${seriesId}`)
      .query({ scope: 'this', occurrence: '2027-01-20' })
      .set(auth(alice))
      .send({ title: '옮긴 회의', startsAt: '2027-01-21T15:00:00+09:00', endsAt: '2027-01-21T16:00:00+09:00' })
      .expect(200);
    await api(app).post(`/v1/groups/${groupId}/anniversaries`).set(auth(alice)).send({ name: '팀 창립', date: '2026-10-01', kind: 'COUNT_UP' }).expect(201);
  });

  afterAll(async () => {
    await resetDb(app);
    await app.close();
  });

  it('처음엔 null, PUT 으로 만들면 기본값(메모 끔, 기념일 켬)과 주소 셋. 토큰 자체는 DB 에 없다', async () => {
    expect((await api(app).get(feedPath()).set(auth(alice)).expect(200)).body.data).toBeNull();
    const created = (await api(app).put(feedPath()).set(auth(alice)).send({}).expect(200)).body.data;
    expect(Object.keys(created).sort()).toEqual(['createdAt', 'googleAddUrl', 'httpsUrl', 'includeAnniversaries', 'includeMemo', 'lastFetchedAt', 'webcalUrl']);
    expect(created).toMatchObject({ includeMemo: false, includeAnniversaries: true, lastFetchedAt: null });
    const token = /\/v1\/ics\/([A-Za-z0-9_-]{43})\.ics$/.exec(created.httpsUrl)?.[1];
    expect(token).toBeDefined();
    expect(created.webcalUrl).toBe(created.httpsUrl.replace(/^https?:/, 'webcal:'));
    expect(created.googleAddUrl).toBe(`https://calendar.google.com/calendar/r?cid=${encodeURIComponent(created.webcalUrl)}`);
    const row = await prisma.calendarFeed.findUniqueOrThrow({ where: { userId_groupId: { userId: alice.userId, groupId } } });
    expect(JSON.stringify(row)).not.toContain(token);
    expect(row.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    // 다시 조회해도 같은 주소 (복사할 때마다 재발급하지 않는다)
    expect((await api(app).get(feedPath()).set(auth(alice)).expect(200)).body.data.httpsUrl).toBe(created.httpsUrl);
  });

  it('PUT 은 설정만 바꾸고 토큰을 유지한다. 잘못된 값은 400, 비멤버는 403', async () => {
    const before = (await api(app).get(feedPath()).set(auth(alice)).expect(200)).body.data;
    const after = (await api(app).put(feedPath()).set(auth(alice)).send({ includeMemo: true }).expect(200)).body.data;
    expect(after.httpsUrl).toBe(before.httpsUrl);
    expect(after).toMatchObject({ includeMemo: true, includeAnniversaries: true });
    await api(app).put(feedPath()).set(auth(alice)).send({ includeMemo: 'yes' }).expect(400);
    await api(app).put(feedPath()).set(auth(alice)).send({ token: 'x' }).expect(400);
    await api(app).get(feedPath()).set(auth(carol)).expect(403);
    await api(app).put(feedPath()).set(auth(carol)).send({}).expect(403);
    await api(app).put(feedPath()).set(auth(alice)).send({ includeMemo: false }).expect(200);
  });

  it('피드: text/calendar, 반복 펼침(취소 회차 없음, 옮긴 회차 같은 UID), 종일 배타 끝, 참여자, 기념일, 메모 없음', async () => {
    const { httpsUrl } = (await api(app).get(feedPath()).set(auth(alice)).expect(200)).body.data;
    const res = await raw().get(pathOf(httpsUrl)).expect(200);
    expect(res.headers['content-type']).toBe('text/calendar; charset=utf-8');
    expect(res.headers['cache-control']).toBe('private, max-age=900');
    expect(res.headers.etag).toMatch(/^"[A-Za-z0-9_-]+"$/);
    const body = res.text;
    expect(body).toContain('X-WR-CALNAME:언제볼까 - 우리\\, 팀');
    expect(body).not.toContain('비밀 메모');

    const vcal = new ICAL.Component(ICAL.parse(body));
    const events = vcal.getAllSubcomponents('vevent').map((c) => new ICAL.Event(c));
    const byTitle = (title: string) => events.filter((e) => e.summary === title);
    const meetings = byTitle('주간 회의');
    expect(meetings.map((e) => e.uid.replace(/^e\d+-/, ''))).toEqual(['20270106@whenwemeet.day', '20270127@whenwemeet.day']);
    const moved = byTitle('옮긴 회의');
    expect(moved).toHaveLength(1);
    expect(moved[0].uid).toMatch(/^e\d+-20270120@whenwemeet\.day$/);
    expect(moved[0].startDate.toJSDate()).toEqual(new Date('2027-01-21T15:00:00+09:00'));
    expect(events.some((e) => e.uid.endsWith('-20270113@whenwemeet.day'))).toBe(false);

    const [trip] = byTitle('제주 여행');
    expect(trip.startDate.isDate).toBe(true);
    expect(trip.startDate.toString()).toBe('2027-01-15');
    expect(trip.endDate.toString()).toBe('2027-01-18');

    const [dinner] = byTitle('토요일 저녁');
    expect(dinner.description).toBe('참여: 앨리스, 밥');
    expect(dinner.startDate.toJSDate()).toEqual(new Date('2027-01-09T19:00:00+09:00'));
    expect(dinner.component.getFirstPropertyValue('url')).toMatch(/^http:\/\/localhost:3000\/events\/[a-z0-9]{8}\?team=[a-z0-9]{8}$/);

    // 2026-10-01 시작 COUNT_UP: 100일 = 2027-01-08
    const [hundred] = byTitle('팀 창립 100일');
    expect(hundred.startDate.toString()).toBe('2027-01-08');

    const row = await prisma.calendarFeed.findUniqueOrThrow({ where: { userId_groupId: { userId: alice.userId, groupId } } });
    expect(row.lastFetchedAt).not.toBeNull();
  });

  it('메모 토글을 켜면 메모가 나가고, 기념일을 끄면 기념일이 빠진다', async () => {
    const { httpsUrl } = (await api(app).put(feedPath()).set(auth(alice)).send({ includeMemo: true, includeAnniversaries: false }).expect(200)).body.data;
    const body = (await raw().get(pathOf(httpsUrl)).expect(200)).text;
    expect(body).toContain('비밀 메모');
    expect(body).not.toContain('팀 창립');
    await api(app).put(feedPath()).set(auth(alice)).send({ includeMemo: false, includeAnniversaries: true }).expect(200);
  });

  it('ETag 가 같으면 304 (본문 없음), 일정이 바뀌면 새 ETag', async () => {
    const { httpsUrl } = (await api(app).get(feedPath()).set(auth(alice)).expect(200)).body.data;
    const first = await raw().get(pathOf(httpsUrl)).expect(200);
    const second = await raw().get(pathOf(httpsUrl)).set('If-None-Match', first.headers.etag).expect(304);
    expect(second.text ?? '').toBe('');
    await api(app)
      .post(`/v1/groups/${groupId}/events`)
      .set(auth(bob))
      .send({ title: '새 약속', startsAt: '2027-02-01T12:00:00+09:00', endsAt: '2027-02-01T13:00:00+09:00', allDay: false })
      .expect(201);
    const third = await raw().get(pathOf(httpsUrl)).set('If-None-Match', first.headers.etag).expect(200);
    expect(third.headers.etag).not.toBe(first.headers.etag);
    expect(third.text).toContain('SUMMARY:새 약속');
  });

  it('없는 토큰, 형식이 틀린 토큰은 본문 없는 404', async () => {
    const missing = await raw().get(`/v1/ics/${'A'.repeat(43)}.ics`).expect(404);
    expect(missing.text ?? '').toBe('');
    expect(missing.headers['content-type']).toBeUndefined();
    await raw().get('/v1/ics/short.ics').expect(404);
    await raw().get('/v1/ics/whatever').expect(404);
  });

  it('재발급하면 새 주소가 되고 이전 주소는 즉시 404. 다른 멤버의 주소는 그대로', async () => {
    const mine = (await api(app).get(feedPath()).set(auth(alice)).expect(200)).body.data;
    const bobs = (await api(app).put(feedPath()).set(auth(bob)).send({}).expect(200)).body.data;
    expect(bobs.httpsUrl).not.toBe(mine.httpsUrl);
    const rotated = (await api(app).post(`${feedPath()}/rotate`).set(auth(alice)).expect(200)).body.data;
    expect(rotated.httpsUrl).not.toBe(mine.httpsUrl);
    expect(rotated).toMatchObject({ includeMemo: false, includeAnniversaries: true });
    await raw().get(pathOf(mine.httpsUrl)).expect(404);
    await raw().get(pathOf(rotated.httpsUrl)).expect(200);
    await raw().get(pathOf(bobs.httpsUrl)).expect(200);
    // 주소가 없는 사람의 재발급은 404
    const solo = await devLogin(app, '솔로');
    const personal = (await api(app).get('/v1/groups').set(auth(solo)).expect(200)).body.data[0];
    await api(app).post(`${feedPath(personal.id)}/rotate`).set(auth(solo)).expect(404);
  });

  it('끄면 행이 지워지고 주소는 404. 다시 만들면 새 주소', async () => {
    const before = (await api(app).get(feedPath()).set(auth(alice)).expect(200)).body.data;
    expect((await api(app).delete(feedPath()).set(auth(alice)).expect(200)).body.data).toEqual({ ok: true });
    expect((await api(app).get(feedPath()).set(auth(alice)).expect(200)).body.data).toBeNull();
    await raw().get(pathOf(before.httpsUrl)).expect(404);
    await api(app).delete(feedPath()).set(auth(alice)).expect(200);
    const again = (await api(app).put(feedPath()).set(auth(alice)).send({}).expect(200)).body.data;
    expect(again.httpsUrl).not.toBe(before.httpsUrl);
  });

  it('개인 팀도 만들 수 있다', async () => {
    const personal = (await api(app).get('/v1/groups').set(auth(alice)).expect(200)).body.data.find((g: { type: string }) => g.type === 'PERSONAL');
    const feed = (await api(app).put(feedPath(personal.id)).set(auth(alice)).send({}).expect(200)).body.data;
    const body = (await raw().get(pathOf(feed.httpsUrl)).expect(200)).text;
    expect(body).toContain('BEGIN:VCALENDAR');
  });

  it('팀을 나가면 그 사람 주소는 즉시 404 (행 삭제), 남은 사람 주소는 그대로', async () => {
    const bobs = (await api(app).get(feedPath()).set(auth(bob)).expect(200)).body.data;
    const alices = (await api(app).get(feedPath()).set(auth(alice)).expect(200)).body.data;
    await api(app).delete(`/v1/groups/${groupId}/me`).set(auth(bob)).expect(200);
    await raw().get(pathOf(bobs.httpsUrl)).expect(404);
    expect(await prisma.calendarFeed.count({ where: { userId: bob.userId, groupId } })).toBe(0);
    await raw().get(pathOf(alices.httpsUrl)).expect(200);
  });

  it('멤버십이 없어진 행이 남아 있어도(요청 시점 확인) 404', async () => {
    const team = await api(app).post('/v1/groups').set(auth(carol)).send({ name: '임시' }).expect(201);
    const feed = (await api(app).put(feedPath(team.body.data.id)).set(auth(carol)).send({}).expect(200)).body.data;
    await raw().get(pathOf(feed.httpsUrl)).expect(200);
    // 나가기 트랜잭션을 거치지 않고 멤버십만 지운 상태 (정리 순서와 무관하게 막히는지)
    await prisma.membership.deleteMany({ where: { userId: carol.userId, groupId: team.body.data.id } });
    await raw().get(pathOf(feed.httpsUrl)).expect(404);
  });

  it('탈퇴하면 주소는 404 (Cascade)', async () => {
    const dave = await devLogin(app, '데이브');
    const personal = (await api(app).get('/v1/groups').set(auth(dave)).expect(200)).body.data[0];
    const feed = (await api(app).put(feedPath(personal.id)).set(auth(dave)).send({}).expect(200)).body.data;
    await raw().get(pathOf(feed.httpsUrl)).expect(200);
    await api(app).delete('/v1/me').set(auth(dave)).expect(200);
    await raw().get(pathOf(feed.httpsUrl)).expect(404);
    expect(await prisma.calendarFeed.count({ where: { userId: dave.userId } })).toBe(0);
  });
});

describe('외부 캘린더 구독 요청 제한 (e2e)', () => {
  let app: TestApp;

  beforeEach(async () => {
    app = await createTestApp({ rateLimit: {} });
    await resetDb(app);
  });

  afterEach(async () => {
    await app.close();
  });

  it('주소 하나는 1분 10번. 11번째는 본문 없는 429 + Retry-After. 다른 주소는 따로 센다', async () => {
    const alice = await devLogin(app, '앨리스');
    const personal = (await api(app).get('/v1/groups').set(auth(alice)).expect(200)).body.data[0];
    const feed = (await api(app).put(`/v1/groups/${personal.id}/calendar-feed`).set(auth(alice)).send({}).expect(200)).body.data;
    const path = new URL(feed.httpsUrl).pathname;
    for (let i = 0; i < 10; i++) await request(app.getHttpServer()).get(path).set('X-Real-IP', `198.51.100.${i}`).expect(200);
    const limited = await request(app.getHttpServer()).get(path).set('X-Real-IP', '198.51.100.99').expect(429);
    expect(limited.text ?? '').toBe('');
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    await request(app.getHttpServer()).get(`/v1/ics/${'B'.repeat(43)}.ics`).set('X-Real-IP', '198.51.100.99').expect(404);
  });

  it('IP 하나는 1분 60번 (주소가 달라도)', async () => {
    for (let i = 0; i < 60; i++) {
      await request(app.getHttpServer()).get(`/v1/ics/${String(i).padStart(43, 'C')}.ics`).set('X-Real-IP', '203.0.113.5').expect(404);
    }
    await request(app.getHttpServer()).get(`/v1/ics/${'D'.repeat(43)}.ics`).set('X-Real-IP', '203.0.113.5').expect(429);
    await request(app.getHttpServer()).get(`/v1/ics/${'D'.repeat(43)}.ics`).set('X-Real-IP', '203.0.113.6').expect(404);
  });
});
