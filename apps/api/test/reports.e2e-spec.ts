import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  api,
  auth,
  createTestApp,
  devLogin,
  resetDb,
  type Session,
  type TestApp,
} from './helpers.js';

/**
 * (#536) 신고하기와 관리자 신고 탭 (api.md 2.18, D-289).
 * 볼 수 있는 대상만 신고, 나와 내 것은 403, 접수 중 같은 대상은 새로 만들지 않고 200, 관리자는 대상별 묶음으로 보고
 * 처리 완료, 기각은 그 대상의 접수 중 신고를 한꺼번에 닫는다. 숨기기, 삭제도 닫는다
 */
describe('신고하기 (e2e, #536)', () => {
  let app: TestApp;
  let prisma: PrismaService;
  let admin: Session;
  let alice: Session;
  let bob: Session;
  let carol: Session;
  let groupId: number;
  let alicePersonalId: number;
  let eventId: number;
  let hiddenEventId: number;

  const report = (who: Session, body: Record<string, unknown>) =>
    api(app).post('/v1/reports').set(auth(who)).send(body);

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    await resetDb(app);
    admin = await devLogin(app, '운영자');
    alice = await devLogin(app, '앨리스');
    bob = await devLogin(app, '밥');
    carol = await devLogin(app, '캐롤');
    await prisma.user.update({
      where: { id: admin.userId },
      data: { role: 'admin' },
    });
    const team = await api(app)
      .post('/v1/groups')
      .set(auth(alice))
      .send({ name: '광고 모임' })
      .expect(201);
    groupId = team.body.data.id;
    await api(app)
      .post('/v1/groups/join')
      .set(auth(bob))
      .send({ code: team.body.data.inviteCode })
      .expect(200);
    await api(app)
      .post('/v1/groups/join')
      .set(auth(admin))
      .send({ code: team.body.data.inviteCode })
      .expect(200);
    const create = async (title: string) =>
      (
        await api(app)
          .post(`/v1/groups/${groupId}/events`)
          .set(auth(alice))
          .send({
            title,
            allDay: false,
            startsAt: '2027-03-10T19:00:00+09:00',
            endsAt: '2027-03-10T21:00:00+09:00',
          })
          .expect(201)
      ).body.data.id as number;
    eventId = await create('수상한 광고');
    hiddenEventId = await create('이미 숨김');
    await api(app)
      .post(`/v1/admin/events/${hiddenEventId}/hide`)
      .set(auth(admin))
      .send({ reason: '먼저 숨김' })
      .expect(200);
    alicePersonalId = (
      await prisma.membership.findFirstOrThrow({
        where: { userId: alice.userId, group: { type: 'PERSONAL' } },
      })
    ).groupId;
  });

  afterAll(async () => {
    await resetDb(app);
    await app.close();
  });

  it('일정 신고: 201, 같은 대상을 접수 중에 다시 하면 새로 만들지 않고 200 (duplicate)', async () => {
    const first = await report(bob, {
      targetType: 'event',
      targetId: eventId,
      reason: 'spam',
      detail: '  광고 링크  ',
    }).expect(201);
    expect(first.body.data).toMatchObject({
      targetType: 'event',
      targetId: eventId,
      reason: 'spam',
      status: 'open',
      duplicate: false,
    });
    const again = await report(bob, {
      targetType: 'event',
      targetId: eventId,
      reason: 'abuse',
    }).expect(200);
    expect(again.body.data).toMatchObject({
      id: first.body.data.id,
      reason: 'spam',
      duplicate: true,
    });
    const rows = await prisma.report.findMany({
      where: { targetType: 'event', targetId: eventId },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      reporterId: bob.userId,
      detail: '광고 링크',
    });
  });

  it('권한: 멤버가 아니면 404, 내가 만든 일정은 403, 숨긴 일정은 404', async () => {
    expect(
      (
        await report(carol, {
          targetType: 'event',
          targetId: eventId,
          reason: 'spam',
        }).expect(404)
      ).body.error.code,
    ).toBe('NOT_FOUND');
    expect(
      (
        await report(alice, {
          targetType: 'event',
          targetId: eventId,
          reason: 'spam',
        }).expect(403)
      ).body.message,
    ).toBe('내가 만든 일정은 신고할 수 없어요');
    await report(bob, {
      targetType: 'event',
      targetId: hiddenEventId,
      reason: 'spam',
    }).expect(404);
    await report(bob, {
      targetType: 'event',
      targetId: 999_999,
      reason: 'spam',
    }).expect(404);
  });

  it('팀과 사용자: 멤버인 팀, 같은 팀 사람만. 개인 달력과 나 자신은 403', async () => {
    await report(bob, {
      targetType: 'group',
      targetId: groupId,
      reason: 'illegal',
    }).expect(201);
    await report(carol, {
      targetType: 'group',
      targetId: groupId,
      reason: 'illegal',
    }).expect(404);
    expect(
      (
        await report(alice, {
          targetType: 'group',
          targetId: alicePersonalId,
          reason: 'spam',
        }).expect(403)
      ).body.message,
    ).toBe('내 개인 달력은 신고할 수 없어요');
    await report(bob, {
      targetType: 'group',
      targetId: alicePersonalId,
      reason: 'spam',
    }).expect(404);
    await report(bob, {
      targetType: 'user',
      targetId: alice.userId,
      reason: 'abuse',
      detail: '욕설',
    }).expect(201);
    expect(
      (
        await report(bob, {
          targetType: 'user',
          targetId: bob.userId,
          reason: 'abuse',
        }).expect(403)
      ).body.message,
    ).toBe('나를 신고할 수는 없어요');
    await report(carol, {
      targetType: 'user',
      targetId: alice.userId,
      reason: 'abuse',
    }).expect(404);
  });

  it('입력 검사: 사유와 종류는 정해진 값, 자세한 내용 500자, 모르는 필드는 400', async () => {
    const bad = async (body: Record<string, unknown>, field: string) => {
      const res = await report(bob, body).expect(400);
      expect(res.body.error.details[0].field).toBe(field);
    };
    await bad(
      { targetType: 'event', targetId: eventId, reason: 'boring' },
      'reason',
    );
    await bad(
      { targetType: 'poll', targetId: eventId, reason: 'spam' },
      'targetType',
    );
    await bad(
      { targetType: 'event', targetId: '1', reason: 'spam' },
      'targetId',
    );
    await bad(
      {
        targetType: 'event',
        targetId: eventId,
        reason: 'spam',
        detail: 'x'.repeat(501),
      },
      'detail',
    );
    await bad(
      {
        targetType: 'event',
        targetId: eventId,
        reason: 'spam',
        status: 'resolved',
      },
      'status',
    );
    await api(app)
      .post('/v1/reports')
      .send({ targetType: 'event', targetId: eventId, reason: 'spam' })
      .expect(401);
  });

  it('관리자 목록: 대상별 묶음(수, 사유, 처음과 마지막, 대상 이름). 관리자만', async () => {
    // 운영자도 같은 팀 멤버라 신고할 수 있다 (사유가 다른 두 번째 신고)
    await report(admin, {
      targetType: 'event',
      targetId: eventId,
      reason: 'abuse',
    }).expect(201);
    await api(app).get('/v1/admin/reports').set(auth(bob)).expect(403);
    const res = await api(app)
      .get('/v1/admin/reports')
      .query({ status: 'open' })
      .set(auth(admin))
      .expect(200);
    const items = res.body.data.items as {
      targetType: string;
      targetId: number;
      count: number;
      openCount: number;
      reasons: unknown;
      target: unknown;
      status: string;
    }[];
    // 가장 최근 신고가 늦은 대상 먼저: 일정(운영자) → 사용자 → 팀
    expect(items.map((i) => `${i.targetType}:${i.targetId}`)).toEqual([
      `event:${eventId}`,
      `user:${alice.userId}`,
      `group:${groupId}`,
    ]);
    expect(items[0]).toMatchObject({
      count: 2,
      openCount: 2,
      status: 'open',
      reasons: [
        { reason: 'abuse', count: 1 },
        { reason: 'spam', count: 1 },
      ],
      target: {
        title: '수상한 광고',
        hidden: false,
        group: { id: groupId, name: '광고 모임', type: 'TEAM' },
      },
    });
    expect(items[1].target).toEqual({
      title: '앨리스',
      hidden: false,
      group: null,
    });
    const page = await api(app)
      .get('/v1/admin/reports')
      .query({ status: 'open', limit: 2 })
      .set(auth(admin))
      .expect(200);
    expect(page.body.data.items).toHaveLength(2);
    const next = await api(app)
      .get('/v1/admin/reports')
      .query({ status: 'open', limit: 2, cursor: page.body.data.nextCursor })
      .set(auth(admin))
      .expect(200);
    expect(
      next.body.data.items.map((i: { targetType: string }) => i.targetType),
    ).toEqual(['group']);
    expect(next.body.data.nextCursor).toBeNull();
    const users = await api(app)
      .get('/v1/admin/reports')
      .query({ targetType: 'user' })
      .set(auth(admin))
      .expect(200);
    expect(users.body.data.items).toHaveLength(1);
    await api(app)
      .get('/v1/admin/reports')
      .query({ status: 'closed' })
      .set(auth(admin))
      .expect(400);
    expect(
      (
        await api(app)
          .get('/v1/admin/reports/open-count')
          .set(auth(admin))
          .expect(200)
      ).body.data,
    ).toEqual({ openTargets: 3 });
  });

  it('대상 상세: 신고 목록과 미리 보기(일정 상세 모양). 신고 없는 대상은 404', async () => {
    const res = await api(app)
      .get(`/v1/admin/reports/targets/event/${eventId}`)
      .set(auth(admin))
      .expect(200);
    expect(res.body.data).toMatchObject({
      targetType: 'event',
      targetId: eventId,
      openCount: 2,
      target: {
        type: 'event',
        event: { id: eventId, title: '수상한 광고', memo: null },
      },
    });
    expect(
      res.body.data.reports.map(
        (r: { reporter: { nickname: string } }) => r.reporter.nickname,
      ),
    ).toEqual(['운영자', '밥']);
    const user = await api(app)
      .get(`/v1/admin/reports/targets/user/${alice.userId}`)
      .set(auth(admin))
      .expect(200);
    expect(user.body.data.target.user.nickname).toBe('앨리스');
    expect(
      user.body.data.target.teams.map((t: { name: string }) => t.name),
    ).toEqual(['광고 모임']);
    await api(app)
      .get(`/v1/admin/reports/targets/event/${hiddenEventId}`)
      .set(auth(admin))
      .expect(404);
    await api(app)
      .get(`/v1/admin/reports/targets/poll/1`)
      .set(auth(admin))
      .expect(400);
  });

  it('처리 완료: 그 대상 접수 중 신고를 모두 닫고 기록 한 줄. 다시 신고하면 새 접수', async () => {
    const one = await prisma.report.findFirstOrThrow({
      where: { targetType: 'event', targetId: eventId },
    });
    await api(app)
      .post(`/v1/admin/reports/${one.id}/resolve`)
      .set(auth(admin))
      .send({ resolution: '' })
      .expect(400);
    const res = await api(app)
      .post(`/v1/admin/reports/${one.id}/resolve`)
      .set(auth(admin))
      .send({ resolution: '작성자에게 안내' })
      .expect(200);
    expect(res.body.data.openCount).toBe(0);
    expect(
      res.body.data.reports.every(
        (r: {
          status: string;
          resolution: string;
          resolvedBy: { id: number };
        }) =>
          r.status === 'resolved' &&
          r.resolution === '작성자에게 안내' &&
          r.resolvedBy.id === admin.userId,
      ),
    ).toBe(true);
    const logs = await prisma.adminAction.findMany({
      where: { action: 'report_resolve' },
    });
    expect(logs).toMatchObject([
      {
        targetType: 'event',
        targetId: eventId,
        reason: '작성자에게 안내',
        adminId: admin.userId,
      },
    ]);
    // 두 번째 처리는 바꿀 것이 없어 기록이 늘지 않는다
    await api(app)
      .post(`/v1/admin/reports/${one.id}/resolve`)
      .set(auth(admin))
      .send({ resolution: '다시' })
      .expect(200);
    expect(
      await prisma.adminAction.count({ where: { action: 'report_resolve' } }),
    ).toBe(1);
    // 닫힌 뒤 다시 신고하면 새 접수 (201)
    await report(bob, {
      targetType: 'event',
      targetId: eventId,
      reason: 'spam',
    }).expect(201);
    const resolved = await api(app)
      .get('/v1/admin/reports')
      .query({ status: 'resolved' })
      .set(auth(admin))
      .expect(200);
    expect(resolved.body.data.items).toMatchObject([
      { targetType: 'event', count: 2, status: 'open', openCount: 1 },
    ]);
  });

  it('기각: 메모 없이, 기록 report_dismiss. 없는 신고는 404', async () => {
    const one = await prisma.report.findFirstOrThrow({
      where: { targetType: 'user', targetId: alice.userId },
    });
    const res = await api(app)
      .post(`/v1/admin/reports/${one.id}/dismiss`)
      .set(auth(admin))
      .send({})
      .expect(200);
    expect(res.body.data.reports[0]).toMatchObject({
      status: 'dismissed',
      resolution: null,
    });
    expect(
      await prisma.adminAction.count({
        where: {
          action: 'report_dismiss',
          targetType: 'user',
          targetId: alice.userId,
        },
      }),
    ).toBe(1);
    await api(app)
      .post('/v1/admin/reports/999999/dismiss')
      .set(auth(admin))
      .send({})
      .expect(404);
    await api(app)
      .post(`/v1/admin/reports/${one.id}/dismiss`)
      .set(auth(bob))
      .send({})
      .expect(403);
  });

  it('숨기기는 그 대상의 접수 중 신고를 처리 완료로 닫는다 ("숨김: 사유")', async () => {
    await api(app)
      .post(`/v1/admin/groups/${groupId}/hide`)
      .set(auth(admin))
      .send({ reason: '불법 광고 팀' })
      .expect(200);
    const rows = await prisma.report.findMany({
      where: { targetType: 'group', targetId: groupId },
    });
    expect(rows).toMatchObject([
      {
        status: 'resolved',
        resolution: '숨김: 불법 광고 팀',
        resolvedById: admin.userId,
      },
    ]);
    expect(
      await prisma.adminAction.count({
        where: {
          action: 'report_resolve',
          targetType: 'group',
          targetId: groupId,
        },
      }),
    ).toBe(1);
    // 일정 삭제도 닫는다
    await api(app)
      .delete(`/v1/admin/events/${eventId}`)
      .set(auth(admin))
      .expect(200);
    expect(
      await prisma.report.count({
        where: { targetType: 'event', targetId: eventId, status: 'open' },
      }),
    ).toBe(0);
    // 지운 대상도 목록에 남고 이름은 null
    const all = await api(app)
      .get('/v1/admin/reports')
      .query({ targetType: 'event' })
      .set(auth(admin))
      .expect(200);
    expect(all.body.data.items[0]).toMatchObject({
      targetId: eventId,
      target: null,
      status: 'resolved',
    });
    expect(
      (
        await api(app)
          .get('/v1/admin/reports/open-count')
          .set(auth(admin))
          .expect(200)
      ).body.data,
    ).toEqual({ openTargets: 0 });
  });

  it('탈퇴하면 신고는 남고 신고한 사람만 비운다', async () => {
    await api(app).delete('/v1/me').set(auth(bob)).expect(200);
    const rows = await prisma.report.findMany({
      where: { targetType: 'group', targetId: groupId },
    });
    expect(rows[0].reporterId).toBeNull();
  });
});

describe('신고 하루 횟수 (e2e, #536)', () => {
  let app: TestApp;
  let now = Date.parse('2026-11-25T03:00:00.000Z');

  beforeAll(async () => {
    app = await createTestApp({ rateLimit: { now: () => now } });
    await resetDb(app);
  });

  afterAll(async () => {
    await resetDb(app);
    await app.close();
  });

  it('사용자당 하루 10번. 11번째는 429, 하루가 지나면 다시', async () => {
    const me = await devLogin(app, '신고왕');
    const send = () =>
      api(app)
        .post('/v1/reports')
        .set(auth(me))
        .send({ targetType: 'event', targetId: 999_999, reason: 'spam' });
    for (let i = 0; i < 10; i++) await send().expect(404);
    const res = await send().expect(429);
    expect(res.body.error.code).toBe('RATE_LIMITED');
    expect(res.body.error.details.retryAfterSec).toBeGreaterThan(86_000);
    now += 86_400_000;
    await send().expect(404);
  });
});
