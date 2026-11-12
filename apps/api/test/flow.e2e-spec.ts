import { PrismaService } from '../src/prisma/prisma.service.js';
import { api, auth, createTestApp, devLogin, resetDb, Session, TestApp } from './helpers.js';

/**
 * 핵심 흐름: dev-login → 팀 생성 → 초대코드 참여(두 번째 사용자) → 일정 CRUD → 빈 시간 → 새 소식 → 나가기 → 403
 */
describe('핵심 흐름 (e2e)', () => {
  let app: TestApp;
  let alice: Session;
  let bob: Session;
  let groupId: number;
  let inviteCode: string;
  let eventId: number;

  beforeAll(async () => {
    app = await createTestApp();
    await resetDb(app);
    alice = await devLogin(app, '앨리스');
    bob = await devLogin(app, '밥');
  });

  afterAll(async () => {
    await resetDb(app);
    await app.close();
  });

  it('health 는 인증 없이 { status: 200, data: { ok }, message: OK }', async () => {
    const res = await api(app).get('/v1/health').expect(200);
    expect(res.body).toEqual({ status: 200, data: { ok: true }, message: 'OK' });
  });

  it('dev-login 은 같은 닉네임이면 같은 사용자를 돌려준다', async () => {
    const again = await devLogin(app, '앨리스');
    expect(again.userId).toBe(alice.userId);
  });

  it('GET /me 는 사용자 정보만 (연결 계정 비노출), id 는 숫자', async () => {
    const res = await api(app).get('/v1/me').set(auth(alice)).expect(200);
    // (#300) 처음 여는 달력 startCalendar 가 붙는다
    expect(Object.keys(res.body.data).sort()).toEqual(['createdAt', 'id', 'nickname', 'profileImageUrl', 'startCalendar']);
    expect(res.body.data).toMatchObject({ id: alice.userId, nickname: '앨리스', profileImageUrl: null });
    expect(Number.isInteger(res.body.data.id)).toBe(true);
  });

  it('dev-login 은 AuthAccount(DEV, 닉네임) 하나로 연결된다', async () => {
    const prisma = app.get(PrismaService);
    const accounts = await prisma.authAccount.findMany({ where: { userId: alice.userId } });
    expect(accounts).toHaveLength(1);
    expect(accounts[0]).toMatchObject({ provider: 'DEV', providerUserId: '앨리스', email: null, rawProfile: { nickname: '앨리스' } });
  });

  it('가입 시 PERSONAL 팀이 자동 생성돼 GET /groups 첫 번째로 온다', async () => {
    const res = await api(app).get('/v1/groups').set(auth(alice)).expect(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toMatchObject({
      type: 'PERSONAL',
      name: '내 달력',
      memberCount: 1,
      me: { color: '#F26D6D', displayName: '앨리스' },
      unreadNewsCount: 0,
      // (#311) 주소용 공개 코드
      publicCode: expect.stringMatching(/^[a-z0-9]{8}$/),
    });
  });

  it('POST /groups 는 201 + TEAM + 초대 코드', async () => {
    const res = await api(app).post('/v1/groups').set(auth(alice)).send({ name: '우리 모임' }).expect(201);
    expect(res.body.status).toBe(201);
    const detail = res.body.data;
    expect(detail).toMatchObject({ type: 'TEAM', name: '우리 모임' });
    expect(detail.inviteCode).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
    expect(detail.inviteUrl).toBe(`http://localhost:3000/join/${detail.inviteCode}`);
    expect(detail.members).toHaveLength(1);
    expect(detail.me.userId).toBe(alice.userId);
    expect(Number.isInteger(detail.id)).toBe(true);
    groupId = detail.id;
    inviteCode = detail.inviteCode;
  });

  it('GET /invites/:code 는 비로그인 미리보기, 소문자도 허용', async () => {
    const res = await api(app).get(`/v1/invites/${inviteCode.toLowerCase()}`).expect(200);
    expect(res.body.data).toEqual({ groupName: '우리 모임', memberCount: 1, inviter: null, isMember: false, groupId: null, groupCode: null });
    const missing = await api(app).get('/v1/invites/ZZZZZZ').expect(404);
    expect(missing.body.error.code).toBe('INVITE_NOT_FOUND');
  });

  it('참여 전에는 403 FORBIDDEN', async () => {
    const res = await api(app).get(`/v1/groups/${groupId}`).set(auth(bob)).expect(403);
    expect(res.body).toEqual({ status: 403, data: null, message: '이 팀의 멤버가 아니에요', error: { code: 'FORBIDDEN' } });
  });

  it('POST /groups/join 은 200, 두 번째 멤버는 팔레트 두 번째 색, 두 번 눌러도 멱등', async () => {
    const res = await api(app).post('/v1/groups/join').set(auth(bob)).send({ code: ` ${inviteCode.toLowerCase()} ` }).expect(200);
    expect(res.body.data.id).toBe(groupId);
    expect(res.body.data.members).toHaveLength(2);
    expect(res.body.data.me).toMatchObject({ userId: bob.userId, color: '#F2994A' });

    const again = await api(app).post('/v1/groups/join').set(auth(bob)).send({ code: inviteCode }).expect(200);
    expect(again.body.data.members).toHaveLength(2);
  });

  it('PATCH /groups/:id/me 로 색과 표시 이름을 바꾸고 null 로 되돌린다', async () => {
    const changed = await api(app)
      .patch(`/v1/groups/${groupId}/me`)
      .set(auth(bob))
      .send({ color: '#123abc', displayName: '밥아저씨' })
      .expect(200);
    expect(changed.body.data).toMatchObject({ userId: bob.userId, color: '#123ABC', displayName: '밥아저씨' });

    const reset = await api(app).patch(`/v1/groups/${groupId}/me`).set(auth(bob)).send({ displayName: null }).expect(200);
    expect(reset.body.data.displayName).toBe('밥');

    const bad = await api(app).patch(`/v1/groups/${groupId}/me`).set(auth(bob)).send({ color: 'red' }).expect(400);
    expect(bad.body.error).toEqual({ code: 'VALIDATION_FAILED', details: [{ field: 'color', message: expect.any(String) }] });
  });

  it('PATCH /groups/:id 이름 변경과 초대 코드 재발급 (이전 코드 무효)', async () => {
    const renamed = await api(app).patch(`/v1/groups/${groupId}`).set(auth(bob)).send({ name: '새 이름' }).expect(200);
    expect(renamed.body.data.name).toBe('새 이름');

    const rotated = await api(app).post(`/v1/groups/${groupId}/invite-code`).set(auth(alice)).expect(200);
    expect(rotated.body.data.inviteCode).not.toBe(inviteCode);
    await api(app).get(`/v1/invites/${inviteCode}`).expect(404);
    inviteCode = rotated.body.data.inviteCode;
  });

  it('PERSONAL 팀은 초대 코드 재발급 불가, 나가기 불가', async () => {
    const groups = await api(app).get('/v1/groups').set(auth(alice)).expect(200);
    const personalId = groups.body.data.find((g: { type: string }) => g.type === 'PERSONAL').id;
    const invite = await api(app).post(`/v1/groups/${personalId}/invite-code`).set(auth(alice)).expect(400);
    expect(invite.body.error.code).toBe('GROUP_NOT_INVITABLE');
    const leave = await api(app).delete(`/v1/groups/${personalId}/me`).set(auth(alice)).expect(400);
    expect(leave.body.error.code).toBe('GROUP_PERSONAL_LEAVE');
  });

  it('일정 생성 201, 범위 오류 400 EVENT_RANGE_INVALID, 모르는 필드 400', async () => {
    const created = await api(app)
      .post(`/v1/groups/${groupId}/events`)
      .set(auth(alice))
      .send({ title: '저녁 약속', startsAt: '2026-12-01T10:00:00.000Z', endsAt: '2026-12-01T12:00:00.000Z', allDay: false, memo: '강남' })
      .expect(201);
    expect(created.body.data).toMatchObject({
      groupId,
      title: '저녁 약속',
      startsAt: '2026-12-01T10:00:00.000Z',
      endsAt: '2026-12-01T12:00:00.000Z',
      allDay: false,
      memo: '강남',
      creator: { userId: alice.userId, displayName: '앨리스', color: '#F26D6D' },
    });
    eventId = created.body.data.id;

    const reversed = await api(app)
      .post(`/v1/groups/${groupId}/events`)
      .set(auth(alice))
      .send({ title: 'x', startsAt: '2026-12-01T12:00:00.000Z', endsAt: '2026-12-01T10:00:00.000Z', allDay: false })
      .expect(400);
    expect(reversed.body.error.code).toBe('EVENT_RANGE_INVALID');

    const tooLong = await api(app)
      .post(`/v1/groups/${groupId}/events`)
      .set(auth(alice))
      .send({ title: 'x', startsAt: '2026-12-01T00:00:00.000Z', endsAt: '2027-01-01T00:00:01.000Z', allDay: false })
      .expect(400);
    expect(tooLong.body.error.code).toBe('EVENT_RANGE_INVALID');

    const unknown = await api(app)
      .post(`/v1/groups/${groupId}/events`)
      .set(auth(alice))
      .send({ title: 'x', startsAt: '2026-12-01T00:00:00.000Z', endsAt: '2026-12-01T01:00:00.000Z', allDay: false, color: '#fff' })
      .expect(400);
    expect(unknown.body).toEqual({
      status: 400,
      data: null,
      message: 'color 은(는) 허용되지 않는 항목이에요',
      error: { code: 'VALIDATION_FAILED', details: [{ field: 'color', message: 'color 은(는) 허용되지 않는 항목이에요' }] },
    });
  });

  it('일정 목록은 겹침 조건 + 62일 제한, 단건 조회, 다른 팀 ID 는 404', async () => {
    const list = await api(app)
      .get(`/v1/groups/${groupId}/events`)
      .set(auth(bob))
      .query({ from: '2026-12-01T11:00:00.000Z', to: '2026-12-02T00:00:00.000Z' })
      .expect(200);
    expect(list.body.data.map((e: { id: number }) => e.id)).toEqual([eventId]);

    const outside = await api(app)
      .get(`/v1/groups/${groupId}/events`)
      .set(auth(bob))
      .query({ from: '2026-12-01T12:00:00.000Z', to: '2026-12-02T00:00:00.000Z' })
      .expect(200);
    expect(outside.body.data).toEqual([]);

    const tooWide = await api(app)
      .get(`/v1/groups/${groupId}/events`)
      .set(auth(bob))
      .query({ from: '2026-01-01T00:00:00.000Z', to: '2026-04-01T00:00:00.000Z' })
      .expect(400);
    expect(tooWide.body.error.code).toBe('EVENT_RANGE_INVALID');

    const missingQuery = await api(app).get(`/v1/groups/${groupId}/events`).set(auth(bob)).expect(400);
    expect(missingQuery.body.error.code).toBe('VALIDATION_FAILED');
    expect(missingQuery.body.error.details.map((d: { field: string }) => d.field)).toContain('from');

    const one = await api(app).get(`/v1/groups/${groupId}/events/${eventId}`).set(auth(bob)).expect(200);
    expect(one.body.data.id).toBe(eventId);
    expect(one.body.data.publicCode).toMatch(/^[a-z0-9]{8}$/);

    // (#311) 공개 코드 조회 GET /events/:code: 멤버는 단건과 같은 응답(대문자도 허용), 비멤버와 틀린 코드는 모두 404 NOT_FOUND
    const byCode = await api(app).get(`/v1/events/${one.body.data.publicCode.toUpperCase()}`).set(auth(bob)).expect(200);
    expect(byCode.body.data).toEqual(one.body.data);
    const stranger = await devLogin(app, '낯선이');
    for (const [session, code] of [
      [stranger, one.body.data.publicCode],
      [bob, 'zzzzzzzz'],
      [bob, 'bad'],
      [bob, String(eventId)],
    ] as const) {
      const res = await api(app).get(`/v1/events/${code}`).set(auth(session)).expect(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    }

    const prisma = app.get(PrismaService);
    const personal = await prisma.group.findFirstOrThrow({ where: { type: 'PERSONAL', memberships: { some: { userId: bob.userId } } } });
    const cross = await api(app).get(`/v1/groups/${personal.id}/events/${eventId}`).set(auth(bob)).expect(404);
    expect(cross.body.error.code).toBe('NOT_FOUND');
  });

  it('다른 멤버가 PATCH 하면 UPDATED 로그, 내 변경은 내 새 소식에 안 보인다', async () => {
    const patched = await api(app)
      .patch(`/v1/groups/${groupId}/events/${eventId}`)
      .set(auth(bob))
      .send({ title: '저녁 약속 (변경)', endsAt: '2026-12-01T13:00:00.000Z' })
      .expect(200);
    expect(patched.body.data).toMatchObject({ title: '저녁 약속 (변경)', endsAt: '2026-12-01T13:00:00.000Z', memo: '강남' });

    const bobNews = await api(app).get(`/v1/groups/${groupId}/news`).set(auth(bob)).expect(200);
    expect(bobNews.body.data.items.map((i: { action: string }) => i.action)).toEqual(['CREATED']);

    const aliceNews = await api(app).get(`/v1/groups/${groupId}/news`).set(auth(alice)).expect(200);
    expect(aliceNews.body.data.items).toHaveLength(1);
    expect(aliceNews.body.data.items[0]).toMatchObject({
      action: 'UPDATED',
      eventId,
      title: '저녁 약속 (변경)',
      actor: { userId: bob.userId, displayName: '밥' },
      isNew: true,
    });

    // (#191) 배지는 일정 기록 + 팀 활동 기록(밥 합류 등). v=2 새 소식의 새 항목 수와 같다
    const summary = await api(app).get('/v1/groups').set(auth(alice)).expect(200);
    const team = summary.body.data.find((g: { id: number }) => g.id === groupId);
    const merged = await api(app).get(`/v1/groups/${groupId}/news`).query({ v: '2' }).set(auth(alice)).expect(200);
    const fresh = merged.body.data.items.filter((i: { isNew: boolean }) => i.isNew);
    expect(fresh.filter((i: { kind: string }) => i.kind === 'EVENT')).toHaveLength(1);
    expect(team.unreadNewsCount).toBe(fresh.length);
    expect(team.unreadNewsCount).toBeGreaterThan(1);
  });

  it('news/seen 뒤에는 isNew=false, 배지 0', async () => {
    const seen = await api(app).post(`/v1/groups/${groupId}/news/seen`).set(auth(alice)).expect(200);
    expect(typeof seen.body.data.lastSeenAt).toBe('string');

    const news = await api(app).get(`/v1/groups/${groupId}/news`).set(auth(alice)).expect(200);
    expect(news.body.data.items[0].isNew).toBe(false);
    expect(news.body.data.lastSeenAt).toBe(seen.body.data.lastSeenAt);

    const summary = await api(app).get('/v1/groups').set(auth(alice)).expect(200);
    expect(summary.body.data.find((g: { id: number }) => g.id === groupId).unreadNewsCount).toBe(0);
  });

  it('빈 시간: 다른 팀(개인 달력) 일정도 바쁨으로 치고, 종일은 토글로만', async () => {
    const prisma = app.get(PrismaService);
    const bobPersonal = await prisma.group.findFirstOrThrow({
      where: { type: 'PERSONAL', memberships: { some: { userId: bob.userId } } },
    });
    // 밥의 개인 달력: 12/01 KST 10:00~12:00 (01:00Z~03:00Z) 바쁨
    await api(app)
      .post(`/v1/groups/${bobPersonal.id}/events`)
      .set(auth(bob))
      .send({ title: '비밀 일정', startsAt: '2026-12-01T01:00:00.000Z', endsAt: '2026-12-01T03:00:00.000Z', allDay: false })
      .expect(201);
    // 12/02 종일
    await api(app)
      .post(`/v1/groups/${bobPersonal.id}/events`)
      .set(auth(bob))
      .send({ title: '휴가', startsAt: '2026-12-01T15:00:00.000Z', endsAt: '2026-12-02T15:00:00.000Z', allDay: true })
      .expect(201);

    const base = { from: '2026-12-01T00:00:00.000Z', to: '2026-12-02T15:00:00.000Z', dayStart: '09:00', dayEnd: '22:00', minMinutes: 60 };
    const res = await api(app).get(`/v1/groups/${groupId}/free-slots`).set(auth(alice)).query(base).expect(200);
    expect(res.body.data.memberCount).toBe(2);
    expect(res.body.data.slots).toEqual([
      // 12/01: 09:00~10:00 KST 는 60분이라 포함, 12:00~19:00 (03:00Z~10:00Z), 22:00 KST 종료 → 팀 일정 19:00~22:00 KST 가 바쁨
      { startsAt: '2026-12-01T00:00:00.000Z', endsAt: '2026-12-01T01:00:00.000Z' },
      { startsAt: '2026-12-01T03:00:00.000Z', endsAt: '2026-12-01T10:00:00.000Z' },
      // 12/02: 종일 일정은 기본 제외라 하루 전체
      { startsAt: '2026-12-02T00:00:00.000Z', endsAt: '2026-12-02T13:00:00.000Z' },
    ]);
    expect(JSON.stringify(res.body)).not.toContain('비밀 일정');

    const withAllDay = await api(app)
      .get(`/v1/groups/${groupId}/free-slots`)
      .set(auth(alice))
      .query({ ...base, includeAllDay: 'true' })
      .expect(200);
    expect(withAllDay.body.data.slots).toHaveLength(2);

    const tooWide = await api(app)
      .get(`/v1/groups/${groupId}/free-slots`)
      .set(auth(alice))
      .query({ from: '2026-12-01T00:00:00.000Z', to: '2027-01-02T00:00:00.000Z' })
      .expect(400);
    expect(tooWide.body.error.code).toBe('EVENT_RANGE_INVALID');

    const badWindow = await api(app)
      .get(`/v1/groups/${groupId}/free-slots`)
      .set(auth(alice))
      .query({ ...base, dayStart: '22:00', dayEnd: '09:00' })
      .expect(400);
    expect(badWindow.body.error).toEqual({ code: 'VALIDATION_FAILED', details: [{ field: 'dayStart', message: badWindow.body.message }] });

    const badMinutes = await api(app)
      .get(`/v1/groups/${groupId}/free-slots`)
      .set(auth(alice))
      .query({ ...base, minMinutes: 10 })
      .expect(400);
    expect(badMinutes.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('기념일 CRUD: 날짜는 YYYY-MM-DD 그대로 오간다', async () => {
    const created = await api(app)
      .post(`/v1/groups/${groupId}/anniversaries`)
      .set(auth(alice))
      .send({ name: '처음 만난 날', date: '2024-03-15' })
      .expect(201);
    expect(created.body.data).toMatchObject({ name: '처음 만난 날', date: '2024-03-15', creator: { userId: alice.userId } });
    const id = created.body.data.id;

    await api(app).post(`/v1/groups/${groupId}/anniversaries`).set(auth(bob)).send({ name: '나중', date: '2030-01-01' }).expect(201);
    const list = await api(app).get(`/v1/groups/${groupId}/anniversaries`).set(auth(bob)).expect(200);
    expect(list.body.data.map((a: { date: string }) => a.date)).toEqual(['2024-03-15', '2030-01-01']);

    const patched = await api(app).patch(`/v1/groups/${groupId}/anniversaries/${id}`).set(auth(bob)).send({ date: '2024-03-16' }).expect(200);
    expect(patched.body.data.date).toBe('2024-03-16');

    const invalid = await api(app).post(`/v1/groups/${groupId}/anniversaries`).set(auth(bob)).send({ name: 'x', date: '2026-02-30' }).expect(400);
    expect(invalid.body.error.code).toBe('VALIDATION_FAILED');

    await api(app).delete(`/v1/groups/${groupId}/anniversaries/${id}`).set(auth(alice)).expect(200);
    const gone = await api(app).delete(`/v1/groups/${groupId}/anniversaries/${id}`).set(auth(alice)).expect(404);
    expect(gone.body.error.code).toBe('NOT_FOUND');
  });

  it('기념일 종류(kind): 생략하면 COUNT_UP, 지정/수정한 값이 목록까지 이어지고 잘못된 값은 400 (#106)', async () => {
    const counted = await api(app).post(`/v1/groups/${groupId}/anniversaries`).set(auth(alice)).send({ name: '처음 만난 날', date: '2025-01-01' }).expect(201);
    expect(counted.body.data.kind).toBe('COUNT_UP');

    const birthday = await api(app)
      .post(`/v1/groups/${groupId}/anniversaries`)
      .set(auth(bob))
      .send({ name: '생일', date: '2000-05-05', kind: 'YEARLY' })
      .expect(201);
    expect(birthday.body.data).toMatchObject({ name: '생일', date: '2000-05-05', kind: 'YEARLY' });

    const patched = await api(app)
      .patch(`/v1/groups/${groupId}/anniversaries/${counted.body.data.id}`)
      .set(auth(bob))
      .send({ kind: 'ONCE' })
      .expect(200);
    expect(patched.body.data).toMatchObject({ name: '처음 만난 날', date: '2025-01-01', kind: 'ONCE' });

    const list = await api(app).get(`/v1/groups/${groupId}/anniversaries`).set(auth(alice)).expect(200);
    const kinds = Object.fromEntries(list.body.data.map((a: { id: number; kind: string }) => [a.id, a.kind]));
    expect(kinds[counted.body.data.id]).toBe('ONCE');
    expect(kinds[birthday.body.data.id]).toBe('YEARLY');

    for (const [method, path, body] of [
      ['post', `/v1/groups/${groupId}/anniversaries`, { name: 'x', date: '2024-01-01', kind: 'WEEKLY' }],
      ['post', `/v1/groups/${groupId}/anniversaries`, { name: 'x', date: '2024-01-01', kind: null }],
      ['patch', `/v1/groups/${groupId}/anniversaries/${birthday.body.data.id}`, { kind: 'yearly' }],
      ['patch', `/v1/groups/${groupId}/anniversaries/${birthday.body.data.id}`, { kind: null }],
    ] as const) {
      const res = await api(app)[method](path).set(auth(alice)).send(body).expect(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
      expect(res.body.error.details[0].field).toBe('kind');
    }
    const unchanged = await api(app).get(`/v1/groups/${groupId}/anniversaries`).set(auth(alice)).expect(200);
    expect(unchanged.body.data.find((a: { id: number }) => a.id === birthday.body.data.id).kind).toBe('YEARLY');
  });

  it('기념일 알림 시점(reminders): 생략하면 당일만, [] 는 알림 없음, 수정은 보낸 것만, 잘못된 값은 400 (#269)', async () => {
    const prisma = app.get(PrismaService);
    const created = await api(app).post(`/v1/groups/${groupId}/anniversaries`).set(auth(alice)).send({ name: '알림 기본', date: '2025-01-01' }).expect(201);
    expect(created.body.data.reminders).toEqual(['DAY_OF']);
    const id = created.body.data.id;

    // 순서 무관하게 받아 당일, 하루 전, 일주일 전 순으로 돌려준다
    const many = await api(app)
      .patch(`/v1/groups/${groupId}/anniversaries/${id}`)
      .set(auth(bob))
      .send({ reminders: ['WEEK_BEFORE', 'DAY_OF', 'DAY_BEFORE'] })
      .expect(200);
    expect(many.body.data.reminders).toEqual(['DAY_OF', 'DAY_BEFORE', 'WEEK_BEFORE']);
    expect(await prisma.anniversary.findUniqueOrThrow({ where: { id } })).toMatchObject({ remindDayOf: true, remindDayBefore: true, remindWeekBefore: true });

    // 다른 칸만 바꾸면 알림은 그대로
    const renamed = await api(app).patch(`/v1/groups/${groupId}/anniversaries/${id}`).set(auth(bob)).send({ name: '이름만' }).expect(200);
    expect(renamed.body.data.reminders).toEqual(['DAY_OF', 'DAY_BEFORE', 'WEEK_BEFORE']);

    const none = await api(app).patch(`/v1/groups/${groupId}/anniversaries/${id}`).set(auth(bob)).send({ reminders: [] }).expect(200);
    expect(none.body.data.reminders).toEqual([]);

    const dayBefore = await api(app)
      .post(`/v1/groups/${groupId}/anniversaries`)
      .set(auth(alice))
      .send({ name: '하루 전만', date: '2000-05-05', kind: 'YEARLY', reminders: ['DAY_BEFORE'] })
      .expect(201);
    expect(dayBefore.body.data.reminders).toEqual(['DAY_BEFORE']);

    const list = await api(app).get(`/v1/groups/${groupId}/anniversaries`).set(auth(alice)).expect(200);
    const byId = Object.fromEntries(list.body.data.map((a: { id: number; reminders: string[] }) => [a.id, a.reminders]));
    expect(byId[id]).toEqual([]);
    expect(byId[dayBefore.body.data.id]).toEqual(['DAY_BEFORE']);

    for (const [method, path, body] of [
      ['post', `/v1/groups/${groupId}/anniversaries`, { name: 'x', date: '2024-01-01', reminders: null }],
      ['post', `/v1/groups/${groupId}/anniversaries`, { name: 'x', date: '2024-01-01', reminders: 'DAY_OF' }],
      ['post', `/v1/groups/${groupId}/anniversaries`, { name: 'x', date: '2024-01-01', reminders: ['MONTH_BEFORE'] }],
      ['patch', `/v1/groups/${groupId}/anniversaries/${id}`, { reminders: ['DAY_OF', 'DAY_OF'] }],
      ['patch', `/v1/groups/${groupId}/anniversaries/${id}`, { reminders: ['day_of'] }],
      ['patch', `/v1/groups/${groupId}/anniversaries/${id}`, { reminders: null }],
    ] as const) {
      const res = await api(app)[method](path).set(auth(alice)).send(body).expect(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
      expect(res.body.error.details[0].field).toBe('reminders');
    }
    const unchanged = await api(app).get(`/v1/groups/${groupId}/anniversaries`).set(auth(alice)).expect(200);
    expect(unchanged.body.data.find((a: { id: number }) => a.id === id).reminders).toEqual([]);
  });

  it('마이그레이션 기본값: 알림 칸 없이 넣은 행(#269 전 행)은 당일만 (#269)', async () => {
    const prisma = app.get(PrismaService);
    await prisma.$executeRaw`INSERT INTO Anniversary (groupId, name, date, kind, updatedAt) VALUES (${groupId}, '옛 행', '2024-02-02', 'COUNT_UP', NOW(3))`;
    const row = await prisma.anniversary.findFirstOrThrow({ where: { groupId, name: '옛 행' } });
    expect(row).toMatchObject({ remindDayOf: true, remindDayBefore: false, remindWeekBefore: false });
    const list = await api(app).get(`/v1/groups/${groupId}/anniversaries`).set(auth(alice)).expect(200);
    expect(list.body.data.find((a: { id: number }) => a.id === row.id).reminders).toEqual(['DAY_OF']);
    await prisma.anniversary.delete({ where: { id: row.id } });
  });

  it('일정 삭제는 DELETED 스냅샷을 남기고 eventId 는 null 이 된다', async () => {
    const res = await api(app).delete(`/v1/groups/${groupId}/events/${eventId}`).set(auth(alice)).expect(200);
    expect(res.body).toEqual({ status: 200, data: { ok: true }, message: 'OK' });
    await api(app).get(`/v1/groups/${groupId}/events/${eventId}`).set(auth(alice)).expect(404);

    const news = await api(app).get(`/v1/groups/${groupId}/news`).set(auth(bob)).expect(200);
    expect(news.body.data.items[0]).toMatchObject({ action: 'DELETED', eventId: null, title: '저녁 약속 (변경)', actor: { userId: alice.userId } });
  });

  it('나가기: 남은 멤버가 있으면 groupDeleted=false, 이후 403', async () => {
    const left = await api(app).delete(`/v1/groups/${groupId}/me`).set(auth(bob)).expect(200);
    expect(left.body.data).toEqual({ groupDeleted: false });
    await api(app).get(`/v1/groups/${groupId}`).set(auth(bob)).expect(403);

    // 밥이 남긴 기념일은 그대로, 등록자는 닉네임 유지 + 회색
    const list = await api(app).get(`/v1/groups/${groupId}/anniversaries`).set(auth(alice)).expect(200);
    expect(list.body.data[0].creator).toEqual({ userId: bob.userId, displayName: '밥', color: '#9CA3AF', profileImageUrl: null });

    const last = await api(app).delete(`/v1/groups/${groupId}/me`).set(auth(alice)).expect(200);
    expect(last.body.data).toEqual({ groupDeleted: true });
    await api(app).get(`/v1/groups/${groupId}`).set(auth(alice)).expect(403);
  });

  it('인증 오류: 토큰 없음/깨진 토큰/탈퇴한 사용자 → 401', async () => {
    const none = await api(app).get('/v1/groups').expect(401);
    expect(none.body.error.code).toBe('UNAUTHORIZED');
    await api(app).get('/v1/groups').set({ Authorization: 'Bearer not-a-jwt' }).expect(401);
    await api(app).get('/v1/groups').set({ Authorization: 'Basic abc' }).expect(401);

    const ghost = await devLogin(app, '유령');
    await api(app).delete('/v1/me').set(auth(ghost)).expect(200);
    const after = await api(app).get('/v1/me').set(auth(ghost)).expect(401);
    expect(after.body.error.code).toBe('UNAUTHORIZED');
  });

  it('회원 탈퇴: 개인 팀 삭제, 팀 일정은 "탈퇴한 멤버" 로 남는다', async () => {
    const carol = await devLogin(app, '캐롤');
    const dave = await devLogin(app, '데이브');
    const team = await api(app).post('/v1/groups').set(auth(carol)).send({ name: '탈퇴 테스트' }).expect(201);
    await api(app).post('/v1/groups/join').set(auth(dave)).send({ code: team.body.data.inviteCode }).expect(200);
    await api(app)
      .post(`/v1/groups/${team.body.data.id}/events`)
      .set(auth(carol))
      .send({ title: '캐롤의 일정', startsAt: '2026-12-10T00:00:00.000Z', endsAt: '2026-12-10T01:00:00.000Z', allDay: false })
      .expect(201);

    await api(app).delete('/v1/me').set(auth(carol)).expect(200);

    const prisma = app.get(PrismaService);
    expect(await prisma.user.findUnique({ where: { id: carol.userId } })).toBeNull();
    expect(await prisma.authAccount.count({ where: { providerUserId: '캐롤' } })).toBe(0);
    expect(await prisma.group.count({ where: { memberships: { none: {} } } })).toBe(0);

    const events = await api(app)
      .get(`/v1/groups/${team.body.data.id}/events`)
      .set(auth(dave))
      .query({ from: '2026-12-01T00:00:00.000Z', to: '2026-12-31T00:00:00.000Z' })
      .expect(200);
    expect(events.body.data[0].creator).toEqual({ userId: null, displayName: '탈퇴한 멤버', color: '#9CA3AF', profileImageUrl: null });

    const news = await api(app).get(`/v1/groups/${team.body.data.id}/news`).set(auth(dave)).expect(200);
    expect(news.body.data.items[0].actor.displayName).toBe('탈퇴한 멤버');

    // 마지막 멤버가 탈퇴하면 팀도 삭제
    await api(app).delete('/v1/me').set(auth(dave)).expect(200);
    expect(await prisma.group.findUnique({ where: { id: team.body.data.id } })).toBeNull();
  });

  it('경로 ID 가 양의 정수가 아니면 400 VALIDATION_FAILED + details (권한 확인 전에)', async () => {
    const res = await api(app).get('/v1/groups/abc').set(auth(alice)).expect(400);
    expect(res.body).toEqual({
      status: 400,
      data: null,
      message: 'groupId 은(는) 양의 정수여야 해요',
      error: { code: 'VALIDATION_FAILED', details: [{ field: 'groupId', message: 'groupId 은(는) 양의 정수여야 해요' }] },
    });
    for (const path of ['/v1/groups/0', '/v1/groups/01', '/v1/groups/1e3', '/v1/groups/-1/events', '/v1/groups/1.5/news', '/v1/groups/clxyz/free-slots', '/v1/groups/2147483648']) {
      const bad = await api(app).get(path).set(auth(alice)).expect(400);
      expect(bad.body.error.details[0].field).toBe('groupId');
    }
    const badEvent = await api(app).patch('/v1/groups/1/events/x1').set(auth(alice)).send({}).expect(400);
    expect(badEvent.body.error.details).toEqual([{ field: 'eventId', message: 'eventId 은(는) 양의 정수여야 해요' }]);
    const badAnniversary = await api(app).delete('/v1/groups/1/anniversaries/01').set(auth(alice)).expect(400);
    expect(badAnniversary.body.error.details[0].field).toBe('anniversaryId');
  });

  it('모르는 경로는 404 NOT_FOUND 봉투', async () => {
    const res = await api(app).get('/v1/nope').set(auth(alice)).expect(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});
