import { PrismaService } from '../src/prisma/prisma.service.js';
import { PushScheduler } from '../src/push/push.scheduler.js';
import { FakeExpo } from './fake-expo.js';
import { api, auth, createTestApp, devLogin, resetDb, type Session, type TestApp } from './helpers.js';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** 지금부터 days 일 뒤 KST hh:00 (분 0) */
function kstAt(days: number, hour: number): Date {
  const kstNow = new Date(Date.now() + 9 * HOUR);
  const base = Date.UTC(kstNow.getUTCFullYear(), kstNow.getUTCMonth(), kstNow.getUTCDate() + days, hour) - 9 * HOUR;
  return new Date(base);
}
const range = (days: number, hour: number, hours = 2) => ({ startsAt: kstAt(days, hour).toISOString(), endsAt: new Date(kstAt(days, hour).getTime() + hours * HOUR).toISOString(), allDay: false });

interface PollBody {
  id: number;
  publicCode: string;
  status: string;
  expired: boolean;
  eventId: number | null;
  eventCode: string | null;
  myVotes: number[];
  canVote: boolean;
  options: { id: number; startsAt: string; past: boolean; voters: { userId: number }[] }[];
}

/**
 * (#189) 약속 투표 (api.md 2.13, 설계 약속-투표.md, D-234 ~ D-241). 실제 MySQL + 가짜 Expo.
 * 만들기 검증, 표 전체 교체, 대상 검사, 지난 후보, 정하기 트랜잭션(일정, 새 소식, 알림), 동시 정하기, BUSY_NOW, 마감 틱, 취소, 나가기
 */
describe('약속 투표 (e2e, #189)', () => {
  const fake = new FakeExpo();
  let app: TestApp;
  let prisma: PrismaService;
  let scheduler: PushScheduler;
  let minji: Session;
  let jihun: Session;
  let seoyeon: Session;
  let outsider: Session;
  let groupId: number;
  let groupCode: string;

  const create = (who: Session, body: Record<string, unknown>, gid = groupId) => api(app).post(`/v1/groups/${gid}/polls`).set(auth(who)).send(body);
  const open = async (who: Session, extra: Record<string, unknown> = {}) =>
    (await create(who, { title: '저녁 약속', options: [range(2, 19), range(3, 12), range(4, 18)], ...extra }).expect(201)).body.data as PollBody;
  const vote = (who: Session, pollId: number, optionIds: number[]) => api(app).put(`/v1/groups/${groupId}/polls/${pollId}/votes`).set(auth(who)).send({ optionIds });
  const confirm = (who: Session, pollId: number, optionId: number) => api(app).post(`/v1/groups/${groupId}/polls/${pollId}/confirm`).set(auth(who)).send({ optionId });
  const news = async (who: Session) => (await api(app).get(`/v1/groups/${groupId}/news?v=2`).set(auth(who)).expect(200)).body.data.items as Record<string, unknown>[];
  const register = (who: Session, token: string) =>
    api(app).put('/v1/me/push-devices').set(auth(who)).send({ token, platform: 'IOS', appVersion: '1.1.0' }).expect(200);

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
    seoyeon = await devLogin(app, '서연');
    outsider = await devLogin(app, '바깥');
    const team = await api(app).post('/v1/groups').set(auth(minji)).send({ name: '우리' }).expect(201);
    groupId = team.body.data.id;
    groupCode = team.body.data.publicCode;
    for (const who of [jihun, seoyeon]) await api(app).post('/v1/groups/join').set(auth(who)).send({ code: team.body.data.inviteCode }).expect(200);
    await register(minji, 'ExponentPushToken[minji]');
    await register(jihun, 'ExponentPushToken[jihun]');
    await register(seoyeon, 'ExponentPushToken[seoyeon]');
    await prisma.pushNotification.updateMany({ where: { status: 'PENDING' }, data: { status: 'SKIPPED' } });
  });

  it('인증 401, 비멤버 403, 공개 코드 조회는 비멤버 404', async () => {
    await api(app).get(`/v1/groups/${groupId}/polls`).expect(401);
    await api(app).get(`/v1/groups/${groupId}/polls`).set(auth(outsider)).expect(403);
    await create(outsider, { title: 'x', options: [range(2, 19), range(3, 12)] }).expect(403);
    const poll = await open(minji);
    await api(app).get(`/v1/polls/${poll.publicCode}`).set(auth(outsider)).expect(404);
    await api(app).get(`/v1/polls/zzzzzzzz`).set(auth(minji)).expect(404);
    await vote(outsider, poll.id, []).expect(403);
    await confirm(outsider, poll.id, poll.options[0].id).expect(403);
    await api(app).delete(`/v1/groups/${groupId}/polls/${poll.id}`).set(auth(outsider)).expect(403);
  });

  it('만들기 검증: 후보 수, 지난 후보, 중복, 마감, 개인 팀, 대상은 멤버만, 진행 중 10개 상한', async () => {
    const field = async (body: Record<string, unknown>, gid = groupId) => (await create(minji, body, gid).expect(400)).body.error as { code: string; details: { field: string }[] };
    expect((await field({ title: '저녁', options: [range(2, 19)] })).details[0].field).toBe('options');
    expect((await field({ title: '저녁', options: [range(2, 19), range(-1, 12)] })).details[0].field).toBe('options');
    expect((await field({ title: '저녁', options: [range(2, 19), range(2, 19)] })).details[0].field).toBe('options');
    expect((await field({ title: '저녁', options: [range(2, 19), range(3, 12)], deadline: new Date(Date.now() - 1000).toISOString() })).details[0].field).toBe('deadline');
    expect((await field({ title: '', options: [range(2, 19), range(3, 12)] })).details[0].field).toBe('title');
    expect((await field({ title: '저녁', options: [{ ...range(2, 19), startsAt: '2030-01-01T10:00:00' }, range(3, 12)] })).details[0].field).toBe('options.0.startsAt');
    expect((await field({ title: '저녁', options: [range(2, 19), range(3, 12)], participants: [outsider.userId] })).details[0].field).toBe('participants');
    const personal = (await api(app).get('/v1/groups').set(auth(minji)).expect(200)).body.data.find((g: { type: string }) => g.type === 'PERSONAL');
    expect((await field({ title: '저녁', options: [range(2, 19), range(3, 12)] }, personal.id)).code).toBe('VALIDATION_FAILED');

    const allDay = await create(minji, {
      title: '여행',
      options: [
        { startsAt: kstAt(5, 0).toISOString(), endsAt: kstAt(6, 0).toISOString(), allDay: true },
        { startsAt: kstAt(7, 0).toISOString(), endsAt: kstAt(9, 0).toISOString(), allDay: true },
      ],
    }).expect(201);
    expect(allDay.body.data.options.map((o: { allDay: boolean }) => o.allDay)).toEqual([true, true]);
    for (let i = 1; i < 10; i += 1) await open(minji, { title: `투표 ${i}` });
    const over = await create(minji, { title: '열한 번째', options: [range(2, 19), range(3, 12)] }).expect(400);
    expect(over.body.message).toBe('진행 중인 투표가 너무 많아요');
  });

  it('표 전체 교체와 결과, 대상 밖은 NOT_PARTICIPANT, 남의 후보 400, 진행 중 목록 요약', async () => {
    const poll = await open(minji, { participants: [minji.userId, jihun.userId] });
    const [a, b, c] = poll.options.map((o) => o.id);
    let res = (await vote(jihun, poll.id, [a, b]).expect(200)).body.data as PollBody;
    expect(res.myVotes).toEqual([a, b]);
    res = (await vote(jihun, poll.id, [c]).expect(200)).body.data as PollBody;
    expect(res.myVotes).toEqual([c]);
    expect(res.options.map((o) => o.voters.map((v) => v.userId))).toEqual([[], [], [jihun.userId]]);
    const denied = await vote(seoyeon, poll.id, [a]).expect(403);
    expect(denied.body.error.code).toBe('NOT_PARTICIPANT');
    expect((await api(app).get(`/v1/polls/${poll.publicCode}`).set(auth(seoyeon)).expect(200)).body.data.canVote).toBe(false);
    await vote(jihun, poll.id, [999999]).expect(400);

    const list = (await api(app).get(`/v1/groups/${groupId}/polls`).set(auth(minji)).expect(200)).body.data;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: poll.id, voterCount: 1, targetCount: 2, votedByMe: false, allPast: false, status: 'OPEN' });
    await api(app).get(`/v1/groups/${groupId}/polls?status=bad`).set(auth(minji)).expect(400);
  });

  it('지난 후보: 새로 켤 수도 정할 수도 없다. 켜 둔 지난 후보 표는 남는다', async () => {
    const poll = await open(minji);
    const [a, b] = poll.options.map((o) => o.id);
    await vote(jihun, poll.id, [a, b]).expect(200);
    await prisma.pollOption.update({ where: { id: a }, data: { startsAt: new Date(Date.now() - HOUR) } });
    const kept = (await vote(jihun, poll.id, [b]).expect(200)).body.data as PollBody;
    expect(kept.myVotes).toEqual([a, b]);
    expect(kept.options[0].past).toBe(true);
    expect((await vote(seoyeon, poll.id, [a]).expect(400)).body.error.code).toBe('POLL_OPTION_PAST');
    expect((await confirm(minji, poll.id, a).expect(400)).body.error.code).toBe('POLL_OPTION_PAST');
  });

  it('정하기: 일정(제목, 시각, 참여자, 알림 없음) + CLOSED 를 한 번에. 새 소식은 POLL_CLOSED 한 줄, 알림은 투표 문구 1건', async () => {
    const poll = await open(minji, { participants: [minji.userId, jihun.userId] });
    await scheduler.tick(new Date());
    expect(fake.messages.map((m) => m.to).sort()).toEqual(['ExponentPushToken[jihun]']);
    expect(fake.messages[0]).toMatchObject({ title: "민지님이 '저녁 약속' 시간을 묻고 있어요", data: { kind: 'POLL', url: `/polls/${poll.publicCode}?team=${groupCode}` } });
    fake.reset();

    const option = poll.options[1];
    const res = (await confirm(jihun, poll.id, option.id).expect(201)).body.data;
    expect(res.warning).toBeNull();
    expect(res.poll).toMatchObject({ status: 'CLOSED', decidedOptionId: option.id, eventId: res.event.id, eventCode: res.event.publicCode });
    expect(res.event).toMatchObject({ title: '저녁 약속', startsAt: option.startsAt, allDay: false, reminder: 'NONE', participants: { all: false } });
    expect(res.event.participants.members.map((m: { userId: number }) => m.userId)).toEqual([minji.userId, jihun.userId]);

    const items = await news(minji);
    expect(items.filter((i) => i.kind === 'EVENT')).toEqual([]);
    expect(items[0]).toMatchObject({ kind: 'ACTIVITY', type: 'POLL_CLOSED', payload: { pollId: poll.id, eventCode: res.event.publicCode, title: '저녁 약속' } });
    expect(items.map((i) => i.type)).not.toContain('POLL_CREATED'); // 민지 자신이 연 기록은 민지에게 안 보인다
    expect((await news(seoyeon)).map((i) => i.type)).toEqual(['POLL_CLOSED', 'POLL_CREATED']);
    const groups = (await api(app).get('/v1/groups').set(auth(seoyeon)).expect(200)).body.data;
    // 서연이 들어온 뒤: 투표 열림 + 정함 (정해서 생긴 일정 CREATED 로그는 세지 않는다)
    expect(groups.find((g: { id: number }) => g.id === groupId).unreadNewsCount).toBe(2);
    const kinds = await prisma.pushNotification.findMany({ where: { status: 'PENDING' }, select: { kind: true, dedupeKey: true } });
    expect(kinds).toEqual([{ kind: 'POLL', dedupeKey: `PC:${poll.id}` }]);

    await scheduler.tick(new Date());
    expect(fake.messages.map((m) => m.to)).toEqual(['ExponentPushToken[minji]']);
    expect(fake.messages[0]).toMatchObject({ title: "지훈님이 '저녁 약속' 시간을 정했어요", data: { url: `/events/${res.event.publicCode}?team=${groupCode}` } });

    // 닫힌 뒤에는 표, 정하기, 취소 모두 409
    expect((await vote(jihun, poll.id, []).expect(409)).body.error.code).toBe('POLL_CLOSED');
    await confirm(minji, poll.id, poll.options[0].id).expect(409);
    await api(app).delete(`/v1/groups/${groupId}/polls/${poll.id}`).set(auth(minji)).expect(409);
    expect((await api(app).get(`/v1/groups/${groupId}/polls?status=closed`).set(auth(minji)).expect(200)).body.data[0]).toMatchObject({ id: poll.id, status: 'CLOSED' });

    // 일정을 지우면 투표의 eventId 가 비고 그대로 닫혀 있다
    await api(app).delete(`/v1/groups/${groupId}/events/${res.event.id}`).set(auth(minji)).expect(200);
    expect((await api(app).get(`/v1/polls/${poll.publicCode}`).set(auth(minji)).expect(200)).body.data).toMatchObject({ status: 'CLOSED', eventId: null, eventCode: null });
  });

  it('동시에 정하면 하나만 성공하고 나머지는 409 POLL_CLOSED, 일정은 하나', async () => {
    const poll = await open(minji);
    const results = await Promise.all([confirm(minji, poll.id, poll.options[0].id), confirm(jihun, poll.id, poll.options[1].id), confirm(seoyeon, poll.id, poll.options[2].id)]);
    expect(results.map((r) => r.status).sort((x, y) => x - y)).toEqual([201, 409, 409]);
    expect(await prisma.event.count({ where: { groupId } })).toBe(1);
    expect(await prisma.groupActivity.count({ where: { groupId, type: 'POLL_CLOSED' } })).toBe(1);
  });

  it('정하기 직전 대상 중 누가 그 시간에 바빠졌으면 warning BUSY_NOW 를 싣고 정한다 (다른 팀 일정 포함)', async () => {
    const poll = await open(minji);
    const option = poll.options[0];
    const personal = (await api(app).get('/v1/groups').set(auth(seoyeon)).expect(200)).body.data.find((g: { type: string }) => g.type === 'PERSONAL');
    await api(app)
      .post(`/v1/groups/${personal.id}/events`)
      .set(auth(seoyeon))
      .send({ title: '병원', startsAt: option.startsAt, endsAt: new Date(Date.parse(option.startsAt) + HOUR).toISOString(), allDay: false })
      .expect(201);
    const res = await confirm(jihun, poll.id, option.id).expect(201);
    expect(res.body.data.warning).toBe('BUSY_NOW');
    expect(res.body.data.poll.status).toBe('CLOSED');
  });

  it('마감: 지나면 표를 받지 않고(정하기는 된다) 틱이 연 사람에게 한 번만. 10분 넘게 늦게 집으면 SKIPPED', async () => {
    const poll = await open(minji, { deadline: new Date(Date.now() + HOUR).toISOString() });
    const late = await open(minji, { title: '늦은 마감', deadline: new Date(Date.now() + HOUR).toISOString() });
    await prisma.pushNotification.updateMany({ where: { status: 'PENDING' }, data: { status: 'SKIPPED' } });
    const now = new Date();
    await prisma.poll.update({ where: { id: poll.id }, data: { deadline: new Date(now.getTime() - 60_000) } });
    await prisma.poll.update({ where: { id: late.id }, data: { deadline: new Date(now.getTime() - 15 * 60_000) } });

    const expired = await vote(jihun, poll.id, [poll.options[0].id]).expect(409);
    expect(expired.body).toMatchObject({ message: '투표가 끝났어요', error: { code: 'POLL_CLOSED' } });
    expect((await api(app).get(`/v1/polls/${poll.publicCode}`).set(auth(jihun)).expect(200)).body.data.expired).toBe(true);

    const first = await scheduler.tick(now);
    expect(first.polls).toBe(2);
    expect(fake.messages.map((m) => [m.to, m.title])).toEqual([['ExponentPushToken[minji]', "'저녁 약속' 투표가 끝났어요"]]);
    expect(await prisma.pushNotification.findUnique({ where: { dedupeKey: `PD:${late.id}` } })).toMatchObject({ status: 'SKIPPED' });
    expect((await scheduler.tick(new Date(now.getTime() + 30_000))).polls).toBe(0);
    expect(fake.messages).toHaveLength(1);
    await confirm(minji, poll.id, poll.options[0].id).expect(201);
  });

  it('취소: 진행 중만 지우고 "투표를 열었어요" 기록도 지운다. 열림 알림은 보내지 않는다', async () => {
    const poll = await open(minji);
    expect((await news(jihun)).map((i) => i.type)).toContain('POLL_CREATED');
    await api(app).delete(`/v1/groups/${groupId}/polls/${poll.id}`).set(auth(jihun)).expect(200);
    expect((await news(jihun)).map((i) => i.type)).not.toContain('POLL_CREATED');
    await api(app).get(`/v1/polls/${poll.publicCode}`).set(auth(minji)).expect(404);
    await scheduler.tick(new Date());
    expect(fake.messages).toEqual([]);
    expect(await prisma.pushNotification.findUnique({ where: { dedupeKey: `PO:${poll.id}` } })).toMatchObject({ status: 'SKIPPED' });
  });

  it('나가기는 그 팀 투표의 내 표와 대상 행을 지우고, 탈퇴는 Cascade', async () => {
    const poll = await open(minji, { participants: [minji.userId, jihun.userId, seoyeon.userId] });
    await vote(jihun, poll.id, [poll.options[0].id]).expect(200);
    await vote(seoyeon, poll.id, [poll.options[0].id]).expect(200);
    await api(app).delete(`/v1/groups/${groupId}/me`).set(auth(jihun)).expect(200);
    expect(await prisma.pollVote.count({ where: { userId: jihun.userId } })).toBe(0);
    expect(await prisma.pollParticipant.count({ where: { userId: jihun.userId } })).toBe(0);
    await api(app).delete('/v1/me').set(auth(seoyeon)).expect(200);
    expect(await prisma.pollVote.count({ where: { userId: seoyeon.userId } })).toBe(0);
    const view = (await api(app).get(`/v1/polls/${poll.publicCode}`).set(auth(minji)).expect(200)).body.data;
    expect(view.participants.members.map((m: { userId: number }) => m.userId)).toEqual([minji.userId]);
    await api(app).delete('/v1/me').set(auth(minji)).expect(200);
    expect(await prisma.poll.count({ where: { id: poll.id } })).toBe(0);
  });

  it('알림 설정 poll 을 끄면 투표 알림을 받지 않는다', async () => {
    await api(app).patch('/v1/me/notification-settings').set(auth(jihun)).send({ poll: false }).expect(200);
    await open(minji);
    await scheduler.tick(new Date());
    expect(fake.messages.map((m) => m.to)).toEqual(['ExponentPushToken[seoyeon]']);
  });

  it('후보 시각은 일정 길이 상한(30일)을 넘을 수 없다', async () => {
    const res = await create(minji, {
      title: '긴 여행',
      options: [range(2, 19), { startsAt: kstAt(2, 0).toISOString(), endsAt: new Date(kstAt(2, 0).getTime() + 31 * DAY).toISOString(), allDay: true }],
    }).expect(400);
    expect(res.body.message).toBe('후보는 최대 30일까지 잡을 수 있어요');
  });
});
