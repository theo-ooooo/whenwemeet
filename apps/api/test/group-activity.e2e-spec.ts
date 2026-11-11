import { PrismaService } from '../src/prisma/prisma.service.js';
import { api, auth, createTestApp, devLogin, resetDb, Session, TestApp } from './helpers.js';

/**
 * (#191) 새 소식 확장: 기념일 변경, 멤버 합류와 나가기, 탈퇴, 팀 이름 변경이 팀 활동 기록으로 남고
 * `GET /news?v=2` 에서 일정 기록과 섞여 보인다. v 가 없으면 예전 응답 그대로
 */
describe('새 소식 확장 (e2e, #191)', () => {
  let app: TestApp;
  let prisma: PrismaService;
  let alice: Session;
  let bob: Session;
  let carol: Session;
  let groupId: number;
  let inviteCode: string;

  const news = async (who: Session, v2 = true) => {
    const req = api(app).get(`/v1/groups/${groupId}/news`).set(auth(who));
    const res = await (v2 ? req.query({ v: '2' }) : req).expect(200);
    return res.body.data.items as Record<string, unknown>[];
  };
  const activities = async () => prisma.groupActivity.findMany({ where: { groupId }, orderBy: { id: 'asc' } });
  const badge = async (who: Session) => {
    const res = await api(app).get('/v1/groups').set(auth(who)).expect(200);
    return (res.body.data as { id: number; unreadNewsCount: number }[]).find((g) => g.id === groupId)!.unreadNewsCount;
  };

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    await resetDb(app);
    alice = await devLogin(app, '앨리스');
    bob = await devLogin(app, '밥');
    carol = await devLogin(app, '캐롤');
    const team = await api(app).post('/v1/groups').set(auth(alice)).send({ name: '우리집' }).expect(201);
    groupId = team.body.data.id;
    inviteCode = team.body.data.inviteCode;
  });

  afterAll(async () => {
    await resetDb(app);
    await app.close();
  });

  it('합류는 새 멤버일 때만 한 줄 (멱등 재호출은 기록 없음), 내 합류는 나에게 안 보인다', async () => {
    await api(app).post('/v1/groups/join').set(auth(bob)).send({ code: inviteCode }).expect(200);
    await api(app).post('/v1/groups/join').set(auth(bob)).send({ code: inviteCode }).expect(200);
    expect((await activities()).map((row) => row.type)).toEqual(['MEMBER_JOINED']);

    const forAlice = await news(alice);
    expect(forAlice).toEqual([
      expect.objectContaining({ kind: 'ACTIVITY', type: 'MEMBER_JOINED', actor: expect.objectContaining({ userId: bob.userId, displayName: '밥' }), payload: {}, anniversaryId: null, isNew: true }),
    ]);
    expect(await news(bob)).toEqual([]);
  });

  it('v 가 없으면 예전 응답 그대로 (활동 없이 일정만, kind 없음)', async () => {
    await api(app)
      .post(`/v1/groups/${groupId}/events`)
      .set(auth(bob))
      .send({ title: '저녁', startsAt: '2026-12-10T10:00:00.000Z', endsAt: '2026-12-10T11:00:00.000Z', allDay: false })
      .expect(201);
    const old = await news(alice, false);
    expect(old).toHaveLength(1);
    expect(old[0]).not.toHaveProperty('kind');
    expect(old[0]).toMatchObject({ action: 'CREATED', title: '저녁' });

    const merged = await news(alice);
    expect(merged.map((item) => `${String(item.kind)}:${String(item.type ?? item.action)}`)).toEqual(['EVENT:CREATED', 'ACTIVITY:MEMBER_JOINED']);
  });

  it('unreadNewsCount 는 일정 기록 + 활동 기록, seen 뒤 0', async () => {
    expect(await badge(alice)).toBe(2);
    await api(app).post(`/v1/groups/${groupId}/news/seen`).set(auth(alice)).expect(200);
    expect(await badge(alice)).toBe(0);
  });

  it('기념일 추가, 수정(바뀐 필드만), 같은 값 수정은 기록 없음, 삭제는 삭제 전 값', async () => {
    const created = await api(app).post(`/v1/groups/${groupId}/anniversaries`).set(auth(bob)).send({ name: '처음 만난 날', date: '2024-03-15' }).expect(201);
    const id = created.body.data.id as number;
    await api(app).patch(`/v1/groups/${groupId}/anniversaries/${id}`).set(auth(bob)).send({ date: '2024-03-16' }).expect(200);
    // 같은 값, 알림 시점만 바꾸기는 기록 없음
    await api(app).patch(`/v1/groups/${groupId}/anniversaries/${id}`).set(auth(bob)).send({ name: '처음 만난 날', date: '2024-03-16' }).expect(200);
    await api(app).patch(`/v1/groups/${groupId}/anniversaries/${id}`).set(auth(bob)).send({ reminders: [] }).expect(200);
    await api(app).patch(`/v1/groups/${groupId}/anniversaries/${id}`).set(auth(bob)).send({ name: '첫 만남', kind: 'YEARLY' }).expect(200);

    const items = (await news(alice)).filter((item) => item.kind === 'ACTIVITY' && String(item.type).startsWith('ANNIVERSARY'));
    expect(items).toEqual([
      expect.objectContaining({ type: 'ANNIVERSARY_UPDATED', anniversaryId: id, payload: { name: '첫 만남', date: '2024-03-16', kind: 'YEARLY', changed: ['name', 'kind'], before: { name: '처음 만난 날', kind: 'COUNT_UP' } } }),
      expect.objectContaining({ type: 'ANNIVERSARY_UPDATED', anniversaryId: id, payload: { name: '처음 만난 날', date: '2024-03-16', kind: 'COUNT_UP', changed: ['date'], before: { date: '2024-03-15' } } }),
      expect.objectContaining({ type: 'ANNIVERSARY_CREATED', anniversaryId: id, payload: { name: '처음 만난 날', date: '2024-03-15', kind: 'COUNT_UP' } }),
    ]);

    await api(app).delete(`/v1/groups/${groupId}/anniversaries/${id}`).set(auth(bob)).expect(200);
    const after = (await news(alice)).filter((item) => item.kind === 'ACTIVITY' && String(item.type).startsWith('ANNIVERSARY'));
    expect(after[0]).toMatchObject({ type: 'ANNIVERSARY_DELETED', anniversaryId: null, payload: { name: '첫 만남', date: '2024-03-16', kind: 'YEARLY' } });
    // 기념일이 지워지면 이전 기록의 대상은 비고 기록은 남는다
    expect(after.slice(1).every((item) => item.anniversaryId === null)).toBe(true);
    expect(after).toHaveLength(4);
  });

  it('삭제 직후 같은 값으로 다시 추가(되돌리기)하면 삭제 기록을 지우고 추가 기록도 남기지 않는다', async () => {
    const created = await api(app).post(`/v1/groups/${groupId}/anniversaries`).set(auth(bob)).send({ name: '생일', date: '2000-05-05', kind: 'YEARLY' }).expect(201);
    const before = (await activities()).length;
    await api(app).delete(`/v1/groups/${groupId}/anniversaries/${created.body.data.id}`).set(auth(bob)).expect(200);
    expect((await activities()).length).toBe(before + 1);
    // 다른 사람이 같은 값으로 추가하면 되돌리기가 아니다
    const other = await api(app).post(`/v1/groups/${groupId}/anniversaries`).set(auth(alice)).send({ name: '생일', date: '2000-05-05', kind: 'YEARLY' }).expect(201);
    expect((await activities()).length).toBe(before + 2);
    await api(app).delete(`/v1/groups/${groupId}/anniversaries/${other.body.data.id}`).set(auth(alice)).expect(200);
    const afterOther = (await activities()).length;

    await api(app).post(`/v1/groups/${groupId}/anniversaries`).set(auth(bob)).send({ name: '생일', date: '2000-05-05', kind: 'YEARLY' }).expect(201);
    const rows = await activities();
    expect(rows.length).toBe(afterOther - 1);
    expect(rows.filter((row) => row.actorId === bob.userId && row.type === 'ANNIVERSARY_DELETED' && (row.payload as { name: string }).name === '생일')).toHaveLength(0);
  });

  it('팀 이름은 실제로 바뀔 때만 { from, to }', async () => {
    await api(app).patch(`/v1/groups/${groupId}`).set(auth(bob)).send({ name: '우리집' }).expect(200);
    expect((await activities()).filter((row) => row.type === 'GROUP_RENAMED')).toHaveLength(0);
    await api(app).patch(`/v1/groups/${groupId}`).set(auth(bob)).send({ name: '우리 가족' }).expect(200);
    const [renamed] = await news(alice);
    expect(renamed).toMatchObject({ kind: 'ACTIVITY', type: 'GROUP_RENAMED', payload: { from: '우리집', to: '우리 가족' }, actor: { userId: bob.userId } });
  });

  it('나간 사람은 기록 시점 표시 이름 스냅샷 + 회색으로 남은 멤버에게 보인다', async () => {
    await api(app).post('/v1/groups/join').set(auth(carol)).send({ code: inviteCode }).expect(200);
    await api(app).patch(`/v1/groups/${groupId}/me`).set(auth(carol)).send({ displayName: '캐롤짱' }).expect(200);
    await api(app).delete(`/v1/groups/${groupId}/me`).set(auth(carol)).expect(200);
    const [left] = await news(alice);
    expect(left).toMatchObject({ type: 'MEMBER_LEFT', actor: { userId: carol.userId, displayName: '캐롤짱', color: '#9CA3AF' } });
    // 합류 기록도 지금은 멤버가 아니라 같은 규칙 (스냅샷은 합류 때 닉네임)
    const joined = (await news(alice)).find((item) => item.type === 'MEMBER_JOINED' && (item.actor as { userId: number }).userId === carol.userId);
    expect(joined).toMatchObject({ actor: { displayName: '캐롤', color: '#9CA3AF' } });
  });

  it('탈퇴는 남는 팀마다 스냅샷 이름으로 한 줄, 그 사람의 다른 기록은 "탈퇴한 멤버"', async () => {
    await api(app).delete('/v1/me').set(auth(bob)).expect(200);
    const items = await news(alice);
    expect(items[0]).toMatchObject({ kind: 'ACTIVITY', type: 'MEMBER_DELETED', actor: { userId: null, displayName: '밥', color: '#9CA3AF', profileImageUrl: null } });
    const renamed = items.find((item) => item.type === 'GROUP_RENAMED');
    expect(renamed).toMatchObject({ actor: { userId: null, displayName: '탈퇴한 멤버' } });
    const row = (await activities()).find((r) => r.type === 'MEMBER_DELETED');
    expect(row).toMatchObject({ actorId: null, actorName: '밥' });
  });

  it('마지막 멤버가 나가 팀이 지워지면 기록도 함께 지워진다', async () => {
    await api(app).delete(`/v1/groups/${groupId}/me`).set(auth(alice)).expect(200);
    expect(await prisma.group.findUnique({ where: { id: groupId } })).toBeNull();
    expect(await prisma.groupActivity.count({ where: { groupId } })).toBe(0);
  });
});
