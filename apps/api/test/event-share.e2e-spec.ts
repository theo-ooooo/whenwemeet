import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { api, auth, createTestApp, devLogin, resetDb, Session, TestApp } from './helpers.js';

/**
 * (#274) 일정 카드 공유 (api.md 2.10, D-181 ~ D-185). 링크 만들기/조회/끊기, 공개 미리보기, 합류, 끊김 규칙.
 * 2027-01 날짜는 지금 이후라 "지난 회차" 에 걸리지 않는다
 */
describe('일정 카드 공유 (e2e)', () => {
  let app: TestApp;
  let prisma: PrismaService;
  let alice: Session;
  let bob: Session;
  let carol: Session;
  let dave: Session;
  let groupId: number;
  let onceId: number;
  let seriesId: number;
  const events = () => `/v1/groups/${groupId}/events`;
  const shareOf = (eventId: number) => `${events()}/${eventId}/share`;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    await resetDb(app);
    alice = await devLogin(app, '앨리스');
    bob = await devLogin(app, '밥');
    carol = await devLogin(app, '캐럴');
    dave = await devLogin(app, '데이브');
    const team = await api(app).post('/v1/groups').set(auth(alice)).send({ name: '저녁 모임' }).expect(201);
    groupId = team.body.data.id;
    await api(app).post('/v1/groups/join').set(auth(bob)).send({ code: team.body.data.inviteCode }).expect(200);
    const once = await api(app)
      .post(events())
      .set(auth(alice))
      .send({ title: '토요일 저녁', startsAt: '2027-01-09T19:00:00+09:00', endsAt: '2027-01-09T21:00:00+09:00', allDay: false, memo: '비밀 메모' })
      .expect(201);
    onceId = once.body.data.id;
    const series = await api(app)
      .post(events())
      .set(auth(alice))
      .send({ title: '주간 회의', startsAt: '2027-01-06T10:00:00+09:00', endsAt: '2027-01-06T11:00:00+09:00', allDay: false, memo: '안건', repeat: 'WEEKLY' })
      .expect(201);
    seriesId = series.body.data.id;
  });

  afterAll(async () => {
    await resetDb(app);
    await app.close();
  });

  it('만들기 201, 다시 부르면 같은 링크 200 (팀 전체가 하나), 조회도 같은 링크', async () => {
    expect((await api(app).get(shareOf(onceId)).set(auth(alice)).expect(200)).body.data).toBeNull();
    const created = await api(app).post(shareOf(onceId)).set(auth(alice)).send({}).expect(201);
    const link = created.body.data;
    expect(Object.keys(link).sort()).toEqual(['expiresAt', 'token', 'url']);
    expect(link.token).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(link.url).toBe(`http://localhost:3000/join/e/${link.token}`);
    // 회차 끝 + 1일 (만든 때 + 30일보다 이르면)
    const endPlusDay = new Date('2027-01-10T21:00:00+09:00').getTime();
    expect(new Date(link.expiresAt).getTime()).toBe(Math.min(endPlusDay, new Date(link.expiresAt).getTime()));
    expect(new Date(link.expiresAt).getTime()).toBeLessThanOrEqual(Date.now() + 30 * 86_400_000 + 5_000);

    const again = await api(app).post(shareOf(onceId)).set(auth(bob)).send({}).expect(200);
    expect(again.body.data.token).toBe(link.token);
    const got = await api(app).get(shareOf(onceId)).set(auth(bob)).expect(200);
    expect(got.body.data.token).toBe(link.token);
    expect(await prisma.eventShare.count({ where: { eventId: onceId } })).toBe(1);
  });

  it('동시에 만들어도 살아 있는 링크는 하나', async () => {
    const results = await Promise.all([1, 2, 3].map(() => api(app).post(shareOf(seriesId)).set(auth(alice)).send({ occurrence: '2027-01-13' })));
    expect(new Set(results.map((r) => r.body.data.token)).size).toBe(1);
    expect(results.map((r) => r.status).sort((a, b) => a - b)).toEqual([200, 200, 201]);
  });

  it('권한, 개인 팀, 반복 occurrence, 지난 회차', async () => {
    await api(app).post(shareOf(onceId)).set(auth(carol)).send({}).expect(403);
    await api(app).get(shareOf(onceId)).set(auth(carol)).expect(403);
    await api(app).delete(shareOf(onceId)).set(auth(carol)).expect(403);
    await api(app).post(`${events()}/999999/share`).set(auth(alice)).send({}).expect(404);

    const missing = await api(app).post(shareOf(seriesId)).set(auth(alice)).send({}).expect(400);
    expect(missing.body.error).toMatchObject({ code: 'VALIDATION_FAILED', details: [{ field: 'occurrence' }] });
    const notOccurrence = await api(app).post(shareOf(seriesId)).set(auth(alice)).send({ occurrence: '2027-01-07' }).expect(400);
    expect(notOccurrence.body.error.code).toBe('VALIDATION_FAILED');
    await api(app).post(shareOf(seriesId)).set(auth(alice)).send({ occurrence: '2027-02-30' }).expect(400);
    await api(app).post(shareOf(seriesId)).set(auth(alice)).send({ extra: 1 }).expect(400);

    const groups = await api(app).get('/v1/groups').set(auth(alice)).expect(200);
    const personalId = groups.body.data.find((g: { type: string }) => g.type === 'PERSONAL').id;
    const mine = await api(app)
      .post(`/v1/groups/${personalId}/events`)
      .set(auth(alice))
      .send({ title: '혼자', startsAt: '2027-01-09T10:00:00+09:00', endsAt: '2027-01-09T11:00:00+09:00', allDay: false })
      .expect(201);
    const personal = await api(app).post(`/v1/groups/${personalId}/events/${mine.body.data.id}/share`).set(auth(alice)).send({}).expect(400);
    expect(personal.body.error.code).toBe('GROUP_NOT_INVITABLE');

    const past = await api(app)
      .post(events())
      .set(auth(alice))
      .send({ title: '지난 일', startsAt: '2026-01-09T10:00:00+09:00', endsAt: '2026-01-09T11:00:00+09:00', allDay: false })
      .expect(201);
    const ended = await api(app).post(shareOf(past.body.data.id)).set(auth(alice)).send({}).expect(400);
    expect(ended.body.error.code).toBe('EVENT_SHARE_ENDED');
    // 반복의 지난 회차도
    const pastOccurrence = await api(app).post(shareOf(seriesId)).set(auth(alice)).send({ occurrence: '2026-12-30' }).expect(400);
    expect(pastOccurrence.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('미리보기: 메모, 참여자, 등록자, id 가 없다 (키 스냅샷). 회차 값과 반복 표시', async () => {
    const link = (await api(app).post(shareOf(seriesId)).set(auth(bob)).send({ occurrence: '2027-01-20' }).expect(201)).body.data;
    const res = await api(app).get(`/v1/event-shares/${link.token}`).expect(200);
    expect(res.body.data).toEqual({
      groupName: '저녁 모임',
      memberCount: 2,
      sharer: { displayName: '밥' },
      event: {
        title: '주간 회의',
        startsAt: '2027-01-20T01:00:00.000Z',
        endsAt: '2027-01-20T02:00:00.000Z',
        allDay: false,
        repeat: 'WEEKLY',
        occurrence: '2027-01-20',
      },
      expiresAt: link.expiresAt,
      viewer: { member: false },
    });
    expect(JSON.stringify(res.body)).not.toMatch(/안건|memo|participants|creator|groupId|eventId/);

    // "이 일정만" 으로 바꾸면 바뀐 값 (스냅샷 아님), 표시 이름도 지금 값
    await api(app)
      .patch(`${events()}/${seriesId}?occurrence=2027-01-20&scope=this`)
      .set(auth(alice))
      .send({ title: '회의 (장소 변경)', startsAt: '2027-01-21T15:00:00+09:00', endsAt: '2027-01-21T16:00:00+09:00' })
      .expect(200);
    await api(app).patch(`/v1/groups/${groupId}/me`).set(auth(bob)).send({ displayName: '밥밥' }).expect(200);
    const changed = await api(app).get(`/v1/event-shares/${link.token}`).expect(200);
    expect(changed.body.data).toMatchObject({ sharer: { displayName: '밥밥' }, event: { title: '회의 (장소 변경)', occurrence: '2027-01-20', startsAt: '2027-01-21T06:00:00.000Z' } });
  });

  it('선택 인증: 토큰 없음/틀림/만료/비멤버 → member false, 멤버 → 착지 정보 (옮긴 회차는 옮긴 날짜)', async () => {
    const link = (await api(app).post(shareOf(seriesId)).set(auth(alice)).send({ occurrence: '2027-01-20' }).expect(200)).body.data;
    const expired = app.get(JwtService).sign({ sub: String(alice.userId) }, { expiresIn: -60 });
    for (const headers of [{}, { Authorization: 'Bearer nope' }, { Authorization: `Bearer ${expired}` }, auth(carol)]) {
      const res = await api(app).get(`/v1/event-shares/${link.token}`).set(headers).expect(200);
      expect(res.body.data.viewer).toEqual({ member: false });
    }
    const member = await api(app).get(`/v1/event-shares/${link.token}`).set(auth(alice)).expect(200);
    // (#311) 착지 정보에 팀, 일정 공개 코드 (웹이 `/events/<코드>?team=` 로 간다)
    expect(member.body.data.viewer).toEqual({
      member: true,
      groupId,
      eventId: seriesId,
      groupCode: expect.stringMatching(/^[a-z0-9]{8}$/),
      eventCode: expect.stringMatching(/^[a-z0-9]{8}$/),
      occurrence: '2027-01-20',
      date: '2027-01-21',
    });
  });

  it('잘못된 토큰 모양, 없는 토큰, 대소문자 바꾼 토큰 → 404 EVENT_SHARE_NOT_FOUND', async () => {
    const link = (await api(app).post(shareOf(onceId)).set(auth(alice)).send({}).expect(200)).body.data;
    const swapped = link.token.replace(/[a-zA-Z]/, (c: string) => (c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase()));
    for (const token of ['short', 'A'.repeat(22), swapped]) {
      const res = await api(app).get(`/v1/event-shares/${token}`).expect(404);
      expect(res.body.error.code).toBe('EVENT_SHARE_NOT_FOUND');
    }
  });

  it('합류: 멱등, joinCount 는 새 합류만, JOIN 알림, 새 소식 경로, 착지 정보', async () => {
    const link = (await api(app).post(shareOf(onceId)).set(auth(alice)).send({}).expect(200)).body.data;
    await api(app).post(`/v1/event-shares/${link.token}/join`).expect(401);
    const joined = await api(app).post(`/v1/event-shares/${link.token}/join`).set(auth(carol)).expect(200);
    expect(joined.body.data).toMatchObject({ eventId: onceId, eventCode: expect.stringMatching(/^[a-z0-9]{8}$/), occurrence: null, date: '2027-01-09', group: { id: groupId, name: '저녁 모임' } });
    expect(joined.body.data.group.members).toHaveLength(3);
    await api(app).post(`/v1/event-shares/${link.token}/join`).set(auth(carol)).expect(200);
    await api(app).post(`/v1/event-shares/${link.token}/join`).set(auth(alice)).expect(200);
    const row = await prisma.eventShare.findUniqueOrThrow({ where: { token: link.token } });
    expect(row.joinCount).toBe(1);
    expect(await prisma.pushNotification.count({ where: { kind: 'JOIN', groupId, actorId: carol.userId } })).toBe(1);
    const activity = await prisma.groupActivity.findFirstOrThrow({ where: { groupId, type: 'MEMBER_JOINED', actorId: carol.userId } });
    expect(activity.payload).toEqual({ via: 'EVENT_SHARE' });
    // 합류 후 미리보기는 멤버
    const after = await api(app).get(`/v1/event-shares/${link.token}`).set(auth(carol)).expect(200);
    expect(after.body.data.viewer).toMatchObject({ member: true, groupId, eventId: onceId, date: '2027-01-09' });
    // 초대 코드 합류는 payload 없음
    const bobJoin = await prisma.groupActivity.findFirstOrThrow({ where: { groupId, type: 'MEMBER_JOINED', actorId: bob.userId } });
    expect(bobJoin.payload).toBeNull();
  });

  it('끊기: 팀원 누구나, 없어도 200, 끊으면 404 이고 다음 만들기는 새 토큰', async () => {
    const before = (await api(app).post(shareOf(onceId)).set(auth(alice)).send({}).expect(200)).body.data;
    await api(app).delete(shareOf(onceId)).set(auth(carol)).expect(200);
    await api(app).delete(shareOf(onceId)).set(auth(carol)).expect(200);
    expect((await api(app).get(`/v1/event-shares/${before.token}`).expect(404)).body.error.code).toBe('EVENT_SHARE_NOT_FOUND');
    await api(app).post(`/v1/event-shares/${before.token}/join`).set(auth(dave)).expect(404);
    const next = await api(app).post(shareOf(onceId)).set(auth(alice)).send({}).expect(201);
    expect(next.body.data.token).not.toBe(before.token);
    // 반복 회차 끊기는 occurrence 필수
    await api(app).delete(shareOf(seriesId)).set(auth(alice)).expect(400);
  });

  it('만료 시각이 지나면 404', async () => {
    const link = (await api(app).post(shareOf(onceId)).set(auth(alice)).send({}).expect(200)).body.data;
    await prisma.eventShare.update({ where: { token: link.token }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await api(app).get(`/v1/event-shares/${link.token}`).expect(404);
    expect((await api(app).get(shareOf(onceId)).set(auth(alice)).expect(200)).body.data).toBeNull();
  });

  it('회차 취소, "이후 모두" 로 회차 소멸, 일정 삭제(Cascade) → 404', async () => {
    const cancel = (await api(app).post(shareOf(seriesId)).set(auth(alice)).send({ occurrence: '2027-01-27' }).expect(201)).body.data;
    await api(app).delete(`${events()}/${seriesId}?occurrence=2027-01-27&scope=this`).set(auth(alice)).expect(200);
    await api(app).get(`/v1/event-shares/${cancel.token}`).expect(404);

    const later = (await api(app).post(shareOf(seriesId)).set(auth(alice)).send({ occurrence: '2027-02-10' }).expect(201)).body.data;
    await api(app).get(`/v1/event-shares/${later.token}`).expect(200);
    await api(app).patch(`${events()}/${seriesId}?occurrence=2027-02-03&scope=following`).set(auth(alice)).send({ title: '새 회의' }).expect(200);
    await api(app).get(`/v1/event-shares/${later.token}`).expect(404);

    const once = (await api(app).post(shareOf(onceId)).set(auth(alice)).send({}).expect(201)).body.data;
    await api(app).delete(`${events()}/${onceId}`).set(auth(alice)).expect(200);
    await api(app).get(`/v1/event-shares/${once.token}`).expect(404);
    expect(await prisma.eventShare.count({ where: { eventId: onceId } })).toBe(0);
  });

  it('초대 코드 재발급은 그 팀 일정 링크를 모두 끊는다', async () => {
    const ev = await api(app)
      .post(events())
      .set(auth(alice))
      .send({ title: '재발급', startsAt: '2027-03-01T10:00:00+09:00', endsAt: '2027-03-01T11:00:00+09:00', allDay: false })
      .expect(201);
    const link = (await api(app).post(shareOf(ev.body.data.id)).set(auth(bob)).send({}).expect(201)).body.data;
    await api(app).post(`/v1/groups/${groupId}/invite-code`).set(auth(alice)).expect(200);
    await api(app).get(`/v1/event-shares/${link.token}`).expect(404);
  });

  it('만든 사람이 나가거나 탈퇴하면 그 사람 링크만 끊긴다', async () => {
    const ev = await api(app)
      .post(events())
      .set(auth(alice))
      .send({ title: '나가기', startsAt: '2027-03-02T10:00:00+09:00', endsAt: '2027-03-02T11:00:00+09:00', allDay: false })
      .expect(201);
    const eventId = ev.body.data.id;
    const byCarol = (await api(app).post(shareOf(eventId)).set(auth(carol)).send({}).expect(201)).body.data;
    await api(app).delete(`/v1/groups/${groupId}/me`).set(auth(carol)).expect(200);
    await api(app).get(`/v1/event-shares/${byCarol.token}`).expect(404);

    const ev2 = await api(app)
      .post(events())
      .set(auth(alice))
      .send({ title: '남는 링크', startsAt: '2027-03-03T10:00:00+09:00', endsAt: '2027-03-03T11:00:00+09:00', allDay: false })
      .expect(201);
    const byAlice = (await api(app).post(shareOf(ev2.body.data.id)).set(auth(alice)).send({}).expect(201)).body.data;
    const byBob = (await api(app).post(shareOf(eventId)).set(auth(bob)).send({}).expect(201)).body.data;
    await api(app).delete('/v1/me').set(auth(bob)).expect(200);
    await api(app).get(`/v1/event-shares/${byBob.token}`).expect(404);
    const kept = await api(app).get(`/v1/event-shares/${byAlice.token}`).expect(200);
    expect(kept.body.data.sharer).toEqual({ displayName: '앨리스' });
  });
});
