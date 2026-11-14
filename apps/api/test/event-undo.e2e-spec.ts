import request from 'supertest';
import { DELETION_RETENTION_MS } from '../src/event-deletions/deletion-snapshot.js';
import { kstDate } from '../src/events/recurrence.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { PushScheduler } from '../src/push/push.scheduler.js';
import { FakeExpo } from './fake-expo.js';
import { api, auth, createTestApp, devLogin, resetDb, type Session, type TestApp } from './helpers.js';

/**
 * (#375) 일정 삭제 되돌리기 e2e (D-251). 실제 MySQL + 가짜 Expo.
 * - 지운 일정은 모든 읽기 경로(목록, 단건, 코드, 검색, 빈 시간, 구독 피드, 공유 링크, 알림 예약, 새 소식)에서 지금처럼 사라진다
 * - 되돌리면 일정 행, 예외, 참여자, 응답, 반응, 공유 링크, 끊긴 연결(기록, 투표)이 지우기 전 모습 그대로 돌아온다
 * - 반복 "이 일정만", "이후 모두"(첫 회차, 그 뒤 회차) 도 그대로
 */
describe('일정 삭제 되돌리기 (e2e)', () => {
  const fake = new FakeExpo();
  let app: TestApp;
  let prisma: PrismaService;
  let scheduler: PushScheduler;
  let minji: Session;
  let jihun: Session;
  let outsider: Session;
  let groupId: number;
  let inviteCode: string;

  const DAY_MS = 86_400_000;
  /** 실제 시각 기준 이틀 뒤 KST 날짜 (알림 시각이 reminderSetAt 보다 뒤가 되게) */
  const day = kstDate(new Date(Date.now() + 2 * DAY_MS));
  const at = (time: string, date = day) => new Date(`${date}T${time}+09:00`);
  const events = () => `/v1/groups/${groupId}/events`;
  const restorePath = (deletionId: number, gid = groupId) => `/v1/groups/${gid}/event-deletions/${deletionId}/restore`;
  const MINJI_TOKEN = 'ExponentPushToken[minji]';
  const JIHUN_TOKEN = 'ExponentPushToken[jihun]';

  const create = async (who: Session, body: Record<string, unknown>) =>
    (await api(app).post(events()).set(auth(who)).send({ allDay: false, ...body }).expect(201)).body.data as { id: number; publicCode: string };
  const remove = async (who: Session, eventId: number, query: Record<string, string> = {}) =>
    (await api(app).delete(`${events()}/${eventId}`).query(query).set(auth(who)).expect(200)).body.data as { ok: true; deletionId: number };
  const restore = (who: Session, deletionId: number) => api(app).post(restorePath(deletionId)).set(auth(who));
  const listDay = async (who: Session, date = day) =>
    (
      await api(app)
        .get(events())
        .query({ from: at('00:00:00', date).toISOString(), to: at('23:59:59', date).toISOString() })
        .set(auth(who))
        .expect(200)
    ).body.data as { id: number; title: string; occurrence: string | null }[];

  /** 일정 하나에 딸린 행 전부 (복원 대조용). updatedAt 까지 그대로 */
  const rowsOf = async (eventId: number) => ({
    event: await prisma.event.findUnique({ where: { id: eventId } }),
    exceptions: await prisma.eventException.findMany({ where: { eventId }, orderBy: { id: 'asc' } }),
    participants: await prisma.eventParticipant.findMany({ where: { eventId }, orderBy: { userId: 'asc' } }),
    rsvps: await prisma.eventRsvp.findMany({ where: { eventId }, orderBy: [{ occurrence: 'asc' }, { userId: 'asc' }] }),
    reactions: await prisma.eventReaction.findMany({ where: { eventId }, orderBy: [{ occurrence: 'asc' }, { userId: 'asc' }] }),
    shares: await prisma.eventShare.findMany({ where: { eventId }, orderBy: { id: 'asc' } }),
    logs: (await prisma.eventLog.findMany({ where: { eventId }, orderBy: { id: 'asc' }, select: { id: true, action: true } })),
  });

  beforeAll(async () => {
    await fake.start();
    process.env.EXPO_PUSH_URL = fake.url;
    app = await createTestApp();
    prisma = app.get(PrismaService);
    scheduler = app.get(PushScheduler);
  });

  afterAll(async () => {
    await resetDb(app);
    await app.close();
    await fake.stop();
  });

  beforeEach(async () => {
    await resetDb(app);
    fake.reset();
    minji = await devLogin(app, '민지');
    jihun = await devLogin(app, '지훈');
    outsider = await devLogin(app, '남');
    const team = await api(app).post('/v1/groups').set(auth(minji)).send({ name: '우리' }).expect(201);
    groupId = team.body.data.id;
    inviteCode = team.body.data.inviteCode;
    await api(app).post('/v1/groups/join').set(auth(jihun)).send({ code: inviteCode }).expect(200);
    for (const [who, token] of [
      [minji, MINJI_TOKEN],
      [jihun, JIHUN_TOKEN],
    ] as const) {
      await api(app).put('/v1/me/push-devices').set(auth(who)).send({ token, platform: 'IOS', appVersion: '1.1.0' }).expect(200);
    }
    await prisma.pushNotification.updateMany({ where: { status: 'PENDING' }, data: { status: 'SKIPPED' } });
  });

  describe('한 번짜리', () => {
    /** 모든 칸을 채운 일정 + 응답, 반응, 공유 링크, 수정 기록 */
    const fullEvent = async () => {
      const event = await create(minji, {
        title: '갱 피티',
        startsAt: at('10:00:00').toISOString(),
        endsAt: at('22:00:00').toISOString(),
        memo: '운동복 챙기기',
        reminder: 'HOUR_1',
        participants: [minji.userId, jihun.userId],
        color: '#F26D6D',
        place: { text: '동네 체육관' },
      });
      await api(app).patch(`${events()}/${event.id}`).set(auth(minji)).send({ memo: '운동복, 물' }).expect(200);
      await api(app).put(`${events()}/${event.id}/rsvp`).set(auth(jihun)).send({ status: 'GOING' }).expect(200);
      await api(app).put(`${events()}/${event.id}/reaction`).set(auth(minji)).send({ reaction: 'LIKE' }).expect(200);
      const share = (await api(app).post(`${events()}/${event.id}/share`).set(auth(minji)).send({}).expect(201)).body.data as { token: string };
      return { ...event, shareToken: share.token };
    };

    it('지우면 모든 읽기 경로에서 사라지고, 되돌리면 행 그대로 돌아온다 (번호, 공개 코드, 기록 연결 포함)', async () => {
      const event = await fullEvent();
      const before = await rowsOf(event.id);
      expect(before.participants).toHaveLength(2);
      expect(before.rsvps).toHaveLength(1);
      expect(before.reactions).toHaveLength(1);
      expect(before.shares).toHaveLength(1);
      expect(before.logs.map((log) => log.action)).toEqual(['CREATED', 'UPDATED']);
      const feed = (await api(app).put(`/v1/groups/${groupId}/calendar-feed`).set(auth(jihun)).send({}).expect(200)).body.data as { httpsUrl: string };
      const icsPath = new URL(feed.httpsUrl).pathname;
      const ics = async () => (await request(app.getHttpServer()).get(icsPath).expect(200)).text;
      const freeSlots = async () =>
        (
          await api(app)
            .get(`/v1/groups/${groupId}/free-slots`)
            .query({ from: at('00:00:00').toISOString(), to: at('23:59:00').toISOString(), dayStart: '09:00', dayEnd: '23:00', minMinutes: 120 })
            .set(auth(minji))
            .expect(200)
        ).body.data.slots as unknown[];
      const search = async () => (await api(app).get('/v1/events/search').query({ q: '갱 피티', groupId }).set(auth(minji)).expect(200)).body.data.items as unknown[];
      expect(await ics()).toContain('갱 피티');
      expect(await freeSlots()).toEqual([]);
      expect(await search()).toHaveLength(1);

      const { deletionId } = await remove(jihun, event.id);
      expect(deletionId).toEqual(expect.any(Number));

      // 지운 뒤: 지금과 똑같이 진짜로 없다
      expect(await listDay(minji)).toEqual([]);
      await api(app).get(`${events()}/${event.id}`).set(auth(minji)).expect(404);
      await api(app).get(`/v1/events/${event.publicCode}`).set(auth(minji)).expect(404);
      expect(await search()).toEqual([]);
      expect(await freeSlots()).not.toEqual([]);
      expect(await ics()).not.toContain('갱 피티');
      await api(app).get(`/v1/event-shares/${event.shareToken}`).expect(404);
      // 위젯, 다가오는 일정은 목록 API 를 쓴다(위에서 확인). 참석 응답도 못 한다
      await api(app).put(`${events()}/${event.id}/rsvp`).set(auth(jihun)).send({ status: 'NOT_GOING' }).expect(404);
      const news = async () => (await api(app).get(`/v1/groups/${groupId}/news`).set(auth(minji)).expect(200)).body.data.items as { action: string }[];
      expect((await news()).map((item) => item.action)).toContain('DELETED');

      const restored = await restore(minji, deletionId).expect(200);
      expect(restored.body.data).toEqual({ ok: true, eventId: event.id, occurrence: null });

      const after = await rowsOf(event.id);
      expect(after).toEqual(before);
      expect((await listDay(minji)).map((row) => row.title)).toEqual(['갱 피티']);
      expect((await api(app).get(`/v1/events/${event.publicCode}`).set(auth(minji)).expect(200)).body.data.id).toBe(event.id);
      expect(await search()).toHaveLength(1);
      expect(await freeSlots()).toEqual([]);
      expect(await ics()).toContain('갱 피티');
      await api(app).get(`/v1/event-shares/${event.shareToken}`).expect(200);
      // 삭제 소식은 숨긴다, 보관 행도 없다
      expect((await news()).map((item) => item.action)).not.toContain('DELETED');
      expect(await prisma.eventDeletion.count()).toBe(0);
      // 같은 삭제를 두 번 되돌릴 수 없다
      await restore(minji, deletionId).expect(404);
    });

    it('알림: 지운 동안은 예약하지 않고, 되돌리면 그 시각에 다시 간다', async () => {
      const event = await create(minji, { title: '저녁', startsAt: at('18:00:00').toISOString(), endsAt: at('19:00:00').toISOString(), reminder: 'HOUR_1', participants: 'ALL' });
      const { deletionId } = await remove(minji, event.id);
      await scheduler.tick(at('16:59:00'));
      await restore(minji, deletionId).expect(200);
      expect((await prisma.event.findUniqueOrThrow({ where: { id: event.id } })).remindAt).toEqual(at('17:00:00'));
      await scheduler.tick(at('17:00:10'));
      expect(fake.messages.filter((m) => m.data.kind === 'REMINDER').map((m) => m.to).sort()).toEqual([JIHUN_TOKEN, MINJI_TOKEN]);
    });

    it('알림: 지운 채로 알림 시각이 지나면 보내지 않는다 (예약 경로가 지운 일정을 못 본다)', async () => {
      const event = await create(minji, { title: '저녁', startsAt: at('18:00:00').toISOString(), endsAt: at('19:00:00').toISOString(), reminder: 'HOUR_1', participants: 'ALL' });
      await remove(minji, event.id);
      await scheduler.tick(at('17:00:10'));
      expect(fake.messages.filter((m) => m.data.kind === 'REMINDER')).toEqual([]);
      expect(await prisma.pushNotification.count({ where: { kind: 'REMINDER' } })).toBe(0);
    });

    it('(#444) "모두" 로 남은 옛 일정은 되돌리는 시각 멤버 전원을 참여자 행으로 되살린다 (D-263)', async () => {
      const event = await create(minji, { title: '저녁', startsAt: at('18:00:00').toISOString(), endsAt: at('19:00:00').toISOString() });
      await prisma.event.update({ where: { id: event.id }, data: { allMembers: true, participants: { deleteMany: {} } } });
      const { deletionId } = await remove(minji, event.id);
      await restore(minji, deletionId).expect(200);
      expect((await prisma.event.findUniqueOrThrow({ where: { id: event.id } })).allMembers).toBe(false);
      const rows = await prisma.eventParticipant.findMany({ where: { eventId: event.id }, orderBy: { userId: 'asc' } });
      expect(rows.map((row) => row.userId)).toEqual([minji.userId, jihun.userId].sort((a, b) => a - b));
    });

    it('투표로 정한 일정: 되돌리면 투표의 일정 연결도 돌아온다', async () => {
      const poll = (
        await api(app)
          .post(`/v1/groups/${groupId}/polls`)
          .set(auth(minji))
          .send({ title: '저녁 약속', options: [{ startsAt: at('19:00:00').toISOString(), endsAt: at('21:00:00').toISOString(), allDay: false }, { startsAt: at('12:00:00').toISOString(), endsAt: at('13:00:00').toISOString(), allDay: false }] })
          .expect(201)
      ).body.data as { id: number; options: { id: number }[] };
      const decided = (await api(app).post(`/v1/groups/${groupId}/polls/${poll.id}/confirm`).set(auth(minji)).send({ optionId: poll.options[0].id }).expect(201)).body.data;
      const { deletionId } = await remove(minji, decided.event.id);
      expect((await prisma.poll.findUniqueOrThrow({ where: { id: poll.id } })).eventId).toBeNull();
      await restore(jihun, deletionId).expect(200);
      expect((await prisma.poll.findUniqueOrThrow({ where: { id: poll.id } })).eventId).toBe(decided.event.id);
    });

    it('그 사이 나간 멤버의 참여자, 응답, 반응은 돌아오지 않고, 그 사람의 공유 링크는 끊긴 채로', async () => {
      const event = await fullEvent();
      await api(app).put(`${events()}/${event.id}/reaction`).set(auth(jihun)).send({ reaction: 'EXCITED' }).expect(200);
      const jihunShare = await prisma.eventShare.findFirstOrThrow({ where: { eventId: event.id } });
      await prisma.eventShare.update({ where: { id: jihunShare.id }, data: { createdById: jihun.userId } });
      const { deletionId } = await remove(minji, event.id);
      await api(app).delete(`/v1/groups/${groupId}/me`).set(auth(jihun)).expect(200);
      await restore(minji, deletionId).expect(200);
      const after = await rowsOf(event.id);
      expect(after.participants.map((row) => row.userId)).toEqual([minji.userId]);
      expect(after.rsvps).toEqual([]);
      expect(after.reactions.map((row) => row.userId)).toEqual([minji.userId]);
      expect(after.shares[0].revokedAt).not.toBeNull();
    });
  });

  describe('권한, 기간, 청소', () => {
    it('팀원 누구나 되돌린다. 팀 밖은 403, 다른 팀 경로는 404, 형식 오류는 400', async () => {
      const event = await create(minji, { title: 'a', startsAt: at('10:00:00').toISOString(), endsAt: at('11:00:00').toISOString() });
      const { deletionId } = await remove(minji, event.id);
      await api(app).post(restorePath(deletionId)).set(auth(outsider)).expect(403);
      const other = (await api(app).post('/v1/groups').set(auth(minji)).send({ name: '다른 팀' }).expect(201)).body.data.id as number;
      await api(app).post(restorePath(deletionId, other)).set(auth(minji)).expect(404);
      await api(app).post(`/v1/groups/${groupId}/event-deletions/abc/restore`).set(auth(minji)).expect(400);
      await api(app).post(restorePath(deletionId)).expect(401);
      await restore(jihun, deletionId).expect(200);
    });

    it('7일이 지나면 404 (기간이 지났어요), 하루 청소가 보관 행을 지운다', async () => {
      const a = await create(minji, { title: 'a', startsAt: at('10:00:00').toISOString(), endsAt: at('11:00:00').toISOString() });
      const b = await create(minji, { title: 'b', startsAt: at('12:00:00').toISOString(), endsAt: at('13:00:00').toISOString() });
      const old = await remove(minji, a.id);
      const fresh = await remove(minji, b.id);
      await prisma.eventDeletion.update({ where: { id: old.deletionId }, data: { createdAt: new Date(Date.now() - DELETION_RETENTION_MS - 60_000) } });
      const expired = await restore(minji, old.deletionId).expect(404);
      expect(expired.body.message).toBe('되돌릴 수 있는 기간이 지났어요');

      // 하루 청소 (KST 04:00 이후 첫 틱)
      const tomorrow = kstDate(new Date(Date.now() + DAY_MS));
      const result = await scheduler.tick(new Date(`${tomorrow}T04:00:30+09:00`));
      expect(result.purgedDeletions).toBe(1);
      expect((await prisma.eventDeletion.findMany({ select: { id: true } })).map((row) => row.id)).toEqual([fresh.deletionId]);
    });

    it('팀이 지워지면 보관 행도 지워진다 (Cascade)', async () => {
      const personal = (await api(app).get('/v1/groups').set(auth(minji)).expect(200)).body.data.find((g: { type: string }) => g.type === 'PERSONAL');
      const event = (await api(app).post(`/v1/groups/${personal.id}/events`).set(auth(minji)).send({ title: 'p', startsAt: at('10:00:00').toISOString(), endsAt: at('11:00:00').toISOString(), allDay: false }).expect(201)).body.data;
      await api(app).delete(`/v1/groups/${personal.id}/events/${event.id}`).set(auth(minji)).expect(200);
      await api(app).delete(`/v1/groups/${groupId}/me`).set(auth(jihun)).expect(200);
      await api(app).delete(`/v1/groups/${groupId}/me`).set(auth(minji)).expect(200);
      expect(await prisma.group.findUnique({ where: { id: groupId } })).toBeNull();
      expect(await prisma.eventDeletion.count({ where: { groupId: personal.id } })).toBe(1);
    });
  });

  describe('반복 일정', () => {
    /** 매주 수 19~21시, 3주 뒤 회차 하나는 "이 일정만" 으로 제목을 바꾼다 */
    const firstDate = kstDate(new Date(Date.now() + 7 * DAY_MS));
    const plus = (days: number) => kstDate(new Date(new Date(`${firstDate}T12:00:00+09:00`).getTime() + days * DAY_MS));
    const series = async () => {
      const event = await create(minji, {
        title: '요가',
        startsAt: at('19:00:00', firstDate).toISOString(),
        endsAt: at('21:00:00', firstDate).toISOString(),
        repeat: 'WEEKLY',
        repeatUntil: plus(70),
        participants: 'ALL',
      });
      await api(app).patch(`${events()}/${event.id}`).query({ scope: 'this', occurrence: plus(21) }).set(auth(minji)).send({ title: '요가 (특강)' }).expect(200);
      for (const occurrence of [plus(7), plus(14), plus(28)]) {
        await api(app).put(`${events()}/${event.id}/rsvp`).query({ occurrence }).set(auth(jihun)).send({ status: 'GOING' }).expect(200);
        await api(app).put(`${events()}/${event.id}/reaction`).query({ occurrence }).set(auth(minji)).send({ reaction: 'ACK' }).expect(200);
      }
      return event;
    };
    const titlesOn = async (date: string) => (await listDay(minji, date)).map((row) => row.title);

    it('이 일정만: 그 회차가 사라졌다가 되돌리면 예외, 응답, 반응 그대로', async () => {
      const event = await series();
      const before = await rowsOf(event.id);
      const { deletionId } = await remove(jihun, event.id, { scope: 'this', occurrence: plus(14) });
      expect(await titlesOn(plus(14))).toEqual([]);
      expect((await rowsOf(event.id)).rsvps.map((row) => row.occurrence.toISOString().slice(0, 10))).toEqual([plus(7), plus(28)]);
      await restore(minji, deletionId).expect(200);
      const after = await rowsOf(event.id);
      expect({ ...after, logs: undefined }).toEqual({ ...before, logs: undefined });
      expect(after.logs).toEqual(before.logs);
      expect(await titlesOn(plus(14))).toEqual(['요가']);
    });

    it('이 일정만: 이미 예외가 있던 회차를 지워도 그 예외(바꾼 제목) 로 돌아온다', async () => {
      const event = await series();
      const before = await rowsOf(event.id);
      const { deletionId } = await remove(minji, event.id, { scope: 'this', occurrence: plus(21) });
      expect(await titlesOn(plus(21))).toEqual([]);
      await restore(minji, deletionId).expect(200);
      expect((await rowsOf(event.id)).exceptions).toEqual(before.exceptions);
      expect(await titlesOn(plus(21))).toEqual(['요가 (특강)']);
    });

    it('이후 모두 (그 뒤 회차): 종료일, 그 뒤 예외, 응답이 그대로 돌아온다', async () => {
      const event = await series();
      const before = await rowsOf(event.id);
      const { deletionId } = await remove(jihun, event.id, { scope: 'following', occurrence: plus(14) });
      expect(await titlesOn(plus(21))).toEqual([]);
      expect(await titlesOn(plus(7))).toEqual(['요가']);
      await restore(jihun, deletionId).expect(200);
      const after = await rowsOf(event.id);
      expect({ ...after, event: { ...after.event, updatedAt: null } }).toEqual({ ...before, event: { ...before.event, updatedAt: null } });
      expect(await titlesOn(plus(21))).toEqual(['요가 (특강)']);
      expect(await titlesOn(plus(70))).toEqual(['요가']);
    });

    it('이후 모두 (첫 회차): 원본 행째 지웠다가 그대로 돌아온다', async () => {
      const event = await series();
      const before = await rowsOf(event.id);
      const { deletionId } = await remove(minji, event.id, { scope: 'following', occurrence: firstDate });
      expect(await prisma.event.findUnique({ where: { id: event.id } })).toBeNull();
      await restore(minji, deletionId).expect(200);
      expect(await rowsOf(event.id)).toEqual(before);
      expect(await titlesOn(plus(21))).toEqual(['요가 (특강)']);
    });

    it('겹친 삭제: 회차를 지운 뒤 원본째 지우고, 거꾸로 되돌리면 모두 돌아온다. 순서가 어긋나면 409', async () => {
      const event = await series();
      const before = await rowsOf(event.id);
      const one = await remove(minji, event.id, { scope: 'this', occurrence: plus(7) });
      const all = await remove(minji, event.id, { scope: 'following', occurrence: firstDate });
      // 원본이 없으니 회차 되돌리기는 409, 보관은 남는다
      expect((await restore(minji, one.deletionId).expect(409)).body.error.code).toBe('EVENT_RESTORE_CONFLICT');
      await restore(minji, all.deletionId).expect(200);
      await restore(minji, one.deletionId).expect(200);
      expect(await rowsOf(event.id)).toEqual(before);
    });

    it('그 사이 일정이 바뀌면 409 (이후 모두 뒤 종료일을 다시 바꿈, 지운 회차를 다른 범위로 덮음)', async () => {
      const event = await series();
      const following = await remove(minji, event.id, { scope: 'following', occurrence: plus(35) });
      await api(app).delete(`${events()}/${event.id}`).query({ scope: 'following', occurrence: plus(28) }).set(auth(minji)).expect(200);
      await restore(minji, following.deletionId).expect(409);

      const other = await series();
      const one = await remove(minji, other.id, { scope: 'this', occurrence: plus(7) });
      // 첫 회차 "이후 모두" 수정은 예외를 모두 지운다 → 취소 예외가 없어 되돌릴 수 없다
      await api(app).patch(`${events()}/${other.id}`).query({ scope: 'following', occurrence: firstDate }).set(auth(minji)).send({ memo: '바꿈' }).expect(200);
      await restore(minji, one.deletionId).expect(409);
    });
  });

  describe('팀원 변경 알림 (2분 묶음 안에서 되돌리면 거둔다)', () => {
    const changes = () => fake.messages.filter((m) => m.data.kind === 'CHANGE');
    const afterCoalesce = () => new Date(Date.now() + 2 * 60 * 1000 + 5_000);

    it('삭제 알림만 있었으면 취소한다', async () => {
      const event = await create(minji, { title: '저녁', startsAt: at('18:00:00').toISOString(), endsAt: at('19:00:00').toISOString() });
      await prisma.pushNotification.updateMany({ where: { status: 'PENDING' }, data: { status: 'SKIPPED' } });
      const { deletionId } = await remove(jihun, event.id);
      expect(await prisma.pushNotification.count({ where: { kind: 'CHANGE', status: 'PENDING' } })).toBe(1);
      await restore(jihun, deletionId).expect(200);
      await scheduler.tick(afterCoalesce());
      expect(changes()).toEqual([]);
    });

    it('추가 직후 삭제(둘 다 취소) 를 되돌리면 추가 알림이 다시 간다', async () => {
      const event = await create(jihun, { title: '저녁', startsAt: at('18:00:00').toISOString(), endsAt: at('19:00:00').toISOString(), participants: 'ALL' });
      const { deletionId } = await remove(jihun, event.id);
      expect(await prisma.pushNotification.count({ where: { kind: 'CHANGE', status: 'PENDING' } })).toBe(0);
      await restore(jihun, deletionId).expect(200);
      await scheduler.tick(afterCoalesce());
      expect(changes().map((m) => m.to)).toEqual([MINJI_TOKEN]);
      expect(changes()[0].title).toContain('추가');
    });

    it('수정 직후 삭제(삭제로 합침) 를 되돌리면 수정 알림으로 돌아간다', async () => {
      const event = await create(minji, { title: '저녁', startsAt: at('18:00:00').toISOString(), endsAt: at('19:00:00').toISOString() });
      await prisma.pushNotification.updateMany({ where: { status: 'PENDING' }, data: { status: 'SKIPPED' } });
      await api(app).patch(`${events()}/${event.id}`).set(auth(jihun)).send({ title: '저녁 약속' }).expect(200);
      const { deletionId } = await remove(jihun, event.id);
      expect((await prisma.pushNotification.findFirstOrThrow({ where: { kind: 'CHANGE', status: 'PENDING' } })).changeAction).toBe('DELETED');
      await restore(jihun, deletionId).expect(200);
      expect((await prisma.pushNotification.findFirstOrThrow({ where: { kind: 'CHANGE', status: 'PENDING' } })).changeAction).toBe('UPDATED');
      await scheduler.tick(afterCoalesce());
      expect(changes().map((m) => m.title).join()).toContain('수정');
    });
  });
});
