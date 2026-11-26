import { PrismaService } from '../src/prisma/prisma.service.js';
import { api, auth, createTestApp, devLogin, resetDb, Session, TestApp } from './helpers.js';

/** 처음 여는 달력 (#300, D-191, D-192): 조회, 변경, 권한, 나가기/탈퇴/팀 삭제 시 되돌림 */
describe('처음 여는 달력 (e2e)', () => {
  let app: TestApp;
  let prisma: PrismaService;
  let alice: Session;
  let bob: Session;
  let personalId: number;

  const LAST = { mode: 'LAST', groupId: null };

  async function startCalendarOf(session: Session) {
    return (await api(app).get('/v1/me').set(auth(session)).expect(200)).body.data.startCalendar;
  }

  async function createTeam(owner: Session, name: string, ...others: Session[]): Promise<number> {
    const res = await api(app).post('/v1/groups').set(auth(owner)).send({ name }).expect(201);
    for (const other of others) {
      await api(app).post('/v1/groups/join').set(auth(other)).send({ code: res.body.data.inviteCode }).expect(200);
    }
    return res.body.data.id as number;
  }

  function pin(session: Session, groupId: number) {
    return api(app).patch('/v1/me/start-calendar').set(auth(session)).send({ mode: 'GROUP', groupId }).expect(200);
  }

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    await resetDb(app);
    alice = await devLogin(app, '앨리스');
    bob = await devLogin(app, '밥');
    const groups = (await api(app).get('/v1/groups').set(auth(alice)).expect(200)).body.data as { id: number; type: string }[];
    personalId = groups.find((g) => g.type === 'PERSONAL')!.id;
  });

  afterAll(async () => {
    await resetDb(app);
    await app.close();
  });

  it('가입 직후 GET /me 는 LAST, 다른 필드는 그대로', async () => {
    const me = (await api(app).get('/v1/me').set(auth(alice)).expect(200)).body.data;
    expect(Object.keys(me).sort()).toEqual(['assistant', 'birthday', 'createdAt', 'hasUnreadNotice', 'id', 'isAdmin', 'nickname', 'profileImageUrl', 'role', 'showLunar', 'startCalendar']);
    expect(me.startCalendar).toEqual(LAST);
  });

  it('PERSONAL, LAST 로 바꾸면 같은 모양을 돌려주고 GET /me 에 남는다', async () => {
    const res = await api(app).patch('/v1/me/start-calendar').set(auth(alice)).send({ mode: 'PERSONAL' }).expect(200);
    expect(res.body.data).toEqual({ mode: 'PERSONAL', groupId: null });
    expect(await startCalendarOf(alice)).toEqual({ mode: 'PERSONAL', groupId: null });

    await api(app).patch('/v1/me/start-calendar').set(auth(alice)).send({ mode: 'LAST', groupId: null }).expect(200);
    expect(await startCalendarOf(alice)).toEqual(LAST);
  });

  it('GROUP 은 내 팀이면 저장한다', async () => {
    const teamId = await createTeam(alice, '고정 팀');
    expect((await pin(alice, teamId)).body.data).toEqual({ mode: 'GROUP', groupId: teamId });
    expect(await startCalendarOf(alice)).toEqual({ mode: 'GROUP', groupId: teamId });
  });

  it('검증: 짝이 틀리면 400, 내 팀이 아니면 403, 개인 팀은 400, 없는 값은 400, 인증 없으면 401', async () => {
    const bobTeam = await createTeam(bob, '밥 팀');
    const before = await startCalendarOf(alice);
    const patch = (body: object) => api(app).patch('/v1/me/start-calendar').set(auth(alice)).send(body);

    for (const body of [{ mode: 'GROUP' }, { mode: 'GROUP', groupId: null }, { mode: 'LAST', groupId: bobTeam }, { mode: 'PERSONAL', groupId: personalId }]) {
      const res = await patch(body).expect(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
      expect(res.body.error.details[0].field).toBe('groupId');
    }
    for (const body of [{}, { mode: 'TEAM' }, { mode: 'GROUP', groupId: 'x' }, { mode: 'GROUP', groupId: 0 }, { mode: 'LAST', extra: 1 }]) {
      expect((await patch(body).expect(400)).body.error.code).toBe('VALIDATION_FAILED');
    }
    expect((await patch({ mode: 'GROUP', groupId: bobTeam }).expect(403)).body.error.code).toBe('FORBIDDEN');
    expect((await patch({ mode: 'GROUP', groupId: 999999 }).expect(403)).body.error.code).toBe('FORBIDDEN');
    const personal = await patch({ mode: 'GROUP', groupId: personalId }).expect(400);
    expect(personal.body.error.details).toEqual([{ field: 'groupId', message: '내 달력은 "내 달력" 으로 골라 주세요' }]);
    await api(app).patch('/v1/me/start-calendar').send({ mode: 'LAST' }).expect(401);

    expect(await startCalendarOf(alice)).toEqual(before);
  });

  it('고정한 팀에서 나가면 LAST 로 돌아가고, 다른 팀을 고정한 사람과 남은 멤버는 그대로', async () => {
    const shared = await createTeam(alice, '같이', bob);
    const other = await createTeam(bob, '밥 다른 팀');
    await pin(alice, shared);
    await pin(bob, other);

    await api(app).delete(`/v1/groups/${shared}/me`).set(auth(alice)).expect(200);
    expect(await startCalendarOf(alice)).toEqual(LAST);
    expect(await startCalendarOf(bob)).toEqual({ mode: 'GROUP', groupId: other });
  });

  it('남은 멤버가 고정한 팀은 다른 멤버가 나가도 그대로', async () => {
    const shared = await createTeam(alice, '둘이', bob);
    await pin(bob, shared);
    await api(app).delete(`/v1/groups/${shared}/me`).set(auth(alice)).expect(200);
    expect(await startCalendarOf(bob)).toEqual({ mode: 'GROUP', groupId: shared });
  });

  it('마지막 멤버가 나가 팀이 지워지면 LAST', async () => {
    const solo = await createTeam(alice, '혼자 팀');
    await pin(alice, solo);
    const res = await api(app).delete(`/v1/groups/${solo}/me`).set(auth(alice)).expect(200);
    expect(res.body.data).toEqual({ groupDeleted: true });
    expect(await startCalendarOf(alice)).toEqual(LAST);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: alice.userId }, select: { startCalendarMode: true, startGroupId: true } });
    expect(row).toEqual({ startCalendarMode: 'LAST', startGroupId: null });
  });

  it('고정한 팀의 다른 멤버가 탈퇴해 팀이 남아도 내 설정은 그대로, 내가 탈퇴하면 팀이 지워지고 사용자 행도 사라진다', async () => {
    const carol = await devLogin(app, '캐럴');
    const shared = await createTeam(carol, '캐럴과 밥', bob);
    await pin(bob, shared);
    await pin(carol, shared);

    await api(app).delete('/v1/me').set(auth(carol)).expect(200);
    expect(await startCalendarOf(bob)).toEqual({ mode: 'GROUP', groupId: shared });

    await api(app).delete('/v1/me').set(auth(bob)).expect(200);
    expect(await prisma.group.findUnique({ where: { id: shared } })).toBeNull();
    expect(await prisma.user.findUnique({ where: { id: bob.userId } })).toBeNull();
  });

  it('팀이 FK SetNull 로만 지워져 GROUP 에 팀이 없는 행도 GET /me 는 LAST 로 읽는다', async () => {
    const team = await createTeam(alice, '지워질 팀');
    await pin(alice, team);
    await prisma.group.delete({ where: { id: team } });
    const row = await prisma.user.findUniqueOrThrow({ where: { id: alice.userId }, select: { startCalendarMode: true, startGroupId: true } });
    expect(row).toEqual({ startCalendarMode: 'GROUP', startGroupId: null });
    expect(await startCalendarOf(alice)).toEqual(LAST);
  });
});
