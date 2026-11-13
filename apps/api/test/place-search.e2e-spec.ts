import ICAL from 'ical.js';
import request from 'supertest';
import { kstDate } from '../src/events/recurrence.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { api, auth, createTestApp, devLogin, resetDb, type Session, type TestApp } from './helpers.js';

/**
 * (#199) 일정 장소, 일정 검색, 장소 검색 프록시 e2e (D-242 ~ D-248). 실제 MySQL.
 * - 장소: 직접 적은 글자 / 고른 장소(카카오 ID + 검색어), 수정 생략 = 그대로, null = 지우기, 반복 "이 일정만" 예외, 다시 찾기(resolve)
 * - 검색: 내 팀만, groupId 비멤버 403, 와일드카드 글자 그대로, 한 글자, 반복 한 줄 + 예외 회차 따로, 취소 회차 제외, 정렬, hasMore
 * - 프록시: 로그인 필요, 가짜 공급자, 검색어 검사, 사용자당 분당 60회
 * - 구독 피드: LOCATION, GEO
 */
const kst = (date: string, time: string) => new Date(`${date}T${time}+09:00`).toISOString();
/** 고른 장소: 카카오 ID + 고를 때 적은 검색어만 (카카오가 준 이름, 주소, 좌표는 저장 금지, D-242) */
const PICKED = { query: '카페', kakaoPlaceId: '27531028' };

describe('일정 장소 (e2e)', () => {
  let app: TestApp;
  let alice: Session;
  let team: number;
  const events = () => `/v1/groups/${team}/events`;
  const body = (title: string, date: string, extra: Record<string, unknown> = {}) => ({
    title,
    startsAt: kst(date, '10:00:00'),
    endsAt: kst(date, '11:00:00'),
    allDay: false,
    ...extra,
  });
  const create = async (input: Record<string, unknown>) => (await api(app).post(events()).set(auth(alice)).send(input).expect(201)).body.data;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await resetDb(app);
    await app.close();
  });

  beforeEach(async () => {
    await resetDb(app);
    alice = await devLogin(app, '앨리스');
    team = (await api(app).post('/v1/groups').set(auth(alice)).send({ name: '저녁 모임' }).expect(201)).body.data.id;
  });

  it('고른 장소: ID 와 검색어만 저장(DB 열 셋), url 은 카카오 ID 로 만든다. 단건, 목록, 공개 코드 조회 모두 place', async () => {
    const created = await create(body('커피', '2027-03-10', { place: { ...PICKED, query: ' 카페 ' } }));
    expect(created.place).toEqual({ ...PICKED, text: null, url: 'https://place.map.kakao.com/27531028' });
    const row = await app.get(PrismaService).event.findUniqueOrThrow({ where: { id: created.id } });
    expect(Object.keys(row).filter((k) => k.startsWith('place')).sort()).toEqual(['placeId', 'placeQuery', 'placeText']);
    const one = (await api(app).get(`${events()}/${created.id}`).set(auth(alice)).expect(200)).body.data;
    expect(one.place).toEqual(created.place);
    const byCode = (await api(app).get(`/v1/events/${created.publicCode}`).set(auth(alice)).expect(200)).body.data;
    expect(byCode.place.kakaoPlaceId).toBe('27531028');
    const list = (await api(app).get(events()).set(auth(alice)).query({ from: kst('2027-03-01', '00:00:00'), to: kst('2027-03-31', '00:00:00') }).expect(200)).body.data;
    expect(list[0].place.kakaoPlaceId).toBe('27531028');
  });

  it('직접 적은 장소는 글자만 (지도 없음). 생략 = 없음(null)', async () => {
    const free = await create(body('모임', '2027-03-10', { place: { text: '할머니 댁' } }));
    expect(free.place).toEqual({ text: '할머니 댁', query: null, kakaoPlaceId: null, url: null });
    const none = await create(body('없음', '2027-03-10'));
    expect(none.place).toBeNull();
  });

  it('수정: 생략은 그대로, 다른 장소로 바꾸기, null 은 지우기. 같은 장소면 저장 안 함(로그 없음)', async () => {
    const created = await create(body('커피', '2027-03-10', { place: PICKED }));
    const prisma = app.get(PrismaService);
    const kept = (await api(app).patch(`${events()}/${created.id}`).set(auth(alice)).send({ title: '커피 두 잔' }).expect(200)).body.data;
    expect(kept.place.kakaoPlaceId).toBe(PICKED.kakaoPlaceId);
    const logs = await prisma.eventLog.count();
    await api(app).patch(`${events()}/${created.id}`).set(auth(alice)).send({ place: PICKED }).expect(200);
    expect(await prisma.eventLog.count()).toBe(logs);
    const moved = (await api(app).patch(`${events()}/${created.id}`).set(auth(alice)).send({ place: { text: '서울숲' } }).expect(200)).body.data;
    expect(moved.place).toMatchObject({ text: '서울숲', kakaoPlaceId: null });
    expect(await prisma.eventLog.count()).toBe(logs + 1);
    const cleared = (await api(app).patch(`${events()}/${created.id}`).set(auth(alice)).send({ place: null }).expect(200)).body.data;
    expect(cleared.place).toBeNull();
  });

  it.each([
    [{ text: '' }, '장소 이름을 입력해 주세요'],
    [{ text: '가'.repeat(101) }, '장소는 100자 이하여야 해요'],
    [{ kakaoPlaceId: '1' }, '고른 장소는 검색어(query)와 함께 보내야 해요'],
    [{ kakaoPlaceId: 'abc', query: '카페' }, '카카오 장소 ID 가 올바르지 않아요'],
    [{ ...PICKED, name: '카페 온화', lat: 37.5, lng: 127 }, '장소에 알 수 없는 값이 있어요'],
    [{ text: '집', url: 'https://evil.example' }, '장소에 알 수 없는 값이 있어요'],
    ['카페', '장소 형식이 올바르지 않아요'],
  ])('형식 오류 400: %j', async (place, message) => {
    const res = await api(app).post(events()).set(auth(alice)).send(body('x', '2027-03-10', { place })).expect(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(res.body.message).toBe(message);
  });

  it('반복: "이 일정만" 장소 예외(그 회차만), 지우기는 그 회차만 없음, 원본과 같게 되돌리면 예외 행 삭제. "이후 모두" 는 새 원본으로', async () => {
    const series = await create(body('주간 커피', '2027-03-03', { repeat: 'WEEKLY', place: PICKED }));
    const at = (occurrence: string) => api(app).get(`${events()}/${series.id}`).query({ occurrence }).set(auth(alice)).expect(200);
    const patch = (occurrence: string, scope: string, payload: Record<string, unknown>) =>
      api(app).patch(`${events()}/${series.id}`).query({ occurrence, scope }).set(auth(alice)).send(payload).expect(200);

    await patch('2027-03-10', 'this', { place: { text: '서울숲' } });
    expect((await at('2027-03-10')).body.data.place.text).toBe('서울숲');
    expect((await at('2027-03-17')).body.data.place.kakaoPlaceId).toBe(PICKED.kakaoPlaceId);

    await patch('2027-03-17', 'this', { place: null });
    expect((await at('2027-03-17')).body.data.place).toBeNull();
    const prisma = app.get(PrismaService);
    expect((await prisma.eventException.findFirst({ where: { eventId: series.id, occurrence: new Date('2027-03-17T00:00:00Z') } }))?.placeText).toBe('');

    await patch('2027-03-10', 'this', { place: PICKED });
    expect(await prisma.eventException.count({ where: { eventId: series.id, occurrence: new Date('2027-03-10T00:00:00Z') } })).toBe(0);

    const split = (await patch('2027-03-24', 'following', { place: { text: '을지로' } })).body.data;
    expect(split.id).not.toBe(series.id);
    expect(split.place.text).toBe('을지로');
    expect((await at('2027-03-03')).body.data.place.kakaoPlaceId).toBe(PICKED.kakaoPlaceId);
  });
});

describe('일정 검색 (e2e)', () => {
  let app: TestApp;
  let alice: Session;
  let bob: Session;
  let home: number;
  let work: number;
  let bobOnly: number;
  const eventsOf = (groupId: number) => `/v1/groups/${groupId}/events`;
  const add = async (who: Session, groupId: number, input: Record<string, unknown>) =>
    (await api(app).post(eventsOf(groupId)).set(auth(who)).send({ allDay: false, ...input }).expect(201)).body.data;
  const search = (who: Session, query: Record<string, string>) => api(app).get('/v1/events/search').set(auth(who)).query(query);

  beforeAll(async () => {
    app = await createTestApp();
    await resetDb(app);
    alice = await devLogin(app, '앨리스');
    bob = await devLogin(app, '밥');
    const homeRes = await api(app).post('/v1/groups').set(auth(alice)).send({ name: '우리 집' }).expect(201);
    home = homeRes.body.data.id;
    work = (await api(app).post('/v1/groups').set(auth(alice)).send({ name: '회사' }).expect(201)).body.data.id;
    bobOnly = (await api(app).post('/v1/groups').set(auth(bob)).send({ name: '밥의 팀' }).expect(201)).body.data.id;
    await api(app).post('/v1/groups/join').set(auth(bob)).send({ code: homeRes.body.data.inviteCode }).expect(200);

    await add(alice, home, { title: '치과 예약', startsAt: kst('2027-02-01', '10:00:00'), endsAt: kst('2027-02-01', '11:00:00'), memo: '스케일링' });
    await add(alice, home, { title: '지난 치과', startsAt: kst('2025-05-01', '10:00:00'), endsAt: kst('2025-05-01', '11:00:00') });
    await add(alice, home, { title: '저녁', startsAt: kst('2027-01-10', '19:00:00'), endsAt: kst('2027-01-10', '21:00:00'), place: { ...PICKED, query: '성수 카페' } });
    await add(alice, work, { title: '분기 회의', startsAt: kst('2027-01-05', '10:00:00'), endsAt: kst('2027-01-05', '11:00:00'), memo: '할인율 50% 확인' });
    await add(alice, work, { title: '100_200 정산', startsAt: kst('2027-01-06', '10:00:00'), endsAt: kst('2027-01-06', '11:00:00') });
    await add(bob, bobOnly, { title: '밥 치과', startsAt: kst('2027-01-07', '10:00:00'), endsAt: kst('2027-01-07', '11:00:00') });
    // 매주 수요일 요가 (2026-01-07 부터 계속). 한 회차는 제목을 바꾸고, 한 회차는 취소
    const yoga = await add(alice, home, { title: '요가', startsAt: kst('2026-01-07', '07:00:00'), endsAt: kst('2026-01-07', '08:00:00'), repeat: 'WEEKLY' });
    await api(app).patch(`${eventsOf(home)}/${yoga.id}`).query({ occurrence: '2027-03-03', scope: 'this' }).set(auth(alice)).send({ title: '요가 특강', memo: '강사 초대' }).expect(200);
    await api(app).delete(`${eventsOf(home)}/${yoga.id}`).query({ occurrence: '2027-03-10', scope: 'this' }).set(auth(alice)).expect(200);
    // 끝난 반복: 2025년 매월 필라테스
    await add(alice, home, { title: '필라테스', startsAt: kst('2025-01-15', '20:00:00'), endsAt: kst('2025-01-15', '21:00:00'), repeat: 'MONTHLY', repeatUntil: '2025-06-30' });
    // 원본은 안 맞고 예외만 맞는 반복
    const run = await add(alice, work, { title: '아침 달리기', startsAt: kst('2026-12-01', '06:00:00'), endsAt: kst('2026-12-01', '07:00:00'), repeat: 'WEEKLY' });
    await api(app).patch(`${eventsOf(work)}/${run.id}`).query({ occurrence: '2026-12-15', scope: 'this' }).set(auth(alice)).send({ place: { text: '한강 반포지구' } }).expect(200);
  });

  afterAll(async () => {
    await resetDb(app);
    await app.close();
  });

  it('지금 팀만: 다가오는 일정(시작 오름차순) 먼저, 지난 일정(최근 순) 다음. 팀 이름, 일치 필드', async () => {
    const res = (await search(alice, { q: '치과', groupId: String(home) }).expect(200)).body.data;
    expect(res.hasMore).toBe(false);
    expect(res.items.map((item: { event: { title: string } }) => item.event.title)).toEqual(['치과 예약', '지난 치과']);
    expect(res.items[0]).toMatchObject({ group: { id: home, name: '우리 집' }, matched: ['title'], upcoming: true });
    expect(typeof res.items[0].group.publicCode).toBe('string');
    expect(res.items[1].upcoming).toBe(false);
  });

  it('모든 팀: 내 팀 전부, 남의 팀 일정은 안 나온다. 비멤버 groupId 는 403', async () => {
    const all = (await search(alice, { q: '치과' }).expect(200)).body.data;
    expect(all.items.map((item: { event: { title: string } }) => item.event.title)).toEqual(['치과 예약', '지난 치과']);
    const bobs = (await search(bob, { q: '치과' }).expect(200)).body.data;
    expect(bobs.items.map((item: { event: { title: string } }) => item.event.title)).toEqual(['밥 치과', '치과 예약', '지난 치과']);
    const forbidden = await search(alice, { q: '치과', groupId: String(bobOnly) }).expect(403);
    expect(forbidden.body.error.code).toBe('FORBIDDEN');
  });

  it('메모, 장소(사용자 글자, 고를 때 검색어)로 찾는다. 카카오 이름, 주소는 저장하지 않아 못 찾는다', async () => {
    expect((await search(alice, { q: '스케일링' }).expect(200)).body.data.items[0]).toMatchObject({ matched: ['memo'] });
    const byPlace = (await search(alice, { q: '성수 카페' }).expect(200)).body.data.items;
    expect(byPlace).toHaveLength(1);
    expect(byPlace[0]).toMatchObject({ event: { title: '저녁', place: { query: '성수 카페' } }, matched: ['place'] });
    expect((await search(alice, { q: '연무장길' }).expect(200)).body.data.items).toHaveLength(0);
  });

  it('%, _ 는 글자 그대로. 한 글자 검색', async () => {
    expect((await search(alice, { q: '%' }).expect(200)).body.data.items.map((i: { event: { title: string } }) => i.event.title)).toEqual(['분기 회의']);
    expect((await search(alice, { q: '_' }).expect(200)).body.data.items.map((i: { event: { title: string } }) => i.event.title)).toEqual(['100_200 정산']);
    expect((await search(alice, { q: '저' }).expect(200)).body.data.items.map((i: { event: { title: string } }) => i.event.title)).toEqual(['저녁']);
  });

  it('반복: 원본이 맞으면 한 줄(다음 회차), 예외가 맞는 회차는 따로 한 줄. 취소 회차는 대표로 쓰지 않는다', async () => {
    const items = (await search(alice, { q: '요가' }).expect(200)).body.data.items as { event: { title: string; occurrence: string; repeat: string }; upcoming: boolean }[];
    expect(items).toHaveLength(2);
    const next = items.find((item) => item.event.title === '요가');
    const special = items.find((item) => item.event.title === '요가 특강');
    expect(next?.event.repeat).toBe('WEEKLY');
    const today = kstDate(new Date());
    expect(next!.event.occurrence >= today).toBe(true);
    expect(next!.upcoming).toBe(true);
    expect(special?.event.occurrence).toBe('2027-03-03');
    // 예외 회차의 메모로도 찾는다 (원본은 안 맞음)
    const byMemo = (await search(alice, { q: '강사' }).expect(200)).body.data.items;
    expect(byMemo.map((i: { event: { occurrence: string } }) => i.event.occurrence)).toEqual(['2027-03-03']);
  });

  it('끝난 반복은 마지막 회차, 원본은 안 맞고 예외 장소만 맞으면 그 회차만', async () => {
    const pilates = (await search(alice, { q: '필라테스' }).expect(200)).body.data.items;
    expect(pilates).toHaveLength(1);
    expect(pilates[0]).toMatchObject({ upcoming: false, event: { occurrence: '2025-06-15' } });
    const run = (await search(alice, { q: '반포' }).expect(200)).body.data.items;
    expect(run).toHaveLength(1);
    expect(run[0]).toMatchObject({ matched: ['place'], event: { title: '아침 달리기', occurrence: '2026-12-15', place: { text: '한강 반포지구' } } });
  });

  it('limit 를 넘으면 hasMore', async () => {
    const res = (await search(alice, { q: '치과', limit: '1' }).expect(200)).body.data;
    expect(res.items).toHaveLength(1);
    expect(res.hasMore).toBe(true);
  });

  it.each([
    [{ q: '' }, 'q'],
    [{ q: '   ' }, 'q'],
    [{ q: '가'.repeat(51) }, 'q'],
    [{ q: '치과', limit: '51' }, 'limit'],
    [{ q: '치과', limit: 'x' }, 'limit'],
    [{ q: '치과', groupId: 'abc' }, 'groupId'],
  ])('검증 400: %j', async (query, field) => {
    const res = await search(alice, query).expect(400);
    expect(res.body.error.details[0].field).toBe(field);
  });

  it('로그인 없으면 401', async () => {
    await api(app).get('/v1/events/search').query({ q: '치과' }).expect(401);
  });
});

describe('장소 검색 프록시 (e2e)', () => {
  let app: TestApp;

  beforeEach(async () => {
    app = await createTestApp({ rateLimit: {} });
    await resetDb(app);
  });

  afterEach(async () => {
    await app.close();
  });

  it('로그인 필요. 가짜 공급자 결과, 검색어 검사', async () => {
    await api(app).get('/v1/places/search').query({ q: '카페' }).expect(401);
    const alice = await devLogin(app, '앨리스');
    const res = (await api(app).get('/v1/places/search').query({ q: '카페' }).set(auth(alice)).expect(200)).body.data;
    expect(res.items[0]).toEqual({ kakaoPlaceId: '27531028', name: '카페 온화 성수점', address: '서울 성동구 연무장길 12', lat: 37.5428, lng: 127.0565, category: '카페' });
    const bad = await api(app).get('/v1/places/search').query({ q: ' ' }).set(auth(alice)).expect(400);
    expect(bad.body.error.details[0].field).toBe('q');
  });

  it('다시 찾기: ID 가 같은 결과, 없으면 null. 로그인 필요, 형식 400', async () => {
    await api(app).get('/v1/places/resolve').query({ id: '8209184', q: '서울숲' }).expect(401);
    const alice = await devLogin(app, '앨리스');
    const hit = (await api(app).get('/v1/places/resolve').query({ id: '8209184', q: '서울숲' }).set(auth(alice)).expect(200)).body.data;
    expect(hit.place).toMatchObject({ kakaoPlaceId: '8209184', name: '서울숲', lat: 37.5444 });
    expect((await api(app).get('/v1/places/resolve').query({ id: '1', q: '서울숲' }).set(auth(alice)).expect(200)).body.data.place).toBeNull();
    expect((await api(app).get('/v1/places/resolve').query({ id: 'x', q: '서울숲' }).set(auth(alice)).expect(400)).body.error.details[0].field).toBe('id');
  });

  it('사용자당 분당 60회. 61번째는 429, 다른 사용자는 따로', async () => {
    const alice = await devLogin(app, '앨리스');
    const bob = await devLogin(app, '밥');
    for (let i = 0; i < 60; i++) await request(app.getHttpServer()).get('/v1/places/search').query({ q: '숲' }).set(auth(alice)).expect(200);
    const limited = await api(app).get('/v1/places/search').query({ q: '숲' }).set(auth(alice)).expect(429);
    expect(limited.body.error.code).toBe('RATE_LIMITED');
    await api(app).get('/v1/places/search').query({ q: '숲' }).set(auth(bob)).expect(200);
  });
});

describe('구독 피드 장소 (e2e)', () => {
  let app: TestApp;

  beforeAll(async () => {
    app = await createTestApp();
    await resetDb(app);
  });

  afterAll(async () => {
    await resetDb(app);
    await app.close();
  });

  it('고른 장소는 피드를 만들 때 다시 찾아 LOCATION "이름, 주소" + GEO, 못 찾으면 검색어. 직접 적은 장소는 글자만', async () => {
    const alice = await devLogin(app, '앨리스');
    const personal = (await api(app).get('/v1/groups').set(auth(alice)).expect(200)).body.data[0];
    const events = `/v1/groups/${personal.id}/events`;
    await api(app).post(events).set(auth(alice)).send({ title: '커피', startsAt: kst('2027-01-09', '10:00:00'), endsAt: kst('2027-01-09', '11:00:00'), allDay: false, place: PICKED }).expect(201);
    await api(app).post(events).set(auth(alice)).send({ title: '집들이', startsAt: kst('2027-01-10', '10:00:00'), endsAt: kst('2027-01-10', '11:00:00'), allDay: false, place: { text: '민지네' } }).expect(201);
    await api(app).post(events).set(auth(alice)).send({ title: '사라진 곳', startsAt: kst('2027-01-11', '10:00:00'), endsAt: kst('2027-01-11', '11:00:00'), allDay: false, place: { kakaoPlaceId: '1', query: '카페' } }).expect(201);
    const feed = (await api(app).put(`/v1/groups/${personal.id}/calendar-feed`).set(auth(alice)).send({}).expect(200)).body.data;
    const res = await request(app.getHttpServer()).get(new URL(feed.httpsUrl).pathname).expect(200);
    const vevents = new ICAL.Component(ICAL.parse(res.text)).getAllSubcomponents('vevent');
    const coffee = vevents.find((c) => c.getFirstPropertyValue('summary') === '커피')!;
    expect(coffee.getFirstPropertyValue('location')).toBe('카페 온화 성수점, 서울 성동구 연무장길 12');
    expect(res.text).toContain('GEO:37.542800;127.056500');
    const party = vevents.find((c) => c.getFirstPropertyValue('summary') === '집들이')!;
    expect(party.getFirstPropertyValue('location')).toBe('민지네');
    expect(party.getFirstPropertyValue('geo')).toBeNull();
    const gone = vevents.find((c) => c.getFirstPropertyValue('summary') === '사라진 곳')!;
    expect(gone.getFirstPropertyValue('location')).toBe('카페');
    expect(gone.getFirstPropertyValue('geo')).toBeNull();
  });
});
