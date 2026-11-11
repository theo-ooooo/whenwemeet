import { PrismaService } from '../src/prisma/prisma.service.js';
import type { MailClient, MailMessage, MailSendResult } from '../src/email-login/mail-client.js';
import { MailSendError } from '../src/email-login/mail-client.js';
import { api, assertEnvelope, auth, createTestApp, resetDb, TestApp } from './helpers.js';

/** test-env.ts 의 값 */
const KEY = 'e2e-internal-key';
const REVIEW_EMAIL = 'review@e2e.example';
const REVIEW_CODE = '246810';

/** 보낸 메일을 모아 두는 가짜 메일러. fail 이 있으면 그 오류로 실패 */
class FakeMail implements MailClient {
  sent: MailMessage[] = [];
  fail: Error | null = null;
  async send(message: MailMessage): Promise<MailSendResult> {
    this.sent.push(message);
    if (this.fail) throw this.fail;
    return { status: 'SENT', id: `msg_${this.sent.length}` };
  }
  last(to: string): { token: string; code: string } {
    const message = [...this.sent].reverse().find((m) => m.to === to);
    if (!message) throw new Error(`메일 없음: ${to}`);
    return {
      token: /token=([A-Za-z0-9_-]{43})/.exec(message.text)?.[1] ?? '',
      code: /\n(\d{6})\n/.exec(message.text)?.[1] ?? '',
    };
  }
}

/** 이메일-로그인.md 10장 API e2e: 실 DB + 가짜 메일러 */
describe('이메일 로그인 (e2e, #245)', () => {
  let app: TestApp;
  let prisma: PrismaService;
  const mail = new FakeMail();

  /** IP 횟수 제한(1시간 20통)이 다른 테스트에 번지지 않게 기본은 요청마다 다른 IP */
  let ipSeq = 0;
  const nextIp = () => {
    ipSeq += 1;
    return `10.0.${Math.floor(ipSeq / 250)}.${ipSeq % 250}`;
  };
  const post = (path: string, body: object, ip = nextIp()) =>
    api(app).post(`/v1/auth/email/${path}`).set('X-Internal-Key', KEY).set('X-Client-IP', ip).send(body);

  /** 쿨다운, 시간당 제한을 피하려고 그 이메일 행의 시각을 과거로 민다 */
  const rewind = (email: string, seconds: number) =>
    prisma.$executeRaw`UPDATE EmailLoginChallenge SET createdAt = DATE_SUB(createdAt, INTERVAL ${seconds} SECOND) WHERE email = ${email}`;

  async function requestMail(email: string, next?: string, ip?: string): Promise<{ token: string; code: string }> {
    const res = await post('request', next ? { email, next } : { email }, ip);
    expect(res.status).toBe(200);
    return mail.last(email.trim().toLowerCase());
  }

  async function signupNew(email: string, nickname: string, next?: string): Promise<{ token: string; next: string }> {
    const { code } = await requestMail(email, next);
    const verified = await post('code', { email, code, client: 'web' }).expect(200);
    expect(verified.body.data.kind).toBe('SIGNUP');
    const res = await post('signup', { signupToken: verified.body.data.signupToken, nickname }).expect(200);
    return res.body.data as { token: string; next: string };
  }

  beforeAll(async () => {
    app = await createTestApp({ mail });
    prisma = app.get(PrismaService);
    await resetDb(app);
  });

  beforeEach(() => {
    mail.sent = [];
    mail.fail = null;
  });

  afterAll(async () => {
    await resetDb(app);
    await app.close();
  });

  describe('가드 (4-1)', () => {
    it('내부 키가 없거나 틀리면 403, 응답은 no-store', async () => {
      const none = await api(app).post('/v1/auth/email/request').send({ email: 'a@b.co' }).expect(403);
      expect(none.body.error.code).toBe('FORBIDDEN');
      expect(none.headers['cache-control']).toBe('no-store');
      await api(app).post('/v1/auth/email/request').set('X-Internal-Key', 'wrong').send({ email: 'a@b.co' }).expect(403);
      expect(mail.sent).toHaveLength(0);
    });

    it('스위치가 꺼져 있으면 모든 이메일 엔드포인트 503 EMAIL_NOT_CONFIGURED (D-119)', async () => {
      const off = await createTestApp({ mail, emailEnv: { EMAIL_LOGIN_ENABLED: '' } });
      try {
        for (const path of ['request', 'link/inspect', 'link', 'code', 'signup']) {
          const res = await api(off).post(`/v1/auth/email/${path}`).set('X-Internal-Key', KEY).send({});
          expect(res.status).toBe(503);
          expect(res.body.error.code).toBe('EMAIL_NOT_CONFIGURED');
        }
      } finally {
        await off.close();
      }
    });

    it('성공 응답도 no-store', async () => {
      const res = await post('link/inspect', { token: 'x' }).expect(200);
      expect(res.headers['cache-control']).toBe('no-store');
    });
  });

  describe('검증', () => {
    it('이메일 모양, 코드 6자리, 닉네임 2~20자, client 값', async () => {
      for (const email of ['', 'no-at', '김@example.com', `${'a'.repeat(180)}@example.com`, 123]) {
        const res = await post('request', { email }).expect(400);
        expect(res.body.error.code).toBe('VALIDATION_FAILED');
      }
      await post('code', { email: 'a@b.co', code: '12345' }).expect(400);
      await post('code', { email: 'a@b.co', code: '12345a' }).expect(400);
      await post('code', { email: 'a@b.co', code: '123456', client: 'tv' }).expect(400);
      await post('signup', { signupToken: 'x'.repeat(43), nickname: ' 가 ' }).expect(400);
      await post('signup', { signupToken: 'x'.repeat(43), nickname: '가'.repeat(21) }).expect(400);
      await post('request', { email: 'a@b.co', extra: 1 }).expect(400);
      expect(mail.sent).toHaveLength(0);
    });
  });

  it('처음 이메일: request → 코드 → SIGNUP → signup → /me 닉네임, 개인 팀 1개. 다시 오면 링크로 SESSION', async () => {
    const email = 'New.User@Example.com';
    const first = await requestMail(email);
    expect(mail.sent[0]).toMatchObject({ to: 'new.user@example.com', subject: '[언제볼까] 로그인 링크와 코드' });
    expect(first.token).toHaveLength(43);
    expect(first.code).toMatch(/^\d{6}$/);

    const verified = await post('code', { email, code: first.code, client: 'web' }).expect(200);
    expect(verified.body.data).toEqual({ kind: 'SIGNUP', signupToken: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/), next: '/' });
    // 아직 계정은 없다 (D-114)
    expect(await prisma.authAccount.count({ where: { provider: 'EMAIL' } })).toBe(0);

    const signed = await post('signup', { signupToken: verified.body.data.signupToken, nickname: '  새친구 ' }).expect(200);
    expect(signed.body.data).toEqual({ token: expect.any(String), next: '/' });
    const me = await api(app).get('/v1/me').set(auth({ token: signed.body.data.token, userId: 0, nickname: '' })).expect(200);
    expect(me.body.data).toMatchObject({ nickname: '새친구', profileImageUrl: null });
    const groups = await api(app).get('/v1/groups').set(auth({ token: signed.body.data.token, userId: 0, nickname: '' })).expect(200);
    expect(groups.body.data).toHaveLength(1);
    expect(groups.body.data[0]).toMatchObject({ type: 'PERSONAL' });
    const account = await prisma.authAccount.findFirstOrThrow({ where: { provider: 'EMAIL' } });
    expect(account).toMatchObject({ providerUserId: 'new.user@example.com', email: 'new.user@example.com', rawProfile: null });

    // 가입 티켓은 1회
    await post('signup', { signupToken: verified.body.data.signupToken, nickname: '다시' }).expect(401);

    await rewind('new.user@example.com', 120);
    const second = await requestMail('new.user@example.com', '/g/1/calendar?date=2026-11-12');
    const inspect = await post('link/inspect', { token: second.token }).expect(200);
    expect(inspect.body.data).toEqual({ state: 'VALID', emailMasked: 'ne***@example.com' });
    const linked = await post('link', { token: second.token, client: 'web' }).expect(200);
    expect(linked.body.data).toEqual({ kind: 'SESSION', token: expect.any(String), next: '/g/1/calendar?date=2026-11-12' });
    const again = await api(app).get('/v1/me').set(auth({ token: linked.body.data.token, userId: 0, nickname: '' })).expect(200);
    expect(again.body.data.id).toBe(me.body.data.id);
    expect(await prisma.user.count()).toBe(1);
  });

  it('계정 존재와 무관하게 request 응답이 같다, 발송 실패도 같은 200 (FAILED 로 남음)', async () => {
    await signupNew('exists@example.com', '있는사람');
    await rewind('exists@example.com', 120);
    const a = await post('request', { email: 'exists@example.com' }).expect(200);
    const b = await post('request', { email: 'nobody@example.com' }).expect(200);
    mail.fail = new MailSendError(422, 'validation_error');
    const c = await post('request', { email: 'bounce@example.com' }).expect(200);
    expect(a.body).toEqual(b.body);
    expect(c.body).toEqual(b.body);
    expect(b.body.data).toEqual({ cooldownSec: 60, expiresInSec: 900 });
    const rows = await prisma.emailLoginChallenge.findMany({ where: { email: { in: ['nobody@example.com', 'bounce@example.com'] } }, orderBy: { id: 'asc' } });
    expect(rows.map((r) => [r.sendStatus, r.providerMessageId])).toEqual([
      ['SENT', expect.stringMatching(/^msg_/)],
      ['FAILED', null],
    ]);
  });

  it('DB 에는 해시만: 토큰, 코드, IP 원문이 없다', async () => {
    const { token, code } = await requestMail('hash@example.com', undefined, '203.0.113.99');
    const row = await prisma.emailLoginChallenge.findFirstOrThrow({ where: { email: 'hash@example.com' } });
    const values = JSON.stringify(row);
    expect(values).not.toContain(token);
    expect(values).not.toContain(`"${code}"`);
    expect(values).not.toContain('203.0.113.99');
    expect(row.linkTokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.codeHash).toMatch(/^[0-9a-f]{64}$/);
  });

  describe('1회 사용, 형제 무효 (3장)', () => {
    it('링크를 쓰면 같은 메일의 코드는 EXPIRED, 링크 다시 쓰면 USED. inspect 는 소비하지 않는다', async () => {
      const email = 'sibling@example.com';
      const { token, code } = await requestMail(email);
      await post('link/inspect', { token }).expect(200);
      await post('link/inspect', { token }).expect(200);
      await post('link', { token }).expect(200);
      const codeRes = await post('code', { email, code }).expect(400);
      expect(codeRes.body.error.code).toBe('EMAIL_CODE_EXPIRED');
      const reuse = await post('link', { token }).expect(400);
      expect(reuse.body.error).toEqual({ code: 'EMAIL_LINK_INVALID', details: { reason: 'USED' } });
      expect((await post('link/inspect', { token }).expect(200)).body.data.state).toBe('USED');
    });

    it('코드를 쓰면 같은 메일의 링크는 USED', async () => {
      const email = 'sibling2@example.com';
      const { token, code } = await requestMail(email);
      await post('code', { email, code }).expect(200);
      expect((await post('link', { token }).expect(400)).body.error.details).toEqual({ reason: 'USED' });
    });

    it('새로 받으면 이전 링크와 코드는 EXPIRED', async () => {
      const email = 'renew@example.com';
      const old = await requestMail(email);
      await rewind(email, 61);
      const fresh = await requestMail(email);
      expect((await post('link', { token: old.token }).expect(400)).body.error.details).toEqual({ reason: 'EXPIRED' });
      if (old.code !== fresh.code) {
        const res = await post('code', { email, code: old.code }).expect(400);
        expect(res.body.error).toEqual({ code: 'EMAIL_CODE_INVALID', details: { attemptsLeft: 4 } });
      }
      await post('code', { email, code: fresh.code }).expect(200);
    });

    it('15분이 지나면 링크 EXPIRED, 코드 EXPIRED', async () => {
      const email = 'late@example.com';
      const { token, code } = await requestMail(email);
      await prisma.emailLoginChallenge.updateMany({ where: { email }, data: { expiresAt: new Date(Date.now() - 1000) } });
      expect((await post('link/inspect', { token }).expect(200)).body.data.state).toBe('EXPIRED');
      expect((await post('link', { token }).expect(400)).body.error.details).toEqual({ reason: 'EXPIRED' });
      expect((await post('code', { email, code }).expect(400)).body.error.code).toBe('EMAIL_CODE_EXPIRED');
    });

    it('없는 토큰은 INVALID', async () => {
      const token = 'Z'.repeat(43);
      expect((await post('link/inspect', { token }).expect(200)).body.data).toEqual({ state: 'INVALID', emailMasked: null });
      expect((await post('link', { token }).expect(400)).body.error.details).toEqual({ reason: 'INVALID' });
      expect((await post('link', { token: 'short' }).expect(400)).body.error.details).toEqual({ reason: 'INVALID' });
    });
  });

  describe('틀린 코드 (3장)', () => {
    const wrongOf = (code: string) => String((Number(code) + 1) % 1_000_000).padStart(6, '0');

    it('4번 틀린 뒤 맞으면 성공', async () => {
      const email = 'four@example.com';
      const { code } = await requestMail(email);
      for (let left = 4; left >= 1; left -= 1) {
        const res = await post('code', { email, code: wrongOf(code) }).expect(400);
        expect(res.body.error).toEqual({ code: 'EMAIL_CODE_INVALID', details: { attemptsLeft: left } });
      }
      await post('code', { email, code }).expect(200);
    });

    it('5번째 틀림 LOCKED → 맞는 코드도 EXPIRED, 링크도 EXPIRED', async () => {
      const email = 'five@example.com';
      const { token, code } = await requestMail(email);
      for (let i = 0; i < 4; i += 1) await post('code', { email, code: wrongOf(code) }).expect(400);
      const locked = await post('code', { email, code: wrongOf(code) }).expect(400);
      expect(locked.body.error.code).toBe('EMAIL_CODE_LOCKED');
      expect((await post('code', { email, code }).expect(400)).body.error.code).toBe('EMAIL_CODE_EXPIRED');
      expect((await post('link', { token }).expect(400)).body.error.details).toEqual({ reason: 'EXPIRED' });
      const row = await prisma.emailLoginChallenge.findFirstOrThrow({ where: { email } });
      expect(row.attempts).toBe(5);
      expect(row.invalidatedAt).not.toBeNull();
    });

    it('동시에 6번 틀려도 attempts 는 5 에서 멈춘다', async () => {
      const email = 'race-wrong@example.com';
      const { code } = await requestMail(email);
      const results = await Promise.all(Array.from({ length: 6 }, () => post('code', { email, code: wrongOf(code) })));
      expect(results.every((r) => r.status === 400)).toBe(true);
      const row = await prisma.emailLoginChallenge.findFirstOrThrow({ where: { email } });
      expect(row.attempts).toBe(5);
      expect(results.filter((r) => r.body.error.code === 'EMAIL_CODE_LOCKED')).toHaveLength(1);
    });
  });

  describe('동시성', () => {
    it('같은 메일의 링크와 코드를 동시에 써도 1건만 성공', async () => {
      const email = 'race@example.com';
      const { token, code } = await requestMail(email);
      const results = await Promise.all([post('link', { token }), post('code', { email, code }), post('link', { token })]);
      expect(results.filter((r) => r.status === 200)).toHaveLength(1);
      const row = await prisma.emailLoginChallenge.findFirstOrThrow({ where: { email } });
      expect(row.usedAt).not.toBeNull();
    });

    it('같은 이메일 가입 2건(다른 티켓)이 동시에 와도 계정 1개, 둘 다 같은 사용자로 로그인', async () => {
      const email = 'twotabs@example.com';
      const tickets: string[] = [];
      for (let i = 0; i < 2; i += 1) {
        if (i > 0) await rewind(email, 61);
        const { code } = await requestMail(email);
        tickets.push((await post('code', { email, code }).expect(200)).body.data.signupToken as string);
      }
      const results = await Promise.all(tickets.map((signupToken, i) => post('signup', { signupToken, nickname: `탭${i}` })));
      expect(results.map((r) => r.status)).toEqual([200, 200]);
      expect(await prisma.authAccount.count({ where: { provider: 'EMAIL', providerUserId: email } })).toBe(1);
      const ids = await Promise.all(
        results.map(async (r) => (await api(app).get('/v1/me').set('Authorization', `Bearer ${r.body.data.token}`).expect(200)).body.data.id),
      );
      expect(ids[0]).toBe(ids[1]);
    });

    it('같은 가입 티켓 2번 동시 → 1건만 200', async () => {
      const email = 'oneticket@example.com';
      const { code } = await requestMail(email);
      const signupToken = (await post('code', { email, code }).expect(200)).body.data.signupToken as string;
      const results = await Promise.all([post('signup', { signupToken, nickname: '하나' }), post('signup', { signupToken, nickname: '둘째' })]);
      expect(results.map((r) => r.status).sort((a, b) => a - b)).toEqual([200, 401]);
      expect(results.find((r) => r.status === 401)?.body.error.code).toBe('SIGNUP_TOKEN_INVALID');
    });
  });

  describe('횟수 제한 (D-111)', () => {
    it('60초 쿨다운 → 429 COOLDOWN, 1시간 5통 → HOURLY', async () => {
      const email = 'limit@example.com';
      await requestMail(email);
      const cool = await post('request', { email }).expect(429);
      expect(cool.body.error.code).toBe('EMAIL_RATE_LIMITED');
      expect(cool.body.error.details).toEqual({ reason: 'COOLDOWN', retryAfterSec: expect.any(Number) });
      expect(cool.body.error.details.retryAfterSec).toBeGreaterThan(55);
      expect(cool.body.error.details.retryAfterSec).toBeLessThanOrEqual(60);
      for (let i = 1; i < 5; i += 1) {
        await rewind(email, 61);
        await requestMail(email);
      }
      await rewind(email, 61);
      const hourly = await post('request', { email }).expect(429);
      expect(hourly.body.error.details.reason).toBe('HOURLY');
      expect(mail.sent.filter((m) => m.to === email)).toHaveLength(5);
    });

    it('같은 IP 1시간 20통 → IP. 발송 실패 행도 센다. 다른 IP 는 통과', async () => {
      const ip = '192.0.2.77';
      mail.fail = new MailSendError(500, 'internal_server_error');
      for (let i = 0; i < 20; i += 1) await post('request', { email: `ip${i}@example.com` }, ip).expect(200);
      mail.fail = null;
      const res = await post('request', { email: 'ip20@example.com' }, ip).expect(429);
      expect(res.body.error.details.reason).toBe('IP');
      await post('request', { email: 'ip20@example.com' }, '192.0.2.78').expect(200);
    });
  });

  describe('심사 계정 (D-118)', () => {
    it('메일을 보내지 않고 고정 코드로만 로그인. 다른 코드는 실패', async () => {
      await post('request', { email: REVIEW_EMAIL.toUpperCase() }).expect(200);
      expect(mail.sent).toHaveLength(0);
      const row = await prisma.emailLoginChallenge.findFirstOrThrow({ where: { email: REVIEW_EMAIL } });
      expect(row).toMatchObject({ isReview: true, sendStatus: 'SKIPPED' });
      const wrong = await post('code', { email: REVIEW_EMAIL, code: '000000' }).expect(400);
      expect(wrong.body.error.code).toBe('EMAIL_CODE_INVALID');
      const ok = await post('code', { email: REVIEW_EMAIL, code: REVIEW_CODE, client: 'app' }).expect(200);
      expect(ok.body.data.kind).toBe('SIGNUP');
    });
  });

  it('app 으로 로그인하면 lastAppLoginAt (D-97)', async () => {
    const email = 'app@example.com';
    const { code } = await requestMail(email);
    const signupToken = (await post('code', { email, code, client: 'app' }).expect(200)).body.data.signupToken as string;
    await post('signup', { signupToken, nickname: '앱사람', client: 'app' }).expect(200);
    const account = await prisma.authAccount.findFirstOrThrow({ where: { providerUserId: email }, select: { user: { select: { lastAppLoginAt: true } } } });
    expect(account.user.lastAppLoginAt).not.toBeNull();
  });

  it('초대 합류: next(/join/<코드>?auto=1)를 그대로 돌려주고, 방금 받은 JWT 로 바로 합류', async () => {
    const owner = await signupNew('owner@example.com', '팀장');
    const created = await api(app).post('/v1/groups').set('Authorization', `Bearer ${owner.token}`).send({ name: '우리팀' }).expect(201);
    const inviteCode = created.body.data.inviteCode as string;
    const joiner = await signupNew('joiner@example.com', '팀원', `/join/${inviteCode}?auto=1`);
    expect(joiner.next).toBe(`/join/${inviteCode}?auto=1`);
    await api(app).post('/v1/groups/join').set('Authorization', `Bearer ${joiner.token}`).send({ code: inviteCode }).expect((res) => {
      expect([200, 201]).toContain(res.status);
    });
  });

  it('탈퇴하면 EMAIL 계정과 그 이메일의 발송 기록이 지워진다 (8-1)', async () => {
    const email = 'leaver@example.com';
    const session = await signupNew(email, '떠날사람');
    await rewind(email, 61);
    await requestMail(email);
    expect(await prisma.emailLoginChallenge.count({ where: { email } })).toBe(2);
    await api(app).delete('/v1/me').set('Authorization', `Bearer ${session.token}`).expect(200);
    expect(await prisma.emailLoginChallenge.count({ where: { email } })).toBe(0);
    expect(await prisma.authAccount.count({ where: { providerUserId: email } })).toBe(0);
    // 다른 사람의 기록은 그대로
    expect(await prisma.emailLoginChallenge.count()).toBeGreaterThan(0);
  });

  it('요청마다 30일 지난 행을 지운다', async () => {
    await requestMail('old@example.com');
    await prisma.emailLoginChallenge.updateMany({ where: { email: 'old@example.com' }, data: { createdAt: new Date(Date.now() - 31 * 24 * 3600 * 1000) } });
    await requestMail('trigger@example.com');
    expect(await prisma.emailLoginChallenge.count({ where: { email: 'old@example.com' } })).toBe(0);
  });

  it('응답 봉투 (D-33)', async () => {
    const res = await post('link/inspect', { token: 'x' });
    assertEnvelope(res);
  });
});
