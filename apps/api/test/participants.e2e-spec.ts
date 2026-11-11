import { PrismaService } from '../src/prisma/prisma.service.js';
import { api, auth, createTestApp, devLogin, resetDb, type Session, type TestApp } from './helpers.js';

/**
 * (#248) 일정 참여자 e2e (설계 8장). 실제 MySQL.
 * 팀 A = {엄마, 아빠, (삼촌)}, 팀 B = {엄마, 이모}. 설계 4장 예시 표를 빈 시간 API 로 확인한다
 */
describe('일정 참여자 (e2e)', () => {
  let app: TestApp;
  let prisma: PrismaService;
  let mom: Session;
  let dad: Session;
  let aunt: Session;
  let uncle: Session;
  let teamA: number;
  let teamB: number;
  let codeA: string;

  const DAY = '2027-03-10';
  const kst = (time: string, date = DAY) => new Date(`${date}T${time}+09:00`).toISOString();
  const body = (title: string, start: string, end: string, extra: Record<string, unknown> = {}) => ({
    title,
    startsAt: kst(start),
    endsAt: kst(end),
    allDay: false,
    ...extra,
  });
  const create = async (session: Session, groupId: number, input: Record<string, unknown>) =>
    (await api(app).post(`/v1/groups/${groupId}/events`).set(auth(session)).send(input).expect(201)).body.data;
  const ids = (view: { participants: { members: { userId: number }[] } }) => view.participants.members.map((member) => member.userId);
  const makeTeam = async (owner: Session, name: string, ...others: Session[]) => {
    const created = await api(app).post('/v1/groups').set(auth(owner)).send({ name }).expect(201);
    for (const other of others) await api(app).post('/v1/groups/join').set(auth(other)).send({ code: created.body.data.inviteCode }).expect(200);
    return { id: created.body.data.id as number, code: created.body.data.inviteCode as string };
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
    mom = await devLogin(app, '엄마');
    dad = await devLogin(app, '아빠');
    aunt = await devLogin(app, '이모');
    uncle = await devLogin(app, '삼촌');
    const a = await makeTeam(mom, '우리집', dad, uncle);
    teamA = a.id;
    codeA = a.code;
    teamB = (await makeTeam(mom, '자매', aunt)).id;
  });

  describe('입력, 저장, 응답 (설계 3-1, 3-2)', () => {
    it('생성: 생략 = [나], ALL = 모두(지금 멤버 전원, 가입순), 배열 = 그 사람들(가입순)', async () => {
      const mine = await create(dad, teamA, body('기본', '10:00:00', '11:00:00'));
      expect(mine.participants).toEqual({ all: false, members: [expect.objectContaining({ userId: dad.userId, displayName: '아빠' })] });
      expect(mine.creator.userId).toBe(dad.userId);

      const everyone = await create(dad, teamA, body('모두', '10:00:00', '11:00:00', { participants: 'ALL' }));
      expect(everyone.participants.all).toBe(true);
      expect(ids(everyone)).toEqual([mom.userId, dad.userId, uncle.userId]);

      const picked = await create(dad, teamA, body('골라', '10:00:00', '11:00:00', { participants: [uncle.userId, mom.userId, mom.userId] }));
      expect(picked.participants.all).toBe(false);
      expect(ids(picked)).toEqual([mom.userId, uncle.userId]);
      expect(picked.participants.members[0]).toEqual({ userId: mom.userId, displayName: '엄마', color: expect.stringMatching(/^#/), profileImageUrl: null });

      // 목록, 단건도 같은 모양
      const list = await api(app).get(`/v1/groups/${teamA}/events`).set(auth(mom)).query({ from: kst('00:00:00'), to: kst('23:59:00') }).expect(200);
      expect(list.body.data.map((e: { title: string; participants: { all: boolean } }) => [e.title, e.participants.all])).toEqual([
        ['기본', false],
        ['모두', true],
        ['골라', false],
      ]);
      const one = await api(app).get(`/v1/groups/${teamA}/events/${picked.id}`).set(auth(mom)).expect(200);
      expect(ids(one.body.data)).toEqual([mom.userId, uncle.userId]);

      // 나중에 합류한 사람도 "모두" 에 들어간다
      await api(app).post('/v1/groups/join').set(auth(aunt)).send({ code: codeA }).expect(200);
      const later = await api(app).get(`/v1/groups/${teamA}/events/${everyone.id}`).set(auth(mom)).expect(200);
      expect(ids(later.body.data)).toEqual([mom.userId, dad.userId, uncle.userId, aunt.userId]);
    });

    it('검증: [], null, 다른 문자열, 숫자 아닌 원소, 멤버 아닌 id → 400 participants', async () => {
      const post = (participants: unknown) => api(app).post(`/v1/groups/${teamA}/events`).set(auth(mom)).send(body('x', '10:00:00', '11:00:00', { participants }));
      const cases: [unknown, string][] = [
        [[], '참여자를 한 명 이상 골라 주세요'],
        [null, "participants 는 'ALL' 또는 멤버 id 배열이어야 해요"],
        ['all', "participants 는 'ALL' 또는 멤버 id 배열이어야 해요"],
        [['1'], "participants 는 'ALL' 또는 멤버 id 배열이어야 해요"],
        [[aunt.userId], '이 팀 멤버만 참여자로 고를 수 있어요'],
        [[mom.userId, 999_999], '이 팀 멤버만 참여자로 고를 수 있어요'],
      ];
      for (const [participants, message] of cases) {
        const res = await post(participants).expect(400);
        expect(res.body.error).toEqual({ code: 'VALIDATION_FAILED', details: [{ field: 'participants', message }] });
      }
      expect(await prisma.event.count()).toBe(0);
      expect(await prisma.eventLog.count()).toBe(0);
    });

    it('수정: 생략은 그대로, 참여자만 바꿔도 UPDATED 로그 + 스냅샷, 같은 값이면 저장 안 함', async () => {
      const event = await create(mom, teamA, body('저녁', '18:00:00', '19:00:00'));
      const patch = (input: Record<string, unknown>) => api(app).patch(`/v1/groups/${teamA}/events/${event.id}`).set(auth(mom)).send(input).expect(200);

      expect(ids((await patch({ title: '저녁 2' })).body.data)).toEqual([mom.userId]);
      const changed = (await patch({ participants: [dad.userId] })).body.data;
      expect(ids(changed)).toEqual([dad.userId]);
      expect((await patch({ participants: [dad.userId] })).body.data.updatedAt).toBe(changed.updatedAt);
      expect((await patch({ participants: 'ALL' })).body.data.participants.all).toBe(true);

      await api(app).delete(`/v1/groups/${teamA}/events/${event.id}`).set(auth(mom)).expect(200);
      const logs = await prisma.eventLog.findMany({ orderBy: { id: 'asc' }, select: { action: true, title: true, participantsAll: true, participantIds: true } });
      expect(logs).toEqual([
        { action: 'CREATED', title: '저녁', participantsAll: false, participantIds: [mom.userId] },
        { action: 'UPDATED', title: '저녁 2', participantsAll: false, participantIds: [mom.userId] },
        { action: 'UPDATED', title: '저녁 2', participantsAll: false, participantIds: [dad.userId] },
        { action: 'UPDATED', title: '저녁 2', participantsAll: true, participantIds: null },
        { action: 'DELETED', title: '저녁 2', participantsAll: null, participantIds: null },
      ]);
    });

    it('반복: this 에 participants 400, this 로그는 원본 참여자, following 그 뒤 회차는 새 원본에 원본 참여자 복사', async () => {
      const series = await create(mom, teamA, body('운동', '07:00:00', '08:00:00', { repeat: 'WEEKLY', participants: [mom.userId, dad.userId] }));
      const url = `/v1/groups/${teamA}/events/${series.id}`;
      const next = '2027-03-17';

      const bad = await api(app).patch(url).query({ scope: 'this', occurrence: next }).set(auth(mom)).send({ participants: [mom.userId] }).expect(400);
      expect(bad.body.error.details).toEqual([{ field: 'participants', message: '이 일정만 수정할 때는 참여자를 바꿀 수 없어요' }]);

      const thisOnly = await api(app).patch(url).query({ scope: 'this', occurrence: next }).set(auth(mom)).send({ title: '이번만' }).expect(200);
      expect(ids(thisOnly.body.data)).toEqual([mom.userId, dad.userId]);

      const split = await api(app).patch(url).query({ scope: 'following', occurrence: '2027-03-24' }).set(auth(mom)).send({ title: '운동 2' }).expect(200);
      expect(split.body.data.id).not.toBe(series.id);
      expect(ids(split.body.data)).toEqual([mom.userId, dad.userId]);
      const splitBody = await api(app).patch(`/v1/groups/${teamA}/events/${split.body.data.id}`).query({ scope: 'following', occurrence: '2027-03-31' }).set(auth(mom)).send({ participants: 'ALL' }).expect(200);
      expect(splitBody.body.data.participants.all).toBe(true);
      // 끊긴 원본들은 그대로
      expect(ids((await api(app).get(url).set(auth(mom)).expect(200)).body.data)).toEqual([mom.userId, dad.userId]);
      expect(await prisma.eventParticipant.count({ where: { eventId: split.body.data.id } })).toBe(2);
      expect(await prisma.eventParticipant.count({ where: { eventId: splitBody.body.data.id } })).toBe(0);

      const logs = await prisma.eventLog.findMany({ where: { action: 'UPDATED' }, orderBy: { id: 'asc' }, select: { scope: true, participantsAll: true, participantIds: true } });
      expect(logs).toEqual([
        { scope: 'THIS', participantsAll: false, participantIds: [mom.userId, dad.userId] },
        { scope: 'FOLLOWING', participantsAll: false, participantIds: [mom.userId, dad.userId] },
        { scope: 'FOLLOWING', participantsAll: true, participantIds: null },
      ]);
    });
  });

  describe('빈 시간은 참여자만 바쁘게 (설계 4장 예시 표)', () => {
    it('A 의 빈 시간: 아빠 일정, A 모두, B 모두, 엄마+이모는 바쁨. 이모만, 참여자 없음은 안 바쁨', async () => {
      await create(mom, teamA, body('아이 병원', '10:00:00', '11:00:00', { participants: [dad.userId] }));
      await create(aunt, teamB, body('이모 미용실', '12:00:00', '13:00:00'));
      await create(aunt, teamB, body('자매 모임', '14:00:00', '15:00:00', { participants: 'ALL' }));
      await create(aunt, teamB, body('엄마 회식', '16:00:00', '17:00:00', { participants: [mom.userId, aunt.userId] }));
      await create(mom, teamA, body('지난 팀원 일정', '18:00:00', '19:00:00', { participants: [uncle.userId] }));
      await api(app).delete(`/v1/groups/${teamA}/me`).set(auth(uncle)).expect(200);

      const res = await api(app)
        .get(`/v1/groups/${teamA}/free-slots`)
        .set(auth(dad))
        .query({ from: kst('00:00:00'), to: kst('23:59:00', DAY), dayStart: '09:00', dayEnd: '21:00', minMinutes: 30 })
        .expect(200);
      expect(res.body.data.memberCount).toBe(2);
      expect(res.body.data.slots.map((s: { startsAt: string; endsAt: string }) => [s.startsAt, s.endsAt])).toEqual([
        [kst('09:00:00'), kst('10:00:00')],
        [kst('11:00:00'), kst('14:00:00')],
        [kst('15:00:00'), kst('16:00:00')],
        [kst('17:00:00'), kst('21:00:00')],
      ]);
    });

    it('반복 원본도 참여자로 거른다 (이모만 참여한 매주 일정은 A 를 막지 않는다)', async () => {
      await create(aunt, teamB, body('이모 수영', '10:00:00', '12:00:00', { repeat: 'WEEKLY' }));
      await create(mom, teamB, body('엄마 수영', '13:00:00', '14:00:00', { repeat: 'WEEKLY' }));
      const res = await api(app)
        .get(`/v1/groups/${teamA}/free-slots`)
        .set(auth(dad))
        .query({ from: kst('00:00:00', '2027-03-17'), to: kst('23:59:00', '2027-03-17'), dayStart: '09:00', dayEnd: '21:00', minMinutes: 30 })
        .expect(200);
      expect(res.body.data.slots.map((s: { startsAt: string }) => s.startsAt)).toEqual([kst('09:00:00', '2027-03-17'), kst('14:00:00', '2027-03-17')]);
    });
  });

  describe('나가기와 탈퇴 (설계 6장, D-139)', () => {
    it('나가면 그 팀 일정의 참여자 행만 지워지고 "참여자 없음" 이 된다. 로그 없음, 다시 합류해도 복구 안 함', async () => {
      const onlyUncle = await create(mom, teamA, body('삼촌만', '10:00:00', '11:00:00', { participants: [uncle.userId] }));
      const withDad = await create(mom, teamA, body('아빠와 삼촌', '10:00:00', '11:00:00', { participants: [dad.userId, uncle.userId] }));
      const everyone = await create(mom, teamA, body('모두', '10:00:00', '11:00:00', { participants: 'ALL' }));
      const uncleTeam = await makeTeam(uncle, '삼촌네', mom);
      const elsewhere = await create(uncle, uncleTeam.id, body('다른 팀', '10:00:00', '11:00:00'));
      const logsBefore = await prisma.eventLog.count();

      await api(app).delete(`/v1/groups/${teamA}/me`).set(auth(uncle)).expect(200);

      const get = async (id: number, groupId = teamA, who = mom) => (await api(app).get(`/v1/groups/${groupId}/events/${id}`).set(auth(who)).expect(200)).body.data;
      expect((await get(onlyUncle.id)).participants).toEqual({ all: false, members: [] });
      expect(ids(await get(withDad.id))).toEqual([dad.userId]);
      expect(ids(await get(everyone.id))).toEqual([mom.userId, dad.userId]);
      expect(ids(await get(elsewhere.id, uncleTeam.id, uncle))).toEqual([uncle.userId]);
      expect(await prisma.eventLog.count()).toBe(logsBefore);

      // 나간 사람 id 로 수정하면 400
      const bad = await api(app).patch(`/v1/groups/${teamA}/events/${withDad.id}`).set(auth(mom)).send({ participants: [uncle.userId] }).expect(400);
      expect(bad.body.error.details).toEqual([{ field: 'participants', message: '이 팀 멤버만 참여자로 고를 수 있어요' }]);
      // 참여자 없음 일정도 다른 필드는 고칠 수 있다
      await api(app).patch(`/v1/groups/${teamA}/events/${onlyUncle.id}`).set(auth(mom)).send({ title: '제목만' }).expect(200);

      await api(app).post('/v1/groups/join').set(auth(uncle)).send({ code: codeA }).expect(200);
      expect((await get(onlyUncle.id)).participants).toEqual({ all: false, members: [] });
    });

    it('탈퇴하면 개인 팀, 다른 팀의 참여자 행이 모두 지워진다', async () => {
      const groups = (await api(app).get('/v1/groups').set(auth(dad)).expect(200)).body.data as { id: number; type: string }[];
      const personal = groups.find((group) => group.type === 'PERSONAL')!;
      await create(dad, personal.id, body('개인', '10:00:00', '11:00:00'));
      const shared = await create(mom, teamA, body('같이', '10:00:00', '11:00:00', { participants: [dad.userId, mom.userId] }));
      expect(await prisma.eventParticipant.count({ where: { userId: dad.userId } })).toBe(2);

      await api(app).delete('/v1/me').set(auth(dad)).expect(200);

      expect(await prisma.eventParticipant.count({ where: { userId: dad.userId } })).toBe(0);
      expect(ids((await api(app).get(`/v1/groups/${teamA}/events/${shared.id}`).set(auth(mom)).expect(200)).body.data)).toEqual([mom.userId]);
    });
  });
});
