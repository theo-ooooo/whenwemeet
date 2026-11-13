import { PrismaService } from '../src/prisma/prisma.service.js';
import { api, auth, createTestApp, devLogin, resetDb, type Session, type TestApp } from './helpers.js';

/**
 * (#190) 일정 참석 여부와 짧은 반응 e2e (설계 `참석-여부.md` 8장). 실제 MySQL.
 * 팀 = {엄마, 아빠, 삼촌}. 일정은 참여자 [엄마, 아빠] 또는 모두
 */
describe('참석 여부와 반응 (e2e)', () => {
  let app: TestApp;
  let prisma: PrismaService;
  let mom: Session;
  let dad: Session;
  let uncle: Session;
  let team: number;
  let code: string;

  const DAY = '2027-03-10';
  const kst = (time: string, date = DAY) => new Date(`${date}T${time}+09:00`).toISOString();
  const base = () => `/v1/groups/${team}/events`;
  const create = async (session: Session, input: Record<string, unknown>) =>
    (await api(app).post(base()).set(auth(session)).send({ allDay: false, ...input }).expect(201)).body.data as { id: number; publicCode: string };
  const once = (extra: Record<string, unknown> = {}) =>
    create(mom, { title: '저녁 약속', startsAt: kst('18:00:00'), endsAt: kst('20:00:00'), participants: [mom.userId, dad.userId], ...extra });
  /** 매주 수요일 2027-03-10 부터, 모두 */
  const weekly = (extra: Record<string, unknown> = {}) =>
    create(mom, { title: '주간 모임', startsAt: kst('19:00:00'), endsAt: kst('21:00:00'), repeat: 'WEEKLY', participants: 'ALL', ...extra });
  const rsvp = (who: Session, eventId: number, status: unknown, occurrence?: string) =>
    api(app)
      .put(`${base()}/${eventId}/rsvp`)
      .query(occurrence ? { occurrence } : {})
      .set(auth(who))
      .send({ status });
  const react = (who: Session, eventId: number, reaction: unknown, occurrence?: string) =>
    api(app)
      .put(`${base()}/${eventId}/reaction`)
      .query(occurrence ? { occurrence } : {})
      .set(auth(who))
      .send({ reaction });
  const detail = async (who: Session, eventId: number, occurrence?: string) =>
    (await api(app).get(`${base()}/${eventId}`).query(occurrence ? { occurrence } : {}).set(auth(who)).expect(200)).body.data;
  const list = async (who: Session, from = kst('00:00:00'), to = kst('00:00:00', '2027-04-01')) =>
    (await api(app).get(base()).query({ from, to }).set(auth(who)).expect(200)).body.data as Record<string, unknown>[];
  const rsvpActivities = () => prisma.groupActivity.findMany({ where: { groupId: team, type: 'EVENT_RSVP' }, orderBy: { id: 'asc' } });
  const rsvpRows = (eventId: number) => prisma.eventRsvp.findMany({ where: { eventId }, orderBy: [{ occurrence: 'asc' }, { userId: 'asc' }] });
  const day = (value: string) => new Date(`${value}T00:00:00.000Z`);

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
    uncle = await devLogin(app, '삼촌');
    const created = await api(app).post('/v1/groups').set(auth(mom)).send({ name: '우리집' }).expect(201);
    team = created.body.data.id;
    code = created.body.data.inviteCode;
    for (const other of [dad, uncle]) await api(app).post('/v1/groups/join').set(auth(other)).send({ code }).expect(200);
  });

  describe('PUT rsvp (설계 3장)', () => {
    it('참여자는 정하고 바꾸고 취소한다. 같은 값은 저장도 기록도 없다', async () => {
      const event = await once();
      const first = await rsvp(dad, event.id, 'GOING').expect(200);
      expect(first.body.data).toEqual({ going: 1, notGoing: 0, maybe: 0, pending: 1, mine: 'GOING' });
      const savedAt = (await rsvpRows(event.id))[0].updatedAt;

      // 같은 값: 행의 updatedAt 도, 새 소식도 그대로
      await rsvp(dad, event.id, 'GOING').expect(200);
      expect((await rsvpRows(event.id))[0].updatedAt).toEqual(savedAt);
      expect(await rsvpActivities()).toHaveLength(1);

      const changed = await rsvp(dad, event.id, 'NOT_GOING').expect(200);
      expect(changed.body.data).toMatchObject({ going: 0, notGoing: 1, mine: 'NOT_GOING' });
      expect((await rsvp(mom, event.id, 'MAYBE').expect(200)).body.data).toEqual({ going: 0, notGoing: 1, maybe: 1, pending: 0, mine: 'MAYBE' });

      const cancelled = await rsvp(dad, event.id, null).expect(200);
      expect(cancelled.body.data).toEqual({ going: 0, notGoing: 0, maybe: 1, pending: 1, mine: null });
      expect((await rsvpRows(event.id)).map((row) => [row.userId, row.status, row.occurrence])).toEqual([[mom.userId, 'MAYBE', day(DAY)]]);
    });

    it('참여자가 아니면 403 NOT_PARTICIPANT, 팀원이 아니면 403 FORBIDDEN, 형식 오류 400', async () => {
      const event = await once();
      const denied = await rsvp(uncle, event.id, 'GOING').expect(403);
      expect(denied.body.error.code).toBe('NOT_PARTICIPANT');
      expect(denied.body.message).toBe('이 일정의 참여자만 응답할 수 있어요');

      const stranger = await devLogin(app, '이웃');
      expect((await rsvp(stranger, event.id, 'GOING').expect(403)).body.error.code).toBe('FORBIDDEN');

      expect((await rsvp(dad, event.id, 'YES').expect(400)).body.error.details[0].field).toBe('status');
      await api(app).put(`${base()}/${event.id}/rsvp`).set(auth(dad)).send({}).expect(400);
      await api(app).put(`${base()}/${event.id}/rsvp`).set(auth(dad)).send({ status: 'GOING', userId: mom.userId }).expect(400);
      await rsvp(dad, 999999, 'GOING').expect(404);
      expect(await prisma.eventRsvp.count()).toBe(0);
    });

    it('"모두" 일정은 지금 팀원 누구나, 참여자 없음 일정은 아무도 못 한다', async () => {
      const everyone = await once({ participants: 'ALL' });
      await rsvp(uncle, everyone.id, 'GOING').expect(200);
      const nobody = await once({ participants: [uncle.userId] });
      await api(app).delete(`/v1/groups/${team}/me`).set(auth(uncle)).expect(200);
      expect((await rsvp(mom, nobody.id, 'GOING').expect(403)).body.error.code).toBe('NOT_PARTICIPANT');
    });
  });

  describe('PUT reaction', () => {
    it('참여자가 아니어도 팀원이면 하나, 바꾸면 바뀌고 null 은 취소', async () => {
      const event = await once();
      expect((await react(uncle, event.id, 'LIKE').expect(200)).body.data).toEqual({ LIKE: 1, EXCITED: 0, ACK: 0, mine: 'LIKE' });
      expect((await react(dad, event.id, 'LIKE').expect(200)).body.data).toEqual({ LIKE: 2, EXCITED: 0, ACK: 0, mine: 'LIKE' });
      expect((await react(uncle, event.id, 'ACK').expect(200)).body.data).toEqual({ LIKE: 1, EXCITED: 0, ACK: 1, mine: 'ACK' });
      expect((await react(uncle, event.id, null).expect(200)).body.data).toEqual({ LIKE: 1, EXCITED: 0, ACK: 0, mine: null });
      await react(dad, event.id, 'WOW').expect(400);
      // 반응은 새 소식에 남기지 않는다
      expect(await prisma.groupActivity.count({ where: { groupId: team, type: 'EVENT_RSVP' } })).toBe(0);
    });
  });

  describe('응답 모양 (목록 집계, 단건 사람 목록)', () => {
    it('목록은 집계만, 단건은 참여자 가입순 응답과 반응한 사람', async () => {
      const event = await once();
      await rsvp(dad, event.id, 'GOING').expect(200);
      await react(uncle, event.id, 'EXCITED').expect(200);

      const [row] = await list(mom);
      expect(row.rsvp).toEqual({ going: 1, notGoing: 0, maybe: 0, pending: 1, mine: null });
      expect(row.reactions).toEqual({ LIKE: 0, EXCITED: 1, ACK: 0, mine: null });
      expect(row).not.toHaveProperty('rsvpMembers');
      expect(row).not.toHaveProperty('reactionMembers');

      const one = await detail(dad, event.id);
      expect(one.rsvp.mine).toBe('GOING');
      expect(one.rsvpMembers).toEqual([
        { member: expect.objectContaining({ userId: mom.userId, displayName: '엄마' }), status: null, respondedAt: null, stale: false },
        { member: expect.objectContaining({ userId: dad.userId, displayName: '아빠' }), status: 'GOING', respondedAt: expect.any(String), stale: false },
      ]);
      expect(one.reactionMembers).toEqual([{ member: expect.objectContaining({ userId: uncle.userId }), reaction: 'EXCITED' }]);
      // 생성, 수정 응답에도 집계가 붙는다
      const patched = await api(app).patch(`${base()}/${event.id}`).set(auth(mom)).send({ memo: '메모' }).expect(200);
      expect(patched.body.data.rsvp).toMatchObject({ going: 1 });
    });
  });

  describe('반복 일정과 회차 (설계 4장, D-225)', () => {
    it('회차마다 따로: 이번 주 불참이 다음 주에 번지지 않는다. occurrence 없으면 400, 회차가 아니면 404', async () => {
      const series = await weekly();
      await rsvp(dad, series.id, 'GOING').expect(400);
      await rsvp(dad, series.id, 'GOING', '2027-03-11').expect(404);
      await rsvp(dad, series.id, 'NOT_GOING', '2027-03-17').expect(200);
      await react(uncle, series.id, 'ACK', '2027-03-24').expect(200);

      const rows = await list(dad);
      const byDate = (date: string) => rows.find((row) => row.occurrence === date)!;
      expect(byDate('2027-03-10').rsvp).toEqual({ going: 0, notGoing: 0, maybe: 0, pending: 3, mine: null });
      expect(byDate('2027-03-17').rsvp).toEqual({ going: 0, notGoing: 1, maybe: 0, pending: 2, mine: 'NOT_GOING' });
      expect(byDate('2027-03-24').reactions).toMatchObject({ ACK: 1 });
      expect((await detail(dad, series.id, '2027-03-24')).rsvp.mine).toBeNull();
    });

    it('"이 일정만" 시각 변경: 응답은 그대로 붙고 stale, "이 일정만" 삭제: 그 회차 응답이 지워진다', async () => {
      const series = await weekly();
      await rsvp(dad, series.id, 'GOING', '2027-03-17').expect(200);
      await rsvp(dad, series.id, 'MAYBE', '2027-03-24').expect(200);
      await react(uncle, series.id, 'LIKE', '2027-03-24').expect(200);

      await api(app)
        .patch(`${base()}/${series.id}`)
        .query({ scope: 'this', occurrence: '2027-03-17' })
        .set(auth(mom))
        .send({ startsAt: kst('20:00:00', '2027-03-18'), endsAt: kst('22:00:00', '2027-03-18') })
        .expect(200);
      const moved = await detail(dad, series.id, '2027-03-17');
      expect(moved.rsvpMembers.find((row: { member: { userId: number } }) => row.member.userId === dad.userId)).toMatchObject({ status: 'GOING', stale: true });

      await api(app).delete(`${base()}/${series.id}`).query({ scope: 'this', occurrence: '2027-03-24' }).set(auth(mom)).expect(200);
      expect((await rsvpRows(series.id)).map((row) => row.occurrence)).toEqual([day('2027-03-17')]);
      expect(await prisma.eventReaction.count({ where: { eventId: series.id } })).toBe(0);
    });

    it('"이후 모두" 로 나누면 그 회차 이후 응답을 새 원본으로 옮긴다 (제목만 바꿈)', async () => {
      const series = await weekly();
      await rsvp(dad, series.id, 'GOING', '2027-03-10').expect(200);
      await rsvp(dad, series.id, 'NOT_GOING', '2027-03-24').expect(200);
      await react(uncle, series.id, 'LIKE', '2027-03-31').expect(200);

      const split = await api(app).patch(`${base()}/${series.id}`).query({ scope: 'following', occurrence: '2027-03-17' }).set(auth(mom)).send({ title: '새 모임' }).expect(200);
      const nextId = split.body.data.id as number;
      expect(nextId).not.toBe(series.id);
      expect((await rsvpRows(series.id)).map((row) => row.occurrence)).toEqual([day('2027-03-10')]);
      expect((await rsvpRows(nextId)).map((row) => [row.occurrence, row.status])).toEqual([[day('2027-03-24'), 'NOT_GOING']]);
      expect(await prisma.eventReaction.count({ where: { eventId: nextId } })).toBe(1);
      expect((await detail(dad, nextId, '2027-03-24')).rsvp.mine).toBe('NOT_GOING');
    });

    it('"이후 모두" 에서 시작 날짜를 옮기면 맞는 회차가 없어 지운다. 참여자를 줄이면 빠진 사람 응답만 지운다', async () => {
      const series = await weekly();
      await rsvp(dad, series.id, 'GOING', '2027-03-24').expect(200);
      await rsvp(uncle, series.id, 'GOING', '2027-03-31').expect(200);
      await api(app)
        .patch(`${base()}/${series.id}`)
        .query({ scope: 'following', occurrence: '2027-03-17' })
        .set(auth(mom))
        .send({ startsAt: kst('19:00:00', '2027-03-18'), endsAt: kst('21:00:00', '2027-03-18') })
        .expect(200);
      expect(await prisma.eventRsvp.count()).toBe(0);

      const other = await weekly({ title: '두번째' });
      await rsvp(dad, other.id, 'GOING', '2027-03-24').expect(200);
      await rsvp(uncle, other.id, 'MAYBE', '2027-03-24').expect(200);
      // 첫 회차 "이후 모두" 에서 참여자만 바꾸면 회차 날짜가 같아 남고, 빠진 삼촌 것만 지운다
      await api(app)
        .patch(`${base()}/${other.id}`)
        .query({ scope: 'following', occurrence: '2027-03-10' })
        .set(auth(mom))
        .send({ participants: [mom.userId, dad.userId] })
        .expect(200);
      expect((await rsvpRows(other.id)).map((row) => row.userId)).toEqual([dad.userId]);
    });

    it('"이후 모두" 삭제는 그 회차 이후 응답을 지운다', async () => {
      const series = await weekly();
      await rsvp(dad, series.id, 'GOING', '2027-03-10').expect(200);
      await rsvp(dad, series.id, 'GOING', '2027-03-24').expect(200);
      await api(app).delete(`${base()}/${series.id}`).query({ scope: 'following', occurrence: '2027-03-17' }).set(auth(mom)).expect(200);
      expect((await rsvpRows(series.id)).map((row) => row.occurrence)).toEqual([day('2027-03-10')]);
    });
  });

  describe('한 번짜리 일정 변경', () => {
    it('날짜를 옮기면 회차 날짜도 옮기고, 시각이 바뀌었으니 stale. 일정 삭제는 Cascade', async () => {
      const event = await once();
      await rsvp(dad, event.id, 'GOING').expect(200);
      await react(uncle, event.id, 'LIKE').expect(200);
      await api(app).patch(`${base()}/${event.id}`).set(auth(mom)).send({ startsAt: kst('18:00:00', '2027-03-12'), endsAt: kst('20:00:00', '2027-03-12') }).expect(200);
      expect((await rsvpRows(event.id)).map((row) => row.occurrence)).toEqual([day('2027-03-12')]);
      expect(await prisma.eventReaction.findFirstOrThrow({ where: { eventId: event.id } })).toMatchObject({ occurrence: day('2027-03-12') });
      const one = await detail(dad, event.id);
      expect(one.rsvp.mine).toBe('GOING');
      expect(one.rsvpMembers[1]).toMatchObject({ status: 'GOING', stale: true });

      // 같은 시각으로 다시 응답하면 stale 이 풀린다 (값이 같아도 바꾼 다음 다시 고르면 새로 본 시각)
      await rsvp(dad, event.id, 'MAYBE').expect(200);
      expect((await detail(dad, event.id)).rsvpMembers[1]).toMatchObject({ status: 'MAYBE', stale: false });

      await api(app).delete(`${base()}/${event.id}`).set(auth(mom)).expect(200);
      expect(await prisma.eventRsvp.count()).toBe(0);
      expect(await prisma.eventReaction.count()).toBe(0);
    });

    it('참여자에서 빠지면 그 사람 응답을 지운다 (반응은 남는다). 다시 넣어도 복구하지 않는다', async () => {
      const event = await once();
      await rsvp(dad, event.id, 'GOING').expect(200);
      await react(dad, event.id, 'LIKE').expect(200);
      await api(app).patch(`${base()}/${event.id}`).set(auth(mom)).send({ participants: [mom.userId] }).expect(200);
      expect(await rsvpRows(event.id)).toEqual([]);
      expect(await prisma.eventReaction.count({ where: { eventId: event.id } })).toBe(1);
      await api(app).patch(`${base()}/${event.id}`).set(auth(mom)).send({ participants: [mom.userId, dad.userId] }).expect(200);
      expect((await detail(dad, event.id)).rsvp.mine).toBeNull();
    });
  });

  describe('나가기, 탈퇴 (D-139 와 같은 결)', () => {
    it('팀을 나가면 그 팀 일정의 내 응답, 반응을 지운다. 탈퇴는 Cascade', async () => {
      const event = await once({ participants: 'ALL' });
      await rsvp(uncle, event.id, 'GOING').expect(200);
      await react(uncle, event.id, 'LIKE').expect(200);
      await rsvp(dad, event.id, 'MAYBE').expect(200);
      await react(dad, event.id, 'ACK').expect(200);

      await api(app).delete(`/v1/groups/${team}/me`).set(auth(uncle)).expect(200);
      expect(await prisma.eventRsvp.count({ where: { userId: uncle.userId } })).toBe(0);
      expect(await prisma.eventReaction.count({ where: { userId: uncle.userId } })).toBe(0);
      expect((await detail(mom, event.id)).rsvp).toEqual({ going: 0, notGoing: 0, maybe: 1, pending: 1, mine: null });

      await api(app).delete('/v1/me').set(auth(dad)).expect(200);
      expect(await prisma.eventRsvp.count()).toBe(0);
      expect(await prisma.eventReaction.count()).toBe(0);
    });
  });

  describe('새 소식 EVENT_RSVP (D-227)', () => {
    it('정하거나 바꾸면 한 줄, 2분 안 같은 회차는 그 줄을 고친다. 2분 안 취소는 줄을 지운다. 내 기록은 나에게 안 보인다', async () => {
      const event = await once();
      await rsvp(dad, event.id, 'GOING').expect(200);
      await rsvp(dad, event.id, 'NOT_GOING').expect(200);
      const rows = await rsvpActivities();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ actorId: dad.userId, actorName: '아빠' });
      expect(rows[0].payload).toEqual({
        eventId: event.id,
        eventCode: event.publicCode,
        occurrence: null,
        title: '저녁 약속',
        startsAt: kst('18:00:00'),
        endsAt: kst('20:00:00'),
        allDay: false,
        status: 'NOT_GOING',
      });

      const forMom = (await api(app).get(`/v1/groups/${team}/news`).query({ v: '2' }).set(auth(mom)).expect(200)).body.data.items;
      expect(forMom.filter((item: { type?: string }) => item.type === 'EVENT_RSVP')).toEqual([
        expect.objectContaining({ kind: 'ACTIVITY', type: 'EVENT_RSVP', actor: expect.objectContaining({ userId: dad.userId }), payload: expect.objectContaining({ status: 'NOT_GOING' }) }),
      ]);
      const forDad = (await api(app).get(`/v1/groups/${team}/news`).query({ v: '2' }).set(auth(dad)).expect(200)).body.data.items;
      expect(forDad.filter((item: { type?: string }) => item.type === 'EVENT_RSVP')).toEqual([]);
      // 옛 웹(v 없음)에는 활동 기록이 없다
      const v1 = (await api(app).get(`/v1/groups/${team}/news`).set(auth(mom)).expect(200)).body.data.items;
      expect(v1.some((item: { kind?: string }) => item.kind === 'ACTIVITY')).toBe(false);

      // 2분이 지난 기록은 고치지 않고 새 줄
      await prisma.groupActivity.update({ where: { id: rows[0].id }, data: { createdAt: new Date(Date.now() - 3 * 60 * 1000) } });
      await rsvp(dad, event.id, 'MAYBE').expect(200);
      expect((await rsvpActivities()).map((row) => (row.payload as { status: string }).status)).toEqual(['NOT_GOING', 'MAYBE']);

      // 2분 안 취소는 그 줄을 지운다
      await rsvp(dad, event.id, null).expect(200);
      expect((await rsvpActivities()).map((row) => (row.payload as { status: string }).status)).toEqual(['NOT_GOING']);
    });

    it('반복 회차는 회차마다 따로 합친다', async () => {
      const series = await weekly();
      await rsvp(dad, series.id, 'GOING', '2027-03-10').expect(200);
      await rsvp(dad, series.id, 'GOING', '2027-03-17').expect(200);
      await rsvp(dad, series.id, 'NOT_GOING', '2027-03-17').expect(200);
      expect((await rsvpActivities()).map((row) => [(row.payload as { occurrence: string }).occurrence, (row.payload as { status: string }).status])).toEqual([
        ['2027-03-10', 'GOING'],
        ['2027-03-17', 'NOT_GOING'],
      ]);
    });
  });
});
