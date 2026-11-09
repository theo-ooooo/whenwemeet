import { PrismaService } from '../src/prisma/prisma.service.js';
import { api, auth, createTestApp, devLogin, resetDb, Session, TestApp } from './helpers.js';

/**
 * 일정 단건 접근 범위 (#17, api.md 2.3):
 * - 팀 멤버가 아니면 403 FORBIDDEN
 * - 멤버이지만 eventId 가 다른 팀 소속이면 404 NOT_FOUND (존재 여부 비노출). GET/PATCH/DELETE 동일
 */
describe('일정 단건 접근 범위 (e2e)', () => {
  let app: TestApp;
  let alice: Session;
  let bob: Session;
  let carol: Session;
  let teamId: string;
  let bobPersonalId: string;
  let eventId: string;
  const patch = { title: '바뀌면 안 되는 제목' };

  beforeAll(async () => {
    app = await createTestApp();
    await resetDb(app);
    alice = await devLogin(app, '앨리스');
    bob = await devLogin(app, '밥');
    carol = await devLogin(app, '캐롤');

    const team = await api(app).post('/v1/groups').set(auth(alice)).send({ name: '팀 A' }).expect(201);
    teamId = team.body.data.id;
    await api(app).post('/v1/groups/join').set(auth(bob)).send({ code: team.body.data.inviteCode }).expect(200);

    const created = await api(app)
      .post(`/v1/groups/${teamId}/events`)
      .set(auth(alice))
      .send({ title: '팀 A 일정', startsAt: '2026-12-01T10:00:00.000Z', endsAt: '2026-12-01T12:00:00.000Z', allDay: false })
      .expect(201);
    eventId = created.body.data.id;

    const prisma = app.get(PrismaService);
    const personal = await prisma.group.findFirstOrThrow({ where: { type: 'PERSONAL', memberships: { some: { userId: bob.userId } } } });
    bobPersonalId = personal.id;
  });

  afterAll(async () => {
    await resetDb(app);
    await app.close();
  });

  it('멤버가 아니면 GET/PATCH/DELETE 모두 403 FORBIDDEN', async () => {
    const get = await api(app).get(`/v1/groups/${teamId}/events/${eventId}`).set(auth(carol)).expect(403);
    expect(get.body.error.code).toBe('FORBIDDEN');
    const upd = await api(app).patch(`/v1/groups/${teamId}/events/${eventId}`).set(auth(carol)).send(patch).expect(403);
    expect(upd.body.error.code).toBe('FORBIDDEN');
    const del = await api(app).delete(`/v1/groups/${teamId}/events/${eventId}`).set(auth(carol)).expect(403);
    expect(del.body.error.code).toBe('FORBIDDEN');
  });

  it('멤버이지만 eventId 가 다른 팀 소속이면 GET/PATCH/DELETE 모두 404 NOT_FOUND', async () => {
    // 밥은 팀 A 멤버이자 자기 개인 팀 멤버. 개인 팀 경로로 팀 A 의 일정 ID 를 가리킨다
    const get = await api(app).get(`/v1/groups/${bobPersonalId}/events/${eventId}`).set(auth(bob)).expect(404);
    expect(get.body.error).toEqual({ code: 'NOT_FOUND', message: expect.any(String) });
    const upd = await api(app).patch(`/v1/groups/${bobPersonalId}/events/${eventId}`).set(auth(bob)).send(patch).expect(404);
    expect(upd.body.error.code).toBe('NOT_FOUND');
    const del = await api(app).delete(`/v1/groups/${bobPersonalId}/events/${eventId}`).set(auth(bob)).expect(404);
    expect(del.body.error.code).toBe('NOT_FOUND');
  });

  it('없는 eventId 와 같은 응답이라 존재 여부를 구분할 수 없다', async () => {
    const cross = await api(app).get(`/v1/groups/${bobPersonalId}/events/${eventId}`).set(auth(bob)).expect(404);
    const missing = await api(app).get(`/v1/groups/${bobPersonalId}/events/clxxxxxxxxxxxxxxxxxxxxxxx`).set(auth(bob)).expect(404);
    expect(cross.body).toEqual(missing.body);
  });

  it('위 요청들로 일정이 바뀌거나 지워지지 않았고 로그도 남지 않는다', async () => {
    const one = await api(app).get(`/v1/groups/${teamId}/events/${eventId}`).set(auth(bob)).expect(200);
    expect(one.body.data.title).toBe('팀 A 일정');

    const prisma = app.get(PrismaService);
    expect(await prisma.eventLog.count({ where: { eventId } })).toBe(1); // CREATED 하나뿐
  });
});
