import { createHash, randomBytes } from 'node:crypto';
import { JwtService } from '@nestjs/jwt';
import { findAbsorbBlockers } from '../src/auth-accounts/auth-accounts.repository.js';
import { APPLE_REVOKE_URL, APPLE_TOKEN_URL } from '../src/auth/providers/apple.provider.js';
import { KAKAO_ME_URL, KAKAO_TOKEN_INFO_URL, KAKAO_TOKEN_URL, KAKAO_UNLINK_URL } from '../src/auth/providers/kakao.provider.js';
import type { MailClient, MailMessage, MailSendResult } from '../src/email-login/mail-client.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { APPLE_TEST_ENV, createAppleTestKeys, signAppleToken, type AppleTestKeys } from '../src/testing/apple-keys.js';
import { urlOf } from '../src/testing/fetch-url.js';
import { api, auth, createTestApp, devLogin, resetDb, type Session, type TestApp } from './helpers.js';

type FetchMock = ReturnType<typeof vi.fn<typeof fetch>>;

const KEY = 'e2e-internal-key';
const WEB = 'http://localhost:3000';
const APPLE_KEYS = Object.keys(APPLE_TEST_ENV).concat('APPLE_PRIVATE_KEY');
const sha256hex = (value: string): string => createHash('sha256').update(value).digest('hex');

class FakeMail implements MailClient {
  sent: MailMessage[] = [];
  async send(message: MailMessage): Promise<MailSendResult> {
    this.sent.push(message);
    return { status: 'SENT', id: `msg_${this.sent.length}` };
  }
  lastCode(to: string): string {
    const message = [...this.sent].reverse().find((m) => m.to === to);
    return /\n(\d{6})\n/.exec(message?.text ?? '')?.[1] ?? '';
  }
}

/** 카카오: 웹 코드 교환, 앱 토큰 확인(app_id), 프로필, 연결 끊기 */
function kakaoFetch(options: { id: number; unlinkStatus?: number }): FetchMock {
  return vi.fn<typeof fetch>(async (input) => {
    const url = urlOf(input);
    if (url === KAKAO_TOKEN_URL) return Response.json({ access_token: 'kakao-access-token' });
    if (url === KAKAO_TOKEN_INFO_URL) return Response.json({ id: options.id, app_id: 424242 });
    if (url === KAKAO_ME_URL) return Response.json({ id: options.id, kakao_account: { profile: { nickname: `카카오${options.id}` } } });
    if (url === KAKAO_UNLINK_URL) {
      const status = options.unlinkStatus ?? 200;
      return status === 200 ? Response.json({ id: options.id }) : Response.json({ code: -1 }, { status });
    }
    throw new Error(`예상 밖 fetch: ${url}`);
  });
}

/** (#198) 로그인 방법 연결 (D-257). 실 DB, 카카오와 Apple HTTP 는 목, 메일은 가짜 */
describe('로그인 방법 연결 (e2e, #198)', () => {
  let app: TestApp;
  let prisma: PrismaService;
  let jwt: JwtService;
  let keys: AppleTestKeys;
  const mail = new FakeMail();
  const originalFetch = globalThis.fetch;
  let kakaoSeq = 7_000_000_000;
  const nextKakaoId = () => ++kakaoSeq;
  let ipSeq = 0;

  beforeAll(async () => {
    keys = await createAppleTestKeys();
    Object.assign(process.env, APPLE_TEST_ENV, { APPLE_PRIVATE_KEY: keys.p8 });
    app = await createTestApp({ appleJwks: keys.jwks, mail });
    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);
    await resetDb(app);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  afterAll(async () => {
    await resetDb(app);
    await app.close();
    for (const key of APPLE_KEYS) process.env[key] = '';
  });

  const list = async (s: Session) => (await api(app).get('/v1/me/auth-accounts').set(auth(s)).expect(200)).body.data as { id: number; provider: string; label: string }[];
  const linkKakaoApp = (s: Session, id: number) => {
    globalThis.fetch = kakaoFetch({ id });
    return api(app).post('/v1/me/auth-accounts').set(auth(s)).send({ provider: 'KAKAO', accessToken: 'kakao-app-token' });
  };
  /** 오래된 세션 (발급 11분 전) */
  const staleSession = async (s: Session): Promise<Session> => ({ ...s, token: await jwt.signAsync({ sub: String(s.userId), iat: Math.floor(Date.now() / 1000) - 660 }) });
  /** 카카오 계정 하나만 가진 빈 사용자 B (개발 로그인 계정을 카카오로 바꾼다) */
  async function kakaoUser(nickname: string): Promise<{ session: Session; kakaoId: number }> {
    const session = await devLogin(app, nickname);
    const kakaoId = nextKakaoId();
    await prisma.authAccount.updateMany({ where: { userId: session.userId }, data: { provider: 'KAKAO', providerUserId: String(kakaoId) } });
    return { session, kakaoId };
  }
  const personalGroupId = async (s: Session) =>
    ((await api(app).get('/v1/groups').set(auth(s)).expect(200)).body.data as { id: number; type: string }[]).find((g) => g.type === 'PERSONAL')!.id;

  /** 웹 카카오 연결: link-start → /auth/kakao?mode=link → 콜백 → /me/link?ticket= */
  async function webKakaoTicket(s: Session, kakaoId: number, next = '/me/accounts'): Promise<string> {
    const started = await api(app).post('/v1/me/auth-accounts/link-start').set(auth(s)).send({ provider: 'KAKAO' }).expect(200);
    expect(started.headers['cache-control']).toBe('no-store');
    const go = await api(app).get('/v1/auth/kakao').query({ mode: 'link', intent: started.body.data.intent, next }).expect(302);
    const cookie = (go.headers['set-cookie'] as unknown as string[])[0].split(';')[0];
    const state = new URL(go.headers.location).searchParams.get('state')!;
    globalThis.fetch = kakaoFetch({ id: kakaoId });
    const back = await api(app).get('/v1/auth/kakao/callback').query({ code: 'c', state }).set('Cookie', cookie).expect(302);
    const location = new URL(back.headers.location);
    expect(location.origin + location.pathname).toBe(`${WEB}/me/link`);
    expect(location.searchParams.get('next')).toBe(next);
    return location.searchParams.get('ticket')!;
  }

  it('웹 카카오 연결: 콜백은 로그인하지 않고 티켓만, 시작한 사용자의 세션으로 소비 → 카카오로 로그인해도 같은 계정', async () => {
    const alice = await devLogin(app, '앨리스');
    expect(await list(alice)).toEqual([{ id: expect.any(Number), provider: 'DEV', label: '개발 계정 (앨리스)', createdAt: expect.any(String) }]);
    const users = await prisma.user.count();
    const kakaoId = nextKakaoId();
    const ticket = await webKakaoTicket(alice, kakaoId);
    expect(ticket).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await prisma.user.count()).toBe(users);
    const row = await prisma.authLinkTicket.findFirstOrThrow({ where: { userId: alice.userId } });
    expect(row.tokenHash).toBe(sha256hex(ticket));

    const res = await api(app).post('/v1/me/auth-accounts').set(auth(alice)).send({ ticket }).expect(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.data).toEqual({ account: { id: expect.any(Number), provider: 'KAKAO', label: '카카오 계정', createdAt: expect.any(String) }, absorbed: false });
    expect((await list(alice)).map((a) => a.provider)).toEqual(['KAKAO', 'DEV']);

    // 같은 티켓 재사용 400
    const reuse = await api(app).post('/v1/me/auth-accounts').set(auth(alice)).send({ ticket }).expect(400);
    expect(reuse.body.error.code).toBe('LINK_TICKET_INVALID');

    // 이제 카카오 로그인은 앨리스
    globalThis.fetch = kakaoFetch({ id: kakaoId });
    const login = await api(app).get('/v1/auth/kakao').expect(302);
    const cookie = (login.headers['set-cookie'] as unknown as string[])[0].split(';')[0];
    const back = await api(app)
      .get('/v1/auth/kakao/callback')
      .query({ code: 'c', state: new URL(login.headers.location).searchParams.get('state')! })
      .set('Cookie', cookie)
      .expect(302);
    const token = new URL(back.headers.location).searchParams.get('token')!;
    expect((await api(app).get('/v1/me').set({ Authorization: `Bearer ${token}` }).expect(200)).body.data.id).toBe(alice.userId);

    // 웹 연결 시작은 같은 제공자가 있으면 먼저 409. 이미 내 것이면 200 그대로 (멱등, 앱 토큰 경로), 다른 카카오는 409
    const again = await api(app).post('/v1/me/auth-accounts/link-start').set(auth(alice)).send({ provider: 'KAKAO' }).expect(409);
    expect(again.body.error.code).toBe('PROVIDER_ALREADY_LINKED');
    const same = await linkKakaoApp(alice, kakaoId).expect(200);
    expect(same.body.data).toMatchObject({ account: { provider: 'KAKAO' }, absorbed: false });
    const second = await linkKakaoApp(alice, nextKakaoId()).expect(409);
    expect(second.body.error.code).toBe('PROVIDER_ALREADY_LINKED');
  });

  it('티켓: 다른 사용자 세션 거부(소비되지 않음), 만료 거부, 형식 오류 400', async () => {
    const bob = await devLogin(app, '밥');
    const mallory = await devLogin(app, '말로리');
    const ticket = await webKakaoTicket(bob, nextKakaoId());
    const stolen = await api(app).post('/v1/me/auth-accounts').set(auth(mallory)).send({ ticket }).expect(400);
    expect(stolen.body.error.code).toBe('LINK_TICKET_INVALID');
    expect((await list(mallory)).map((a) => a.provider)).toEqual(['DEV']);
    await api(app).post('/v1/me/auth-accounts').set(auth(bob)).send({ ticket }).expect(200);

    const carol = await devLogin(app, '캐럴');
    const expired = await webKakaoTicket(carol, nextKakaoId());
    await prisma.authLinkTicket.updateMany({ where: { tokenHash: sha256hex(expired) }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await api(app).post('/v1/me/auth-accounts').set(auth(carol)).send({ ticket: expired }).expect(400)).body.error.code).toBe('LINK_TICKET_INVALID');
    await api(app).post('/v1/me/auth-accounts').set(auth(carol)).send({ ticket: 'short' }).expect(400);
    await api(app).post('/v1/me/auth-accounts').set(auth(carol)).send({}).expect(400);
  });

  it('시작 표식: 없거나 위조, 다른 제공자, 세션 JWT 를 넣으면 OAuth 로 가지 않고 /me/link?error=LINK_TICKET_INVALID', async () => {
    const dave = await devLogin(app, '데이브');
    const appleIntent = (await api(app).post('/v1/me/auth-accounts/link-start').set(auth(dave)).send({ provider: 'APPLE' }).expect(200)).body.data.intent;
    for (const query of [{ mode: 'link' }, { mode: 'link', intent: 'forged' }, { mode: 'link', intent: appleIntent }, { mode: 'link', intent: dave.token }]) {
      const res = await api(app).get('/v1/auth/kakao').query({ ...query, next: 'https://evil.example' }).expect(302);
      expect(res.headers.location).toBe(`${WEB}/me/link?error=LINK_TICKET_INVALID&next=%2F`);
      expect(res.headers['set-cookie']).toBeUndefined();
    }
    // 콜백에서 state 의 표식이 위조됐어도 티켓을 만들지 않는다
    const go = await api(app).get('/v1/auth/kakao').expect(302);
    const cookie = (go.headers['set-cookie'] as unknown as string[])[0].split(';')[0];
    const nonce = cookie.split('=')[1];
    const forged = Buffer.from(JSON.stringify({ nonce, next: '/me/accounts', intent: 'forged' })).toString('base64url');
    globalThis.fetch = kakaoFetch({ id: nextKakaoId() });
    const back = await api(app).get('/v1/auth/kakao/callback').query({ code: 'c', state: forged }).set('Cookie', cookie).expect(302);
    expect(back.headers.location).toBe(`${WEB}/me/link?error=LINK_TICKET_INVALID&next=%2Fme%2Faccounts`);
    expect(await prisma.authLinkTicket.count({ where: { userId: dave.userId } })).toBe(0);
  });

  it('오래된 세션(10분 넘음)은 시작, 연결, 이메일 연결 메일 모두 409 REAUTH_REQUIRED', async () => {
    const erin = await devLogin(app, '에린');
    const stale = await staleSession(erin);
    expect((await api(app).post('/v1/me/auth-accounts/link-start').set(auth(stale)).send({ provider: 'KAKAO' }).expect(409)).body.error.code).toBe('REAUTH_REQUIRED');
    const ticket = await webKakaoTicket(erin, nextKakaoId());
    expect((await api(app).post('/v1/me/auth-accounts').set(auth(stale)).send({ ticket }).expect(409)).body.error.code).toBe('REAUTH_REQUIRED');
    // 소비되지 않았으므로 다시 로그인하면 쓸 수 있다
    await api(app).post('/v1/me/auth-accounts').set(auth(erin)).send({ ticket }).expect(200);
    const mailReq = await api(app)
      .post('/v1/auth/email/request')
      .set({ 'X-Internal-Key': KEY, 'X-Client-IP': `10.9.0.${++ipSeq}`, ...auth(stale) })
      .send({ email: 'erin@e2e.example', purpose: 'LINK' })
      .expect(409);
    expect(mailReq.body.error.code).toBe('REAUTH_REQUIRED');
  });

  it('빈 계정 흡수: 개인 팀, handoff, 푸시 기기, 사진 행을 지우고 사용자 삭제. 그 세션은 401, 카카오 로그인은 내 계정', async () => {
    const frank = await devLogin(app, '프랭크');
    const { session: empty, kakaoId } = await kakaoUser('빈계정');
    const emptyGroup = await personalGroupId(empty);
    expect(await findAbsorbBlockers(prisma, empty.userId)).toEqual([]);
    await prisma.authHandoff.create({ data: { userId: empty.userId, tokenHash: sha256hex('h'), codeChallenge: 'c'.repeat(43), expiresAt: new Date(Date.now() + 60_000) } });
    await prisma.pushDevice.create({ data: { userId: empty.userId, token: `ExponentPushToken[${randomBytes(6).toString('hex')}]`, platform: 'IOS', appVersion: '1.2.0' } });
    const file = await prisma.file.create({ data: { provider: 'LOCAL', bucket: 'b', key: `avatars/${empty.userId}/x.webp`, mimeType: 'image/webp', size: 1, kind: 'AVATAR', ownerId: empty.userId } });
    await prisma.user.update({ where: { id: empty.userId }, data: { avatarFileId: file.id } });

    const res = await linkKakaoApp(frank, kakaoId).expect(200);
    expect(res.body.data).toMatchObject({ account: { provider: 'KAKAO', label: '카카오 계정' }, absorbed: true });
    expect(await prisma.user.findUnique({ where: { id: empty.userId } })).toBeNull();
    expect(await prisma.group.findUnique({ where: { id: emptyGroup } })).toBeNull();
    expect(await prisma.authHandoff.count({ where: { userId: empty.userId } })).toBe(0);
    expect(await prisma.pushDevice.count({ where: { userId: empty.userId } })).toBe(0);
    expect(await prisma.file.count({ where: { id: file.id } })).toBe(0);
    expect((await api(app).get('/v1/me').set(auth(empty)).expect(401)).body.error.code).toBe('UNAUTHORIZED');
    // 카카오 unlink 는 하지 않는다
    expect((globalThis.fetch as FetchMock).mock.calls.some(([input]) => urlOf(input) === KAKAO_UNLINK_URL)).toBe(false);
    const account = await prisma.authAccount.findUniqueOrThrow({ where: { provider_providerUserId: { provider: 'KAKAO', providerUserId: String(kakaoId) } } });
    expect(account.userId).toBe(frank.userId);
  });

  describe('데이터가 있는 계정은 흡수하지 않고 409 AUTH_ACCOUNT_IN_USE (종류마다)', () => {
    let owner: Session;
    let teamId: number;
    let teamEventId: number;

    beforeAll(async () => {
      owner = await devLogin(app, '팀장');
      teamId = (await api(app).post('/v1/groups').set(auth(owner)).send({ name: '팀' }).expect(201)).body.data.id;
      teamEventId = (
        await api(app)
          .post(`/v1/groups/${teamId}/events`)
          .set(auth(owner))
          .send({ title: '모임', startsAt: '2026-12-01T10:00:00.000Z', endsAt: '2026-12-01T12:00:00.000Z', allDay: false })
          .expect(201)
      ).body.data.id;
    });

    const occurrence = new Date('2026-12-01T00:00:00Z');
    const cases: [string, string, (b: Session, groupId: number) => Promise<unknown>][] = [
      ['개인 팀 일정', 'group.events', (b, g) =>
        api(app).post(`/v1/groups/${g}/events`).set(auth(b)).send({ title: '일정', startsAt: '2026-12-02T10:00:00.000Z', endsAt: '2026-12-02T11:00:00.000Z', allDay: false }).expect(201)],
      ['개인 팀 기념일', 'group.anniversaries', (b, g) => api(app).post(`/v1/groups/${g}/anniversaries`).set(auth(b)).send({ name: '기념일', date: '2026-10-01', kind: 'COUNT_UP' }).expect(201)],
      ['개인 팀 할 일 목록', 'group.todoLists', (b, g) => api(app).post(`/v1/groups/${g}/todo-lists`).set(auth(b)).send({ name: '장보기' }).expect(201)],
      ['다른 팀 멤버십', 'memberships', (b) => api(app).post('/v1/groups').set(auth(b)).send({ name: 'B팀' }).expect(201)],
      ['생일', 'birthday', (b) => api(app).patch('/v1/me/birthday').set(auth(b)).send({ date: '03-04' }).expect(200)],
      ['처음 여는 달력', 'startCalendar', (b) => api(app).patch('/v1/me/start-calendar').set(auth(b)).send({ mode: 'PERSONAL' }).expect(200)],
      ['알림 설정 행', 'notificationPreferences', (b) => prisma.notificationPreference.create({ data: { userId: b.userId, kind: 'WEEKLY', enabled: false } })],
      ['참석 응답', 'eventRsvps', (b) => prisma.eventRsvp.create({ data: { eventId: teamEventId, occurrence, userId: b.userId, status: 'GOING', seenStartsAt: occurrence, seenEndsAt: occurrence } })],
      ['반응', 'eventReactions', (b) => prisma.eventReaction.create({ data: { eventId: teamEventId, occurrence, userId: b.userId, kind: 'LIKE' } })],
      ['일정 참여자', 'eventParticipations', (b) => prisma.eventParticipant.create({ data: { eventId: teamEventId, userId: b.userId } })],
      ['공유 링크', 'eventShares', (b) =>
        prisma.eventShare.create({ data: { token: randomBytes(16).toString('base64url'), groupId: teamId, eventId: teamEventId, createdById: b.userId, expiresAt: new Date(Date.now() + 86_400_000) } })],
      ['다른 팀에 남긴 일정', 'createdEvents', (b) => prisma.event.updateMany({ where: { id: teamEventId }, data: { creatorId: b.userId } })],
      ['다른 로그인 방법', 'authAccounts', (b) => prisma.authAccount.create({ data: { userId: b.userId, provider: 'EMAIL', providerUserId: `b${b.userId}@e2e.example` } })],
      ['사진 밖의 파일', 'files', (b) => prisma.file.create({ data: { provider: 'LOCAL', bucket: 'b', key: `k/${b.userId}`, mimeType: 'image/png', size: 1, kind: 'EVENT_PHOTO', ownerId: b.userId } })],
    ];

    it.each(cases)('%s', async (_name, blocker, seed) => {
      const before = await prisma.event.findUniqueOrThrow({ where: { id: teamEventId }, select: { creatorId: true } });
      const { session: b, kakaoId } = await kakaoUser(`B${kakaoSeq + 1}`);
      await seed(b, await personalGroupId(b));
      expect(await findAbsorbBlockers(prisma, b.userId)).toContain(blocker);
      const res = await linkKakaoApp(owner, kakaoId).expect(409);
      expect(res.body.error.code).toBe('AUTH_ACCOUNT_IN_USE');
      expect(await prisma.user.findUnique({ where: { id: b.userId } })).not.toBeNull();
      expect(await prisma.authAccount.count({ where: { userId: owner.userId, provider: 'KAKAO' } })).toBe(0);
      await prisma.event.update({ where: { id: teamEventId }, data: { creatorId: before.creatorId } });
    });
  });

  it('이메일 연결: 세션 + 내부 키로 LINK 메일(코드만) → 코드로 연결 → 이메일 로그인도 같은 계정. LINK 코드는 로그인에 못 쓴다', async () => {
    const gina = await devLogin(app, '지나');
    const email = 'gina@e2e.example';
    const send = (s: Session | null, body: object) =>
      api(app)
        .post('/v1/auth/email/request')
        .set({ 'X-Internal-Key': KEY, 'X-Client-IP': `10.8.0.${++ipSeq}`, ...(s ? auth(s) : {}) })
        .send(body);
    expect((await send(null, { email, purpose: 'LINK' }).expect(401)).body.error.code).toBe('UNAUTHORIZED');
    await send(gina, { email, purpose: 'LINK' }).expect(200);
    const message = mail.sent.at(-1)!;
    expect(message.subject).toBe('[언제볼까] 로그인 방법 연결 코드');
    expect(message.text).not.toContain('/auth/email?token=');
    const code = mail.lastCode(email);
    const row = await prisma.emailLoginChallenge.findFirstOrThrow({ where: { email }, orderBy: { id: 'desc' } });
    expect(row).toMatchObject({ purpose: 'LINK', userId: gina.userId });

    // 로그인 코드 경로로는 못 쓴다, 남의 세션으로도 못 쓴다
    const asLogin = await api(app).post('/v1/auth/email/code').set({ 'X-Internal-Key': KEY }).send({ email, code }).expect(400);
    expect(asLogin.body.error.code).toBe('EMAIL_CODE_EXPIRED');
    const hank = await devLogin(app, '행크');
    expect((await api(app).post('/v1/me/auth-accounts').set(auth(hank)).send({ provider: 'EMAIL', email, code }).expect(400)).body.error.code).toBe('EMAIL_CODE_EXPIRED');
    // 틀린 코드는 횟수
    const wrong = await api(app).post('/v1/me/auth-accounts').set(auth(gina)).send({ provider: 'EMAIL', email, code: code === '000000' ? '000001' : '000000' }).expect(400);
    expect(wrong.body.error).toEqual({ code: 'EMAIL_CODE_INVALID', details: { attemptsLeft: 4 } });

    const linked = await api(app).post('/v1/me/auth-accounts').set(auth(gina)).send({ provider: 'EMAIL', email: ' Gina@E2E.example ', code }).expect(200);
    expect(linked.body.data).toMatchObject({ account: { provider: 'EMAIL', label: 'gi***@e2e.example' }, absorbed: false });
    // 이메일 로그인 → 지나
    await prisma.$executeRaw`UPDATE EmailLoginChallenge SET createdAt = DATE_SUB(createdAt, INTERVAL 120 SECOND) WHERE email = ${email}`;
    await send(null, { email }).expect(200);
    const login = await api(app).post('/v1/auth/email/code').set({ 'X-Internal-Key': KEY }).send({ email, code: mail.lastCode(email) }).expect(200);
    expect(login.body.data.kind).toBe('SESSION');
    expect((await api(app).get('/v1/me').set({ Authorization: `Bearer ${login.body.data.token}` }).expect(200)).body.data.id).toBe(gina.userId);
  });

  it('해제: 마지막 하나 409, 카카오 끊기 실패 502 면 DB 그대로, 성공하면 카카오 끊고 삭제, 이메일은 발송 기록도', async () => {
    const ivy = await devLogin(app, '아이비');
    const [dev] = await list(ivy);
    expect((await api(app).delete(`/v1/me/auth-accounts/${dev.id}`).set(auth(ivy)).expect(409)).body.error.code).toBe('LAST_AUTH_ACCOUNT');

    const kakaoId = nextKakaoId();
    await linkKakaoApp(ivy, kakaoId).expect(200);
    const kakao = (await list(ivy)).find((a) => a.provider === 'KAKAO')!;
    globalThis.fetch = kakaoFetch({ id: kakaoId, unlinkStatus: 500 });
    expect((await api(app).delete(`/v1/me/auth-accounts/${kakao.id}`).set(auth(ivy)).expect(502)).body.error.code).toBe('KAKAO_ERROR');
    expect((await list(ivy)).map((a) => a.provider)).toEqual(['KAKAO', 'DEV']);

    globalThis.fetch = kakaoFetch({ id: kakaoId });
    await api(app).delete(`/v1/me/auth-accounts/${kakao.id}`).set(auth(ivy)).expect(200);
    const unlinkCall = (globalThis.fetch as FetchMock).mock.calls.find(([input]) => urlOf(input) === KAKAO_UNLINK_URL)!;
    expect((unlinkCall[1]!.body as URLSearchParams).get('target_id')).toBe(String(kakaoId));
    expect((await list(ivy)).map((a) => a.provider)).toEqual(['DEV']);
    // 세션은 그대로, 남의 계정 id 는 404
    await api(app).get('/v1/me').set(auth(ivy)).expect(200);
    const other = await devLogin(app, '남');
    const [othersDev] = await list(other);
    await api(app).delete(`/v1/me/auth-accounts/${othersDev.id}`).set(auth(ivy)).expect(404);
    await api(app).delete('/v1/me/auth-accounts/abc').set(auth(ivy)).expect(400);

    // 이메일 해제는 그 이메일 발송 기록도 지운다
    await prisma.authAccount.create({ data: { userId: ivy.userId, provider: 'EMAIL', providerUserId: 'ivy@e2e.example', email: 'ivy@e2e.example' } });
    await prisma.emailLoginChallenge.create({
      data: { email: 'ivy@e2e.example', linkTokenHash: sha256hex(`l${Date.now()}`), codeHash: 'c'.repeat(64), expiresAt: new Date(), ipHash: 'i'.repeat(64), sendStatus: 'SENT' },
    });
    const emailRow = (await list(ivy)).find((a) => a.provider === 'EMAIL')!;
    await api(app).delete(`/v1/me/auth-accounts/${emailRow.id}`).set(auth(ivy)).expect(200);
    expect(await prisma.emailLoginChallenge.count({ where: { email: 'ivy@e2e.example' } })).toBe(0);
  });

  it('경합: 같은 사용자의 다른 카카오 둘 동시 → 하나만, 같은 새 카카오를 두 사용자가 동시 → 하나만, 같은 티켓 두 번 동시 → 하나만', async () => {
    const jack = await devLogin(app, '잭');
    const idA = nextKakaoId();
    const idB = nextKakaoId();
    globalThis.fetch = vi.fn<typeof fetch>(async (input, init) => {
      const url = urlOf(input);
      const token = String((init?.headers as Record<string, string>)?.Authorization ?? '').replace('Bearer ', '');
      const id = token === 'token-a' ? idA : idB;
      if (url === KAKAO_TOKEN_INFO_URL) return Response.json({ id, app_id: 424242 });
      if (url === KAKAO_ME_URL) return Response.json({ id, kakao_account: { profile: { nickname: 'k' } } });
      throw new Error(url);
    });
    const two = await Promise.all(
      ['token-a', 'token-b'].map((accessToken) => api(app).post('/v1/me/auth-accounts').set(auth(jack)).send({ provider: 'KAKAO', accessToken })),
    );
    expect(two.map((r) => r.status).sort((a, b) => a - b)).toEqual([200, 409]);
    expect(two.find((r) => r.status === 409)!.body.error.code).toBe('PROVIDER_ALREADY_LINKED');
    expect(await prisma.authAccount.count({ where: { userId: jack.userId, provider: 'KAKAO' } })).toBe(1);

    const kim = await devLogin(app, '킴');
    const lee = await devLogin(app, '리');
    const shared = nextKakaoId();
    globalThis.fetch = kakaoFetch({ id: shared });
    const race = await Promise.all([kim, lee].map((s) => api(app).post('/v1/me/auth-accounts').set(auth(s)).send({ provider: 'KAKAO', accessToken: 'x' })));
    expect(race.map((r) => r.status).sort((a, b) => a - b)).toEqual([200, 409]);
    expect(race.find((r) => r.status === 409)!.body.error.code).toBe('AUTH_ACCOUNT_IN_USE');
    expect(await prisma.authAccount.count({ where: { provider: 'KAKAO', providerUserId: String(shared) } })).toBe(1);

    const mo = await devLogin(app, '모');
    const ticket = await webKakaoTicket(mo, nextKakaoId());
    const twice = await Promise.all([0, 1].map(() => api(app).post('/v1/me/auth-accounts').set(auth(mo)).send({ ticket })));
    expect(twice.map((r) => r.status).sort((a, b) => a - b)).toEqual([200, 400]);
  });

  it('앱 Apple: 네이티브와 같은 검증으로 연결하고 refresh token 저장, 해제 때 폐기 실패면 502 로 그대로', async () => {
    const nora = await devLogin(app, '노라');
    const rawNonce = randomBytes(16).toString('hex');
    const nonce = sha256hex(rawNonce);
    const identityToken = await signAppleToken(keys, { sub: 'apple.link.1', nonce });
    const exchanged = await signAppleToken(keys, { sub: 'apple.link.1', nonce });
    const appleFetch = (revokeStatus = 200) =>
      vi.fn<typeof fetch>(async (input) => {
        const url = urlOf(input);
        if (url === APPLE_TOKEN_URL) return Response.json({ id_token: exchanged, refresh_token: 'apple-refresh-link', access_token: 'a', token_type: 'Bearer', expires_in: 1 });
        if (url === APPLE_REVOKE_URL) return revokeStatus === 200 ? new Response(null, { status: 200 }) : Response.json({ error: 'invalid_client' }, { status: revokeStatus });
        throw new Error(url);
      });
    globalThis.fetch = appleFetch();
    // nonce 가 틀리면 401
    await api(app).post('/v1/me/auth-accounts').set(auth(nora)).send({ provider: 'APPLE', identityToken, authorizationCode: 'c', nonce: 'x'.repeat(32) }).expect(401);
    const res = await api(app).post('/v1/me/auth-accounts').set(auth(nora)).send({ provider: 'APPLE', identityToken, authorizationCode: 'c', nonce: rawNonce }).expect(200);
    expect(res.body.data.account).toMatchObject({ provider: 'APPLE', label: 'Apple ID' });
    const account = await prisma.authAccount.findFirstOrThrow({ where: { userId: nora.userId, provider: 'APPLE' } });
    expect(account).toMatchObject({ providerUserId: 'apple.link.1', providerClientId: APPLE_TEST_ENV.APPLE_BUNDLE_ID, refreshToken: 'apple-refresh-link' });

    globalThis.fetch = appleFetch(400);
    expect((await api(app).delete(`/v1/me/auth-accounts/${account.id}`).set(auth(nora)).expect(502)).body.error.code).toBe('APPLE_ERROR');
    expect(await prisma.authAccount.count({ where: { id: account.id } })).toBe(1);
  });

  it('웹 Apple 연결: 콜백(form_post)이 티켓을 만들고 refresh token 을 티켓에 담는다', async () => {
    const owen = await devLogin(app, '오언');
    const intent = (await api(app).post('/v1/me/auth-accounts/link-start').set(auth(owen)).send({ provider: 'APPLE' }).expect(200)).body.data.intent;
    const go = await api(app).get('/v1/auth/apple').query({ mode: 'link', intent, next: '/me/accounts' }).expect(302);
    const setCookie = (go.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('wwm_apple_state='))!;
    const location = new URL(go.headers.location);
    const idToken = await signAppleToken(keys, { sub: 'apple.web.link', nonce: location.searchParams.get('nonce')!, aud: APPLE_TEST_ENV.APPLE_SERVICE_ID });
    globalThis.fetch = vi.fn<typeof fetch>(async () => Response.json({ id_token: idToken, refresh_token: 'web-rt', access_token: 'a', token_type: 'Bearer', expires_in: 1 }));
    const back = await api(app)
      .post('/v1/auth/apple/callback')
      .set('Cookie', setCookie.split(';')[0])
      .type('form')
      .send({ code: 'c', state: location.searchParams.get('state')! })
      .expect(302);
    const landed = new URL(back.headers.location);
    expect(landed.origin + landed.pathname).toBe(`${WEB}/me/link`);
    const ticket = landed.searchParams.get('ticket')!;
    await api(app).post('/v1/me/auth-accounts').set(auth(owen)).send({ ticket }).expect(200);
    expect(await prisma.authAccount.findFirstOrThrow({ where: { userId: owen.userId, provider: 'APPLE' } })).toMatchObject({
      providerUserId: 'apple.web.link',
      providerClientId: APPLE_TEST_ENV.APPLE_SERVICE_ID,
      refreshToken: 'web-rt',
    });
  });

  it('탈퇴는 내가 요청한 연결 메일 행도 지운다', async () => {
    const paul = await devLogin(app, '폴');
    await api(app)
      .post('/v1/auth/email/request')
      .set({ 'X-Internal-Key': KEY, 'X-Client-IP': `10.7.0.${++ipSeq}`, ...auth(paul) })
      .send({ email: 'paul-other@e2e.example', purpose: 'LINK' })
      .expect(200);
    await api(app).delete('/v1/me').set(auth(paul)).expect(200);
    expect(await prisma.emailLoginChallenge.count({ where: { userId: paul.userId } })).toBe(0);
  });
});
