import { PrismaService } from '../src/prisma/prisma.service.js';
import { api, auth, createTestApp, devLogin, resetDb, Session, TestApp } from './helpers.js';

/**
 * (#538) 중요 공지 팝업과 새 공지 띠 (api.md 2.16, D-291).
 * 관리자 popup 저장, GET /notices/attention 의 팝업(닫지 않은 최근 팝업 공지, 첫 문단)과 띠(본 시각 이후 최근 공지),
 * POST /notices/:id/dismiss 의 멱등, 다른 사용자와 분리, 초안과 없는 공지 404, 공지 삭제 시 기록도 지워짐
 */
describe('공지 팝업, 새 공지 띠 (e2e, #538)', () => {
  let app: TestApp;
  let prisma: PrismaService;
  let admin: Session;
  let user: Session;
  let other: Session;

  const create = async (body: Record<string, unknown>) =>
    (await api(app).post('/v1/admin/notices').set(auth(admin)).send({ kind: 'notice', body: '본문', ...body }).expect(201)).body.data as {
      id: number;
      popup: boolean;
      publishedAt: string | null;
    };
  const attention = async (who: Session) =>
    (await api(app).get('/v1/notices/attention').set(auth(who)).expect(200)).body.data as {
      popup: { id: number; title: string; kind: string; preview: string; publishedAt: string } | null;
      banner: { id: number; title: string } | null;
    };
  const setPublishedAt = (id: number, iso: string) => prisma.notice.update({ where: { id }, data: { publishedAt: new Date(iso) } });

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    await resetDb(app);
    admin = await devLogin(app, '운영자');
    user = await devLogin(app, '사용자');
    other = await devLogin(app, '다른 사용자');
    await prisma.user.update({ where: { id: admin.userId }, data: { role: 'admin' } });
  });

  afterAll(async () => {
    await app.close();
  });

  it('로그인 없이는 401, 공지가 없으면 둘 다 null', async () => {
    await api(app).get('/v1/notices/attention').expect(401);
    await api(app).post('/v1/notices/1/dismiss').expect(401);
    expect(await attention(user)).toEqual({ popup: null, banner: null });
  });

  it('관리자 popup: 기본 false, 작성과 수정에서 저장, true/false 가 아니면 400', async () => {
    const plain = await create({ title: '일반 공지', published: true });
    expect(plain.popup).toBe(false);
    await api(app).post('/v1/admin/notices').set(auth(admin)).send({ title: 't', body: 'b', kind: 'notice', popup: 'yes' }).expect(400);
    const patched = await api(app).patch(`/v1/admin/notices/${plain.id}`).set(auth(admin)).send({ popup: true }).expect(200);
    expect(patched.body.data.popup).toBe(true);
    const off = await api(app).patch(`/v1/admin/notices/${plain.id}`).set(auth(admin)).send({ popup: false }).expect(200);
    expect(off.body.data.popup).toBe(false);
    const read = await api(app).get(`/v1/notices/${plain.id}`).expect(200);
    expect(read.body.data.popup).toBe(false);
    await prisma.notice.deleteMany();
  });

  it('팝업: 게시된 팝업 공지 중 가장 최근 것과 첫 문단, 초안과 일반 공지는 아님', async () => {
    const older = await create({ title: '예전 팝업', popup: true, published: true });
    await setPublishedAt(older.id, '2026-11-01T00:00:00.000Z');
    const popup = await create({ title: '서버 점검 안내', kind: 'maintenance', popup: true, published: true, body: '\n30일 새벽 2시에 점검해요.\n서비스가 잠시 멈춰요.\n\n자세한 내용은 아래.' });
    await setPublishedAt(popup.id, '2026-11-20T00:00:00.000Z');
    await create({ title: '초안 팝업', popup: true });
    const plain = await create({ title: '그냥 공지', published: true });

    const got = await attention(user);
    expect(got.popup).toMatchObject({ id: popup.id, title: '서버 점검 안내', kind: 'maintenance', preview: '30일 새벽 2시에 점검해요.\n서비스가 잠시 멈춰요.' });
    expect(got.popup).not.toHaveProperty('body');
    // 띠: 공지 목록을 본 적이 없으니 게시된 것 중 가장 최근 것
    expect(got.banner).toEqual(expect.objectContaining({ id: plain.id, title: '그냥 공지' }));
  });

  it('닫기: 그 사용자만 다음 팝업으로 넘어가고 멱등이다. 다른 기기(같은 사용자)도 다시 안 뜬다', async () => {
    const first = (await attention(user)).popup!;
    const res = await api(app).post(`/v1/notices/${first.id}/dismiss`).set(auth(user)).expect(200);
    expect(res.body.data).toEqual({ ok: true });
    await api(app).post(`/v1/notices/${first.id}/dismiss`).set(auth(user)).expect(200);
    expect(await prisma.noticeDismissal.count({ where: { userId: user.userId } })).toBe(1);

    // 닫은 공지 다음으로 최근 팝업(예전 팝업)이 남아 있으면 그것
    const next = (await attention(user)).popup!;
    expect(next.title).toBe('예전 팝업');
    await api(app).post(`/v1/notices/${next.id}/dismiss`).set(auth(user)).expect(200);
    expect((await attention(user)).popup).toBeNull();

    // 다른 사용자는 그대로
    expect((await attention(other)).popup?.id).toBe(first.id);
  });

  it('닫기: 없는 공지, 초안은 404, 번호가 아니면 400', async () => {
    const draft = await prisma.notice.findFirstOrThrow({ where: { publishedAt: null } });
    await api(app).post(`/v1/notices/${draft.id}/dismiss`).set(auth(user)).expect(404);
    await api(app).post('/v1/notices/999999/dismiss').set(auth(user)).expect(404);
    await api(app).post('/v1/notices/abc/dismiss').set(auth(user)).expect(400);
  });

  it('새 팝업 공지를 게시하면 닫은 사람에게도 그 공지가 뜬다. popup 을 끄면 안 뜬다', async () => {
    const fresh = await create({ title: '새 기능 안내', kind: 'update', popup: true, published: true });
    expect((await attention(user)).popup?.id).toBe(fresh.id);
    await api(app).patch(`/v1/admin/notices/${fresh.id}`).set(auth(admin)).send({ popup: false }).expect(200);
    expect((await attention(user)).popup).toBeNull();
    await api(app).patch(`/v1/admin/notices/${fresh.id}`).set(auth(admin)).send({ popup: true }).expect(200);
  });

  it('띠: 공지 목록을 보면(seen) 사라지고, 더 늦게 게시된 공지가 생기면 그 공지', async () => {
    expect((await attention(user)).banner?.title).toBe('새 기능 안내');
    await api(app).post('/v1/notices/seen').set(auth(user)).expect(200);
    expect((await attention(user)).banner).toBeNull();
    // seen 은 띠만 지운다. 닫지 않은 팝업은 그대로 (팝업은 닫은 기록으로만 판단)
    expect((await attention(user)).popup?.title).toBe('새 기능 안내');

    await new Promise((resolve) => setTimeout(resolve, 5));
    const later = await create({ title: '더 새 공지', published: true });
    expect((await attention(user)).banner).toEqual(expect.objectContaining({ id: later.id, title: '더 새 공지' }));
  });

  it('공지를 지우면 닫은 기록도 지워진다 (FK Cascade)', async () => {
    const target = (await attention(other)).popup!;
    await api(app).post(`/v1/notices/${target.id}/dismiss`).set(auth(other)).expect(200);
    expect(await prisma.noticeDismissal.count({ where: { noticeId: target.id } })).toBeGreaterThan(0);
    await api(app).delete(`/v1/admin/notices/${target.id}`).set(auth(admin)).expect(200);
    expect(await prisma.noticeDismissal.count({ where: { noticeId: target.id } })).toBe(0);
  });
});
