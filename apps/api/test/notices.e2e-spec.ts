import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  api,
  auth,
  createTestApp,
  devLogin,
  resetDb,
  Session,
  TestApp,
} from './helpers.js';

/**
 * (#515) 공지사항과 관리자 사용자 관리 (api.md 2.16, D-285).
 * 공개 읽기(익명), 초안은 관리자만, 정렬과 페이지, unread 와 seen, GET /me 의 역할과 점, 관리자 가드(403/200), 내 역할 변경 거부, 사용자 검색과 페이지, 조치 기록
 */
describe('공지사항, 관리자 (e2e, #515)', () => {
  let app: TestApp;
  let prisma: PrismaService;
  let admin: Session;
  let user: Session;

  const create = async (body: Record<string, unknown>) =>
    (
      await api(app)
        .post('/v1/admin/notices')
        .set(auth(admin))
        .send({ kind: 'notice', body: '본문', ...body })
        .expect(201)
    ).body.data as { id: number; publishedAt: string | null };
  const me = async (who: Session) =>
    (await api(app).get('/v1/me').set(auth(who)).expect(200)).body
      .data as Record<string, unknown>;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    await resetDb(app);
    admin = await devLogin(app, '운영자');
    user = await devLogin(app, '사용자');
    // 첫 관리자는 운영자가 SQL 로 지정한다 (D-285). 테스트는 같은 일을 Prisma 로
    await prisma.user.update({
      where: { id: admin.userId },
      data: { role: 'admin' },
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('관리자 엔드포인트: 익명 401, 일반 사용자 403, 관리자 200', async () => {
    await api(app).get('/v1/admin/notices').expect(401);
    for (const path of [
      '/v1/admin/notices',
      '/v1/admin/users',
      '/v1/admin/logs',
    ]) {
      const res = await api(app).get(path).set(auth(user)).expect(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
      await api(app).get(path).set(auth(admin)).expect(200);
    }
    await api(app)
      .post('/v1/admin/notices')
      .set(auth(user))
      .send({ title: 't', body: 'b', kind: 'notice' })
      .expect(403);
    await api(app)
      .patch(`/v1/admin/users/${admin.userId}/role`)
      .set(auth(user))
      .send({ role: 'user' })
      .expect(403);
  });

  it('GET /me: role, isAdmin, hasUnreadNotice', async () => {
    expect(await me(admin)).toMatchObject({
      role: 'admin',
      isAdmin: true,
      hasUnreadNotice: false,
    });
    expect(await me(user)).toMatchObject({
      role: 'user',
      isAdmin: false,
      hasUnreadNotice: false,
    });
  });

  it('작성 검증: 제목 1~100자(잘린 길이), kind 값, 모르는 필드 400', async () => {
    await api(app)
      .post('/v1/admin/notices')
      .set(auth(admin))
      .send({ title: '   ', body: 'b', kind: 'notice' })
      .expect(400);
    await api(app)
      .post('/v1/admin/notices')
      .set(auth(admin))
      .send({ title: 'x'.repeat(101), body: 'b', kind: 'notice' })
      .expect(400);
    await api(app)
      .post('/v1/admin/notices')
      .set(auth(admin))
      .send({ title: 't', body: 'b', kind: 'event' })
      .expect(400);
    await api(app)
      .post('/v1/admin/notices')
      .set(auth(admin))
      .send({ title: 't', body: 'b', kind: 'notice', createdById: 1 })
      .expect(400);
  });

  it('공개 목록: 게시된 것만, 고정 먼저 게시 시각 내림차순, 익명 unread false, 페이지 넘김', async () => {
    const old = await create({ title: '오래된 공지', published: true });
    await prisma.notice.update({
      where: { id: old.id },
      data: { publishedAt: new Date('2026-01-01T00:00:00.000Z') },
    });
    const pinned = await create({
      title: '고정 업데이트',
      kind: 'update',
      pinned: true,
      published: true,
    });
    await prisma.notice.update({
      where: { id: pinned.id },
      data: { publishedAt: new Date('2026-02-01T00:00:00.000Z') },
    });
    const fresh = await create({
      title: '점검 안내',
      kind: 'maintenance',
      published: true,
    });
    const draft = await create({ title: '초안' });
    expect(draft.publishedAt).toBeNull();

    const anon = await api(app).get('/v1/notices').expect(200);
    expect(anon.body.data.items.map((item: { id: number }) => item.id)).toEqual(
      [pinned.id, fresh.id, old.id],
    );
    expect(
      anon.body.data.items.every(
        (item: { unread: boolean }) => item.unread === false,
      ),
    ).toBe(true);
    expect(anon.body.data.items[0]).not.toHaveProperty('body');
    expect(anon.body.data.nextCursor).toBeNull();

    const first = await api(app).get('/v1/notices?limit=2').expect(200);
    expect(
      first.body.data.items.map((item: { id: number }) => item.id),
    ).toEqual([pinned.id, fresh.id]);
    expect(first.body.data.nextCursor).toBe(fresh.id);
    const second = await api(app)
      .get(`/v1/notices?limit=2&cursor=${fresh.id}`)
      .expect(200);
    expect(
      second.body.data.items.map((item: { id: number }) => item.id),
    ).toEqual([old.id]);
    expect(second.body.data.nextCursor).toBeNull();
    await api(app).get('/v1/notices?limit=0').expect(400);

    // 관리자 목록은 초안 포함
    const all = await api(app)
      .get('/v1/admin/notices')
      .set(auth(admin))
      .expect(200);
    expect(all.body.data.items.map((item: { id: number }) => item.id)).toEqual([
      draft.id,
      fresh.id,
      pinned.id,
      old.id,
    ]);

    // 상세: 게시는 익명도, 초안은 관리자만
    const detail = await api(app).get(`/v1/notices/${fresh.id}`).expect(200);
    expect(detail.body.data).toMatchObject({
      title: '점검 안내',
      body: '본문',
      kind: 'maintenance',
    });
    await api(app).get(`/v1/notices/${draft.id}`).expect(404);
    await api(app).get(`/v1/notices/${draft.id}`).set(auth(user)).expect(404);
    await api(app).get(`/v1/notices/${draft.id}`).set(auth(admin)).expect(200);
    await api(app).get('/v1/notices/999999').expect(404);
  });

  it('unread 와 seen: 본 뒤에는 점이 사라지고, 새로 게시하면 다시 생긴다', async () => {
    expect(await me(user)).toMatchObject({ hasUnreadNotice: true });
    const before = await api(app)
      .get('/v1/notices')
      .set(auth(user))
      .expect(200);
    expect(
      before.body.data.items.every((item: { unread: boolean }) => item.unread),
    ).toBe(true);

    await api(app).post('/v1/notices/seen').expect(401);
    const seen = await api(app)
      .post('/v1/notices/seen')
      .set(auth(user))
      .expect(200);
    expect(typeof seen.body.data.noticesSeenAt).toBe('string');
    expect(await me(user)).toMatchObject({ hasUnreadNotice: false });
    const after = await api(app).get('/v1/notices').set(auth(user)).expect(200);
    expect(
      after.body.data.items.some((item: { unread: boolean }) => item.unread),
    ).toBe(false);

    const drafts = await api(app)
      .get('/v1/admin/notices')
      .set(auth(admin))
      .expect(200);
    const draft = drafts.body.data.items.find(
      (item: { publishedAt: string | null }) => item.publishedAt === null,
    ) as { id: number };
    const published = await api(app)
      .patch(`/v1/admin/notices/${draft.id}`)
      .set(auth(admin))
      .send({ published: true })
      .expect(200);
    expect(published.body.data.publishedAt).not.toBeNull();
    expect(await me(user)).toMatchObject({ hasUnreadNotice: true });
    const list = await api(app).get('/v1/notices').set(auth(user)).expect(200);
    expect(
      list.body.data.items
        .filter((item: { unread: boolean }) => item.unread)
        .map((item: { id: number }) => item.id),
    ).toEqual([draft.id]);

    // 이미 게시된 공지를 다시 published: true 로 고쳐도 게시 시각은 그대로, false 는 초안으로
    const again = await api(app)
      .patch(`/v1/admin/notices/${draft.id}`)
      .set(auth(admin))
      .send({ published: true, title: '고친 제목' })
      .expect(200);
    expect(again.body.data).toMatchObject({
      title: '고친 제목',
      publishedAt: published.body.data.publishedAt,
    });
    const unpublished = await api(app)
      .patch(`/v1/admin/notices/${draft.id}`)
      .set(auth(admin))
      .send({ published: false })
      .expect(200);
    expect(unpublished.body.data.publishedAt).toBeNull();
    await api(app).get(`/v1/notices/${draft.id}`).expect(404);

    await api(app)
      .delete(`/v1/admin/notices/${draft.id}`)
      .set(auth(admin))
      .expect(200);
    await api(app)
      .delete(`/v1/admin/notices/${draft.id}`)
      .set(auth(admin))
      .expect(404);
    await api(app)
      .patch('/v1/admin/notices/999999')
      .set(auth(admin))
      .send({ title: 'x' })
      .expect(404);
  });

  it('사용자 목록: 최근 가입 먼저, 닉네임 검색, 페이지 넘김, 로그인 방법', async () => {
    const extra = [];
    for (const name of ['하늘', '하늘색', '바다'])
      extra.push(await devLogin(app, name));
    const all = await api(app)
      .get('/v1/admin/users')
      .set(auth(admin))
      .expect(200);
    expect(
      all.body.data.items.map((item: { nickname: string }) => item.nickname),
    ).toEqual(['바다', '하늘색', '하늘', '사용자', '운영자']);
    expect(all.body.data.items[0]).toMatchObject({
      role: 'user',
      profileImageUrl: null,
      providers: ['DEV'],
    });
    expect(all.body.data.items[4]).toMatchObject({ role: 'admin' });

    const search = await api(app)
      .get(`/v1/admin/users?q=${encodeURIComponent(' 하늘 ')}`)
      .set(auth(admin))
      .expect(200);
    expect(
      search.body.data.items.map((item: { nickname: string }) => item.nickname),
    ).toEqual(['하늘색', '하늘']);

    const first = await api(app)
      .get('/v1/admin/users?limit=2')
      .set(auth(admin))
      .expect(200);
    expect(first.body.data.items).toHaveLength(2);
    expect(first.body.data.nextCursor).toBe(extra[1].userId);
    const second = await api(app)
      .get(`/v1/admin/users?limit=2&cursor=${first.body.data.nextCursor}`)
      .set(auth(admin))
      .expect(200);
    expect(
      second.body.data.items.map((item: { nickname: string }) => item.nickname),
    ).toEqual(['하늘', '사용자']);
  });

  it('역할 바꾸기: 내 역할은 403, 다른 사람은 바뀌고 바로 반영, 없는 사용자 404, 잘못된 값 400', async () => {
    const self = await api(app)
      .patch(`/v1/admin/users/${admin.userId}/role`)
      .set(auth(admin))
      .send({ role: 'user' })
      .expect(403);
    expect(self.body.message).toBe('내 역할은 바꿀 수 없어요');
    await api(app)
      .patch(`/v1/admin/users/${user.userId}/role`)
      .set(auth(admin))
      .send({ role: 'owner' })
      .expect(400);
    await api(app)
      .patch('/v1/admin/users/999999/role')
      .set(auth(admin))
      .send({ role: 'admin' })
      .expect(404);

    const promoted = await api(app)
      .patch(`/v1/admin/users/${user.userId}/role`)
      .set(auth(admin))
      .send({ role: 'admin' })
      .expect(200);
    expect(promoted.body.data).toMatchObject({
      id: user.userId,
      role: 'admin',
    });
    // 역할은 매 요청 DB 에서 읽으므로 같은 토큰으로 바로 관리자
    await api(app).get('/v1/admin/notices').set(auth(user)).expect(200);
    await api(app)
      .patch(`/v1/admin/users/${user.userId}/role`)
      .set(auth(admin))
      .send({ role: 'user' })
      .expect(200);
    await api(app).get('/v1/admin/notices').set(auth(user)).expect(403);
  });

  it('조치 기록: 관리자 변경마다 한 줄, 최근 것 먼저', async () => {
    const logs = await api(app)
      .get('/v1/admin/logs?limit=50')
      .set(auth(admin))
      .expect(200);
    const actions = logs.body.data.items.map(
      (item: { action: string }) => item.action,
    );
    expect(actions.slice(0, 2)).toEqual(['user_role', 'user_role']);
    expect(actions).toEqual(
      expect.arrayContaining([
        'notice_create',
        'notice_update',
        'notice_delete',
      ]),
    );
    expect(logs.body.data.items[0]).toMatchObject({
      targetType: 'user',
      targetId: user.userId,
      reason: 'user',
      admin: { id: admin.userId, nickname: '운영자' },
    });
  });

  it('탈퇴: 공지를 쓴 관리자가 탈퇴해도 공지와 기록은 남는다 (작성자 null)', async () => {
    const other = await devLogin(app, '임시관리자');
    await prisma.user.update({
      where: { id: other.userId },
      data: { role: 'admin' },
    });
    const n = (
      await api(app)
        .post('/v1/admin/notices')
        .set(auth(other))
        .send({
          title: '남는 공지',
          body: 'b',
          kind: 'notice',
          published: true,
        })
        .expect(201)
    ).body.data as { id: number };
    await api(app).delete('/v1/me').set(auth(other)).expect(200);
    const row = await prisma.notice.findUniqueOrThrow({ where: { id: n.id } });
    expect(row.createdById).toBeNull();
    const log = await prisma.adminAction.findFirstOrThrow({
      where: { targetId: n.id, action: 'notice_create' },
    });
    expect(log.adminId).toBeNull();
  });
});
