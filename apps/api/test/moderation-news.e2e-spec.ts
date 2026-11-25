import { api, auth, createTestApp, devLogin, resetDb, Session, TestApp } from './helpers.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

/**
 * (#515) 새 소식에서 숨긴 일정 빼기 (D-286). 일정 기록(EventLog)과 참석 활동(EVENT_RSVP)이 목록과 안 읽은 수에서 빠지고,
 * 지워진 일정의 기록은 그대로, 숨김을 풀면 돌아온다. 숨긴 팀의 새 소식은 GROUP_HIDDEN
 */
describe('새 소식과 운영 숨김 (e2e, #515)', () => {
  let app: TestApp;
  let admin: Session;
  let alice: Session;
  let bob: Session;
  let groupId: number;
  let adId: number;
  let movieId: number;

  const events = () => `/v1/groups/${groupId}/events`;
  const news = async (who: Session) =>
    (await api(app).get(`/v1/groups/${groupId}/news`).query({ v: '2' }).set(auth(who)).expect(200)).body.data.items as {
      kind: string;
      type?: string;
      action?: string;
      title?: string;
      eventId?: number | null;
      payload?: { eventId?: number };
    }[];
  const unread = async (who: Session) =>
    ((await api(app).get('/v1/groups').set(auth(who)).expect(200)).body.data as { id: number; unreadNewsCount: number }[]).find((g) => g.id === groupId)!.unreadNewsCount;
  const titles = (items: Awaited<ReturnType<typeof news>>) => items.filter((i) => i.kind === 'EVENT').map((i) => `${i.action}:${i.title}`);

  beforeAll(async () => {
    app = await createTestApp();
    await resetDb(app);
    admin = await devLogin(app, '운영자');
    alice = await devLogin(app, '앨리스');
    bob = await devLogin(app, '밥');
    await app.get(PrismaService).user.update({ where: { id: admin.userId }, data: { role: 'admin' } });
    const team = await api(app).post('/v1/groups').set(auth(alice)).send({ name: '모임' }).expect(201);
    groupId = team.body.data.id;
    await api(app).post('/v1/groups/join').set(auth(bob)).send({ code: team.body.data.inviteCode }).expect(200);
    const create = async (title: string) =>
      (await api(app).post(events()).set(auth(alice)).send({ title, startsAt: '2027-05-10T19:00:00+09:00', endsAt: '2027-05-10T21:00:00+09:00', allDay: false, participants: 'ALL' }).expect(201)).body.data.id as number;
    adId = await create('광고 일정');
    movieId = await create('영화');
    const gone = await create('지운 일정');
    await api(app).delete(`${events()}/${gone}`).set(auth(alice)).expect(200);
    await api(app).put(`${events()}/${adId}/rsvp`).set(auth(bob)).send({ status: 'GOING' }).expect(200);
  });

  afterAll(async () => {
    await app.close();
  });

  it('숨기기 전: 밥은 일정 기록 넷, 앨리스는 밥의 참석 활동을 본다', async () => {
    expect(titles(await news(bob)).sort()).toEqual(['CREATED:광고 일정', 'CREATED:영화', 'CREATED:지운 일정', 'DELETED:지운 일정'].sort());
    expect((await news(alice)).filter((i) => i.type === 'EVENT_RSVP').map((i) => i.payload?.eventId)).toEqual([adId]);
    expect(await unread(bob)).toBe(4);
    // 앨리스: 밥 합류 + 밥의 참석
    expect(await unread(alice)).toBe(2);
  });

  it('숨기면 그 일정의 기록과 참석 활동이 목록과 안 읽은 수에서 빠지고, 지운 일정 기록은 남는다', async () => {
    await api(app).post(`/v1/admin/events/${adId}/hide`).set(auth(admin)).send({ reason: '광고' }).expect(200);
    const bobNews = await news(bob);
    expect(titles(bobNews).sort()).toEqual(['CREATED:영화', 'CREATED:지운 일정', 'DELETED:지운 일정'].sort());
    expect(bobNews.some((i) => i.eventId === adId)).toBe(false);
    expect((await news(alice)).some((i) => i.type === 'EVENT_RSVP')).toBe(false);
    expect(await unread(bob)).toBe(3);
    expect(await unread(alice)).toBe(1);
    expect(movieId).toBeGreaterThan(0);
  });

  it('숨김을 풀면 돌아오고, 숨긴 팀의 새 소식은 GROUP_HIDDEN', async () => {
    await api(app).post(`/v1/admin/events/${adId}/unhide`).set(auth(admin)).expect(200);
    expect(titles(await news(bob))).toContain('CREATED:광고 일정');
    expect(await unread(alice)).toBe(2);

    await api(app).post(`/v1/admin/groups/${groupId}/hide`).set(auth(admin)).send({ reason: '팀 숨김' }).expect(200);
    const blocked = await api(app).get(`/v1/groups/${groupId}/news`).query({ v: '2' }).set(auth(bob)).expect(403);
    expect(blocked.body.error.code).toBe('GROUP_HIDDEN');
    await api(app).post(`/v1/groups/${groupId}/news/seen`).set(auth(bob)).expect(403);
    expect(await unread(bob)).toBe(0);
  });
});
