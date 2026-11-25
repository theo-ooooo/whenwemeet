import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { PushPlanningRepository } from '../src/push/push-planning.repository.js';
import { PushRecipientsRepository } from '../src/push/push-recipients.repository.js';
import { api, auth, createTestApp, devLogin, resetDb, Session, TestApp } from './helpers.js';

/**
 * (#515) 관리자 팀, 일정 숨김과 삭제 (api.md 2.16, D-286).
 * 숨긴 일정은 멤버가 읽는 곳(목록, 상세, 검색, 빈 시간, 구독 피드, 공유 링크, 알림 예약과 펼치기)에서 없는 것과 같고,
 * 숨긴 팀은 팀 경로가 403 GROUP_HIDDEN(사유), 팀 목록에는 hidden 으로 보이고, 초대 코드가 막히고, 나가기는 된다
 */
describe('관리자 숨김, 삭제 (e2e, #515)', () => {
  let app: TestApp;
  let prisma: PrismaService;
  let admin: Session;
  let alice: Session;
  let bob: Session;
  let groupId: number;
  let inviteCode: string;
  let dinnerId: number;
  let movieId: number;
  let seriesId: number;
  let feedToken: string;
  let shareToken: string;

  const events = (gid = groupId) => `/v1/groups/${gid}/events`;
  const list = async (who: Session) =>
    (await api(app).get(events()).query({ from: '2027-03-01T00:00:00+09:00', to: '2027-04-01T00:00:00+09:00' }).set(auth(who)).expect(200)).body.data as { id: number; title: string }[];
  const feed = () => request(app.getHttpServer()).get(`/v1/ics/${feedToken}.ics`);

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    await resetDb(app);
    admin = await devLogin(app, '운영자');
    alice = await devLogin(app, '앨리스');
    bob = await devLogin(app, '밥');
    await prisma.user.update({ where: { id: admin.userId }, data: { role: 'admin' } });
    const team = await api(app).post('/v1/groups').set(auth(alice)).send({ name: '저녁 모임' }).expect(201);
    groupId = team.body.data.id;
    inviteCode = team.body.data.inviteCode;
    await api(app).post('/v1/groups/join').set(auth(bob)).send({ code: inviteCode }).expect(200);
    const create = async (body: Record<string, unknown>) => (await api(app).post(events()).set(auth(alice)).send({ allDay: false, ...body }).expect(201)).body.data.id as number;
    dinnerId = await create({ title: '광고 저녁', startsAt: '2027-03-10T19:00:00+09:00', endsAt: '2027-03-10T21:00:00+09:00', memo: '비밀 메모', reminder: 'HOUR_1' });
    movieId = await create({ title: '영화', startsAt: '2027-03-12T19:00:00+09:00', endsAt: '2027-03-12T21:00:00+09:00' });
    seriesId = await create({ title: '광고 주간 회의', startsAt: '2027-03-02T10:00:00+09:00', endsAt: '2027-03-02T11:00:00+09:00', repeat: 'WEEKLY', reminder: 'MIN_10' });
    const created = (await api(app).put(`/v1/groups/${groupId}/calendar-feed`).set(auth(alice)).send({}).expect(200)).body.data as { httpsUrl: string };
    feedToken = /\/v1\/ics\/([A-Za-z0-9_-]{43})\.ics$/.exec(created.httpsUrl)![1];
    shareToken = (await api(app).post(`${events()}/${dinnerId}/share`).set(auth(alice)).send({}).expect(201)).body.data.token as string;
  });

  afterAll(async () => {
    await app.close();
  });

  it('관리자만: 일반 사용자는 모든 팀, 일정 관리 경로가 403', async () => {
    for (const [method, path] of [
      ['get', '/v1/admin/groups'],
      ['get', `/v1/admin/groups/${groupId}`],
      ['post', `/v1/admin/groups/${groupId}/hide`],
      ['delete', `/v1/admin/groups/${groupId}`],
      ['get', '/v1/admin/events'],
      ['post', `/v1/admin/events/${dinnerId}/hide`],
      ['delete', `/v1/admin/events/${dinnerId}`],
      ['get', `/v1/admin/users/${alice.userId}`],
    ] as const) {
      const res = await api(app)[method](path).set(auth(alice)).send({ reason: 'x' }).expect(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    }
  });

  it('목록과 상세: 팀 검색, 일정 검색과 팀 필터, 목록엔 메모가 없고 상세에만', async () => {
    const groups = await api(app).get('/v1/admin/groups').query({ q: '저녁' }).set(auth(admin)).expect(200);
    expect(groups.body.data.items).toHaveLength(1);
    expect(groups.body.data.items[0]).toMatchObject({ id: groupId, name: '저녁 모임', type: 'TEAM', memberCount: 2, eventCount: 3, hidden: null });
    const all = await api(app).get('/v1/admin/groups').query({ limit: 1 }).set(auth(admin)).expect(200);
    expect(all.body.data.nextCursor).not.toBeNull();

    const detail = await api(app).get(`/v1/admin/groups/${groupId}`).set(auth(admin)).expect(200);
    expect(detail.body.data.members.map((m: { nickname: string }) => m.nickname)).toEqual(['앨리스', '밥']);
    expect(detail.body.data.recentEvents.map((e: { id: number }) => e.id)).toEqual([movieId, dinnerId, seriesId]);

    const found = await api(app).get('/v1/admin/events').query({ q: '광고', groupId: String(groupId) }).set(auth(admin)).expect(200);
    expect(found.body.data.items.map((e: { id: number }) => e.id)).toEqual([seriesId, dinnerId]);
    expect(found.body.data.items[1]).not.toHaveProperty('memo');
    expect(found.body.data.items[1]).toMatchObject({ group: { id: groupId, name: '저녁 모임' }, creator: { id: alice.userId, nickname: '앨리스' }, hidden: null });
    await api(app).get('/v1/admin/events').query({ groupId: 'x' }).set(auth(admin)).expect(400);
    const event = await api(app).get(`/v1/admin/events/${dinnerId}`).set(auth(admin)).expect(200);
    expect(event.body.data.memo).toBe('비밀 메모');

    const user = await api(app).get(`/v1/admin/users/${bob.userId}`).set(auth(admin)).expect(200);
    expect(user.body.data.user).toMatchObject({ id: bob.userId, nickname: '밥' });
    expect(user.body.data.teams.map((t: { name: string }) => t.name)).toEqual(['내 달력', '저녁 모임']);
  });

  it('(#528) 팀 목록 종류 필터와 개인 달력 주인: type=TEAM|PERSONAL, q 는 주인 닉네임도, 팀은 멤버 3명까지 미리 보기', async () => {
    type Row = { id: number; name: string; type: string; owner: { id: number; nickname: string; profileImageUrl: string | null } | null; memberPreview: { nickname: string }[] };
    const list = async (query: Record<string, string>) => (await api(app).get('/v1/admin/groups').query(query).set(auth(admin)).expect(200)).body.data.items as Row[];

    const teams = await list({ type: 'TEAM' });
    expect(teams.map((g) => g.id)).toEqual([groupId]);
    expect(teams[0]).toMatchObject({ owner: null, memberPreview: [{ nickname: '앨리스' }, { nickname: '밥' }] });

    const personal = await list({ type: 'PERSONAL' });
    expect(personal.every((g) => g.type === 'PERSONAL' && g.name === '내 달력')).toBe(true);
    expect(personal.map((g) => g.owner?.nickname).sort((a, b) => (a ?? '').localeCompare(b ?? ''))).toEqual(['밥', '앨리스', '운영자'].sort((a, b) => a.localeCompare(b)));
    expect(personal.find((g) => g.owner?.id === alice.userId)?.memberPreview.map((m) => m.nickname)).toEqual(['앨리스']);
    expect(await list({})).toHaveLength(teams.length + personal.length);

    // 이름이 모두 "내 달력" 이라 개인 달력은 주인 닉네임으로 찾는다. 팀은 멤버 이름으로 찾지 않는다
    const byOwner = await list({ q: '앨리스' });
    expect(byOwner.map((g) => [g.type, g.owner?.nickname])).toEqual([['PERSONAL', '앨리스']]);
    expect((await list({ q: '앨리스', type: 'TEAM' })).length).toBe(0);
    await api(app).get('/v1/admin/groups').query({ type: 'team' }).set(auth(admin)).expect(400);

    const bobPersonal = personal.find((g) => g.owner?.id === bob.userId)!;
    const detail = await api(app).get(`/v1/admin/groups/${bobPersonal.id}`).set(auth(admin)).expect(200);
    expect(detail.body.data.owner).toMatchObject({ id: bob.userId, nickname: '밥' });
    const user = await api(app).get(`/v1/admin/users/${bob.userId}`).set(auth(admin)).expect(200);
    expect(user.body.data.teams.map((t: Row) => [t.type, t.owner?.nickname ?? null])).toEqual([
      ['PERSONAL', '밥'],
      ['TEAM', null],
    ]);

    // 일정 목록의 팀 칸: 개인 달력이면 주인
    const own = (await api(app).post(`/v1/groups/${bobPersonal.id}/events`).set(auth(bob)).send({ title: '밥 개인 일정', allDay: false, startsAt: '2027-03-20T10:00:00+09:00', endsAt: '2027-03-20T11:00:00+09:00' }).expect(201)).body.data.id as number;
    const events = await api(app).get('/v1/admin/events').query({ q: '밥 개인' }).set(auth(admin)).expect(200);
    expect(events.body.data.items[0]).toMatchObject({ id: own, group: { id: bobPersonal.id, type: 'PERSONAL', owner: { id: bob.userId, nickname: '밥' } } });
    const teamEvent = await api(app).get(`/v1/admin/events/${dinnerId}`).set(auth(admin)).expect(200);
    expect(teamEvent.body.data.group).toMatchObject({ type: 'TEAM', owner: null });
    await api(app).delete(`/v1/groups/${bobPersonal.id}/events/${own}`).set(auth(bob)).expect(200);
  });

  it('일정 숨기기: 사유 필수, 멤버 목록, 상세, 검색, 빈 시간, 구독 피드, 공유 링크, 알림에서 빠진다. 해제하면 돌아온다', async () => {
    await api(app).post(`/v1/admin/events/${dinnerId}/hide`).set(auth(admin)).send({ reason: '  ' }).expect(400);
    await api(app).post(`/v1/admin/events/${dinnerId}/hide`).set(auth(admin)).send({}).expect(400);
    await api(app).post('/v1/admin/events/999999/hide').set(auth(admin)).send({ reason: '스팸' }).expect(404);

    const beforeFeed = await feed().expect(200);
    expect(beforeFeed.text).toContain('광고 저녁');
    const hidden = await api(app).post(`/v1/admin/events/${dinnerId}/hide`).set(auth(admin)).send({ reason: '광고 스팸' }).expect(200);
    expect(hidden.body.data.hidden).toMatchObject({ reason: '광고 스팸', hiddenBy: { id: admin.userId, nickname: '운영자' } });
    await api(app).post(`/v1/admin/events/${seriesId}/hide`).set(auth(admin)).send({ reason: '광고 스팸' }).expect(200);

    expect((await list(bob)).map((e) => e.title)).toEqual(['영화']);
    await api(app).get(`${events()}/${dinnerId}`).set(auth(alice)).expect(404);
    await api(app).patch(`${events()}/${dinnerId}`).set(auth(alice)).send({ title: '바꿔치기' }).expect(404);
    const search = await api(app).get('/v1/events/search').query({ q: '광고' }).set(auth(alice)).expect(200);
    expect(search.body.data.items).toEqual([]);
    const free = await api(app)
      .get(`/v1/groups/${groupId}/free-slots`)
      .query({ from: '2027-03-10T18:00:00+09:00', to: '2027-03-10T22:00:00+09:00', dayStart: '18:00', dayEnd: '22:00', minMinutes: 60 })
      .set(auth(alice))
      .expect(200);
    expect(free.body.data.slots).toHaveLength(1);

    const afterFeed = await feed().expect(200);
    expect(afterFeed.text).not.toContain('광고 저녁');
    expect(afterFeed.text).not.toContain('광고 주간 회의');
    expect(afterFeed.text).toContain('영화');
    await api(app).get(`/v1/event-shares/${shareToken}`).expect(404);

    // 알림: 예약 계산과 펼치기 모두 숨긴 일정을 없는 것으로 본다
    const planning = app.get(PushPlanningRepository);
    const once = await planning.listOnceReminders(new Date('2027-03-01T00:00:00Z'), new Date('2027-04-01T00:00:00Z'));
    expect(once.map((row) => row.id)).toEqual([]);
    const series = await planning.listReminderSeries(new Date('2027-03-01T00:00:00Z'), new Date('2027-03-20T00:00:00Z'), '2027-03-01', '2027-03-20');
    expect(series.map((row) => row.id)).toEqual([]);
    const recipients = app.get(PushRecipientsRepository);
    expect(await recipients.eventExists(dinnerId)).toBe(false);
    expect(await recipients.listRecipients(groupId, 'REMINDER', null, dinnerId)).toEqual([]);

    // 해제
    await api(app).post(`/v1/admin/events/${dinnerId}/unhide`).set(auth(admin)).expect(200);
    await api(app).post(`/v1/admin/events/${seriesId}/unhide`).set(auth(admin)).expect(200);
    expect((await list(bob)).map((e) => e.title)).toContain('광고 저녁');
    expect(await recipients.eventExists(dinnerId)).toBe(true);
    expect((await planning.listOnceReminders(new Date('2027-03-01T00:00:00Z'), new Date('2027-04-01T00:00:00Z'))).map((row) => row.id)).toEqual([dinnerId]);
    await api(app).get(`/v1/event-shares/${shareToken}`).expect(200);
  });

  it('팀 숨기기: 팀 경로 403 GROUP_HIDDEN(사유), 팀 목록에는 hidden, 초대 막힘, 피드 404, 알림 그룹 없음, 나가기는 된다', async () => {
    await api(app).post(`/v1/admin/groups/${groupId}/hide`).set(auth(admin)).send({ reason: '불법 광고 팀' }).expect(200);

    const blocked = await api(app).get(events()).query({ from: '2027-03-01T00:00:00+09:00', to: '2027-04-01T00:00:00+09:00' }).set(auth(bob)).expect(403);
    expect(blocked.body.error).toEqual({ code: 'GROUP_HIDDEN', details: { reason: '불법 광고 팀' } });
    expect(blocked.body.message).toBe('운영 정책 위반으로 이용이 제한된 팀이에요');
    await api(app).get(`/v1/groups/${groupId}`).set(auth(bob)).expect(403);
    await api(app).get(`/v1/groups/${groupId}/news`).set(auth(bob)).expect(403);

    const groups = await api(app).get('/v1/groups').set(auth(bob)).expect(200);
    const summary = groups.body.data.find((g: { id: number }) => g.id === groupId);
    expect(summary).toMatchObject({ hidden: { reason: '불법 광고 팀' }, unreadNewsCount: 0 });
    expect(groups.body.data.find((g: { type: string }) => g.type === 'PERSONAL').hidden).toBeNull();

    await api(app).get(`/v1/invites/${inviteCode}`).expect(404);
    const carol = await devLogin(app, '캐럴');
    await api(app).post('/v1/groups/join').set(auth(carol)).send({ code: inviteCode }).expect(404);
    await feed().expect(404);
    expect(await app.get(PushRecipientsRepository).findGroupRef(groupId)).toBeNull();
    const search = await api(app).get('/v1/events/search').query({ q: '영화' }).set(auth(alice)).expect(200);
    expect(search.body.data.items).toEqual([]);

    // 숨김을 풀면 그대로 돌아온다
    await api(app).post(`/v1/admin/groups/${groupId}/unhide`).set(auth(admin)).expect(200);
    await api(app).get(`/v1/groups/${groupId}`).set(auth(bob)).expect(200);
    await api(app).get(`/v1/invites/${inviteCode}`).expect(200);

    // 숨긴 팀에서도 나갈 수는 있다
    await api(app).post(`/v1/admin/groups/${groupId}/hide`).set(auth(admin)).send({ reason: '다시 숨김' }).expect(200);
    await api(app).delete(`/v1/groups/${groupId}/me`).set(auth(bob)).expect(200);
    await api(app).post(`/v1/admin/groups/${groupId}/unhide`).set(auth(admin)).expect(200);
  });

  it('삭제: 일정은 기록 없이 지워지고, 팀은 모든 멤버에게서 지워진다. 처음 여는 달력은 LAST 로', async () => {
    await api(app).delete(`/v1/admin/events/${movieId}`).set(auth(admin)).expect(200);
    await api(app).delete(`/v1/admin/events/${movieId}`).set(auth(admin)).expect(404);
    expect(await prisma.eventLog.count({ where: { title: '영화', action: 'DELETED' } })).toBe(0);
    expect((await list(alice)).map((e) => e.title)).not.toContain('영화');

    await api(app).patch('/v1/me/start-calendar').set(auth(alice)).send({ mode: 'GROUP', groupId }).expect(200);
    await api(app).delete(`/v1/admin/groups/${groupId}`).set(auth(admin)).expect(200);
    await api(app).delete(`/v1/admin/groups/${groupId}`).set(auth(admin)).expect(404);
    expect(await prisma.group.count({ where: { id: groupId } })).toBe(0);
    expect(await prisma.event.count({ where: { groupId } })).toBe(0);
    const me = await api(app).get('/v1/me').set(auth(alice)).expect(200);
    expect(me.body.data.startCalendar).toEqual({ mode: 'LAST', groupId: null });
    await api(app).get(`/v1/groups/${groupId}`).set(auth(alice)).expect(403);
  });

  it('조치 기록: 숨김, 해제, 삭제가 모두 남는다 (삭제는 이름을 reason 에)', async () => {
    const logs = await api(app).get('/v1/admin/logs').query({ limit: 50 }).set(auth(admin)).expect(200);
    const rows = logs.body.data.items as { action: string; targetType: string; targetId: number; reason: string | null }[];
    expect(rows[0]).toMatchObject({ action: 'group_delete', targetType: 'group', targetId: groupId, reason: '저녁 모임' });
    expect(rows.find((r) => r.action === 'event_delete')).toMatchObject({ targetId: movieId, reason: '영화' });
    expect(rows.filter((r) => r.action === 'event_hide').map((r) => r.reason)).toEqual(['광고 스팸', '광고 스팸']);
    expect(rows.filter((r) => r.action === 'group_hide')).toHaveLength(2);
    expect(rows.filter((r) => r.action === 'group_unhide')).toHaveLength(2);
    expect(rows.filter((r) => r.action === 'event_unhide')).toHaveLength(2);
  });
});
