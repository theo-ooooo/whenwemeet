import { ApiException } from '../common/errors.js';
import { fakeConfig } from '../testing/fake-config.js';
import { mockRepository, RepositoryMock } from '../testing/repository-mock.js';
import { UsersRepository } from '../users/users.repository.js';
import { hashCode, sha256hex } from './email-crypto.js';
import { EmailLoginConfig } from './email-login.config.js';
import { ChallengeRow, EmailLoginChallengesRepository } from './email-login.repository.js';
import { CHALLENGE_TTL_MS, EmailLoginService, linkStateOf, RETENTION_MS, SIGNUP_TTL_MS } from './email-login.service.js';
import { MailSendError, type MailClient, type MailMessage } from './mail-client.js';

const SECRET = 'unit-secret-0123456789abcdef0123456789';
const NOW = new Date('2026-11-11T03:00:00.000Z');
const TOKEN = 'A'.repeat(43);

function config(env: Record<string, string> = {}): EmailLoginConfig {
  return new EmailLoginConfig(fakeConfig({ JWT_SECRET: SECRET, WEB_ORIGIN: 'https://whenwemeet.day', EMAIL_LOGIN_ENABLED: '1', ...env }));
}

function row(overrides: Partial<ChallengeRow> = {}): ChallengeRow {
  return {
    id: 7,
    email: 'kim@example.com',
    linkTokenHash: sha256hex(TOKEN),
    codeHash: '',
    attempts: 0,
    expiresAt: new Date(NOW.getTime() + CHALLENGE_TTL_MS),
    usedAt: null,
    invalidatedAt: null,
    next: '/join/ABC123?auto=1',
    isReview: false,
    ...overrides,
  };
}

/** 메일 발송 결과를 꺼내 보는 가짜 메일러 */
class FakeMail implements MailClient {
  sent: MailMessage[] = [];
  next: () => Promise<{ status: 'SENT'; id: string | null } | { status: 'SKIPPED' }> = async () => ({ status: 'SENT', id: 'msg_1' });
  async send(message: MailMessage) {
    this.sent.push(message);
    return this.next();
  }
}

function extract(message: MailMessage): { token: string; code: string } {
  const token = /token=([A-Za-z0-9_-]{43})/.exec(message.text)?.[1] ?? '';
  const code = /\n(\d{6})\n/.exec(message.text)?.[1] ?? '';
  return { token, code };
}

describe('EmailLoginService (#245)', () => {
  let challenges: RepositoryMock<EmailLoginChallengesRepository>;
  let users: RepositoryMock<UsersRepository>;
  let mail: FakeMail;
  let cfg: EmailLoginConfig;
  let service: EmailLoginService;
  let logs: string[];
  const auth = { signToken: vi.fn(async (id: number) => `jwt-${id}`) };

  function build(env: Record<string, string> = {}) {
    cfg = config(env);
    service = new EmailLoginService(challenges as never, users as never, auth as never, cfg, mail);
    logs = [];
    const logger = (service as unknown as { logger: Record<string, (m: string) => void> }).logger;
    vi.spyOn(logger, 'log').mockImplementation((m: string) => void logs.push(m));
    vi.spyOn(logger, 'warn').mockImplementation((m: string) => void logs.push(m));
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    challenges = mockRepository(EmailLoginChallengesRepository);
    users = mockRepository(UsersRepository);
    mail = new FakeMail();
    auth.signToken.mockClear();
    challenges.latestCreatedAtByEmail.mockResolvedValue(null);
    challenges.countRecentByEmail.mockResolvedValue({ count: 0, oldest: null });
    challenges.countRecentByIp.mockResolvedValue({ count: 0, oldest: null });
    challenges.invalidateLiveAndCreateTx.mockResolvedValue(7);
    challenges.markSendResult.mockResolvedValue(undefined);
    challenges.deleteCreatedBefore.mockResolvedValue(0);
    build();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('request', () => {
    it('행 1개(해시만), 메일 1통(링크와 코드), SENT 기록, 30일 청소, 고정 응답. 사용자를 조회하지 않는다', async () => {
      const result = await service.request({ email: '  Kim@Example.COM ', next: '/join/ABC123?auto=1', clientIp: '203.0.113.7' });
      expect(result).toEqual({ cooldownSec: 60, expiresInSec: 900 });

      const input = challenges.invalidateLiveAndCreateTx.mock.calls[0][0];
      expect(mail.sent).toHaveLength(1);
      const { token, code } = extract(mail.sent[0]);
      expect(mail.sent[0]).toMatchObject({ to: 'kim@example.com', subject: '[언제볼까] 로그인 링크와 코드', idempotencyKey: 'email-login-7' });
      expect(mail.sent[0].text).toContain(`https://whenwemeet.day/auth/email?token=${token}`);
      expect(input).toMatchObject({
        email: 'kim@example.com',
        linkTokenHash: sha256hex(token),
        codeHash: hashCode(cfg.codeKey, sha256hex(token), code),
        next: '/join/ABC123?auto=1',
        isReview: false,
        sendStatus: 'FAILED',
        createdAt: NOW,
        expiresAt: new Date(NOW.getTime() + CHALLENGE_TTL_MS),
      });
      expect(input.ipHash).toMatch(/^[0-9a-f]{64}$/);
      expect(input.ipHash).not.toContain('203.0.113.7');
      expect(challenges.markSendResult).toHaveBeenCalledWith(7, 'SENT', 'msg_1');
      expect(challenges.deleteCreatedBefore).toHaveBeenCalledWith(new Date(NOW.getTime() - RETENTION_MS));
      expect(users.findUserIdByAccount).not.toHaveBeenCalled();
      expect(users.findAuthAccount).not.toHaveBeenCalled();
      // 로그에는 도메인만. 이메일 전체, 토큰, 코드는 없다 (9-3)
      expect(logs.join('\n')).toContain('domain=example.com');
      expect(logs.join('\n')).not.toMatch(new RegExp(`kim@|${token}|${code}`));
    });

    it('next 는 sanitizeNext 로 거른다', async () => {
      await service.request({ email: 'a@b.co', next: 'https://evil.example', clientIp: 'x' });
      expect(challenges.invalidateLiveAndCreateTx.mock.calls[0][0].next).toBe('/');
    });

    it('발송 실패(Resend 오류, 시간 초과, 예외)여도 같은 200, 행은 FAILED 로 남는다 (3-2)', async () => {
      for (const failure of [new MailSendError(422, 'validation_error'), new MailSendError(null, 'TIMEOUT'), new Error('boom')]) {
        mail.next = async () => Promise.reject(failure);
        challenges.markSendResult.mockClear();
        expect(await service.request({ email: 'a@b.co', clientIp: 'x' })).toEqual({ cooldownSec: 60, expiresInSec: 900 });
        expect(challenges.markSendResult).not.toHaveBeenCalled();
      }
      expect(logs.some((line) => line.includes('sendStatus=FAILED http=422 error=validation_error'))).toBe(true);
      expect(logs.some((line) => line.includes('error=TIMEOUT'))).toBe(true);
    });

    it('콘솔 메일러(개발)는 SKIPPED 로 기록', async () => {
      mail.next = async () => ({ status: 'SKIPPED' });
      await service.request({ email: 'a@b.co', clientIp: 'x' });
      expect(challenges.markSendResult).toHaveBeenCalledWith(7, 'SKIPPED', null);
    });

    describe('횟수 제한 (고정 시계, D-111)', () => {
      const ago = (ms: number) => new Date(NOW.getTime() - ms);

      it('59초 전 → COOLDOWN (retryAfterSec 1), 60초 전 → 통과', async () => {
        challenges.latestCreatedAtByEmail.mockResolvedValue(ago(59_000));
        await expect(service.request({ email: 'a@b.co', clientIp: 'x' })).rejects.toMatchObject({
          code: 'EMAIL_RATE_LIMITED',
          reason: { reason: 'COOLDOWN', retryAfterSec: 1 },
        });
        expect(challenges.invalidateLiveAndCreateTx).not.toHaveBeenCalled();
        expect(mail.sent).toHaveLength(0);

        challenges.latestCreatedAtByEmail.mockResolvedValue(ago(60_000));
        await expect(service.request({ email: 'a@b.co', clientIp: 'x' })).resolves.toBeDefined();
      });

      it('1시간 5통이면 HOURLY, retryAfterSec = 가장 오래된 행 + 1시간 - now', async () => {
        challenges.latestCreatedAtByEmail.mockResolvedValue(ago(5 * 60_000));
        challenges.countRecentByEmail.mockResolvedValue({ count: 5, oldest: ago(40 * 60_000) });
        const error = (await service.request({ email: 'a@b.co', clientIp: 'x' }).catch((e: unknown) => e)) as ApiException;
        expect(error.code).toBe('EMAIL_RATE_LIMITED');
        expect(error.getStatus()).toBe(429);
        expect(error.toBody().error.details).toEqual({ reason: 'HOURLY', retryAfterSec: 20 * 60 });
        expect(challenges.countRecentByEmail).toHaveBeenCalledWith('a@b.co', ago(60 * 60_000));

        challenges.countRecentByEmail.mockResolvedValue({ count: 4, oldest: ago(40 * 60_000) });
        await expect(service.request({ email: 'a@b.co', clientIp: 'x' })).resolves.toBeDefined();
      });

      it('같은 IP 1시간 20통이면 IP (발송 실패 행도 센다 = 행 수 기준)', async () => {
        challenges.countRecentByIp.mockResolvedValue({ count: 20, oldest: ago(59 * 60_000 + 30_000) });
        await expect(service.request({ email: 'new@b.co', clientIp: '203.0.113.7' })).rejects.toMatchObject({
          reason: { reason: 'IP', retryAfterSec: 30 },
        });
        const ipHash = challenges.countRecentByIp.mock.calls[0][0];
        challenges.countRecentByIp.mockResolvedValue({ count: 19, oldest: null });
        await service.request({ email: 'new@b.co', clientIp: '203.0.113.7' });
        expect(challenges.invalidateLiveAndCreateTx.mock.calls[0][0].ipHash).toBe(ipHash);
      });
    });

    describe('심사 계정 (D-118)', () => {
      it('메일을 보내지 않고 REVIEW_CODE 의 해시를 넣는다 (SKIPPED)', async () => {
        build({ REVIEW_EMAIL: 'review@whenwemeet.day', REVIEW_CODE: '246810' });
        await service.request({ email: 'Review@WhenWeMeet.day', clientIp: 'x' });
        expect(mail.sent).toHaveLength(0);
        const input = challenges.invalidateLiveAndCreateTx.mock.calls[0][0];
        expect(input).toMatchObject({ isReview: true, sendStatus: 'SKIPPED' });
        expect(input.codeHash).toBe(hashCode(cfg.codeKey, input.linkTokenHash, '246810'));
        expect(challenges.markSendResult).not.toHaveBeenCalled();
      });

      it('설정이 불완전하면 그 이메일도 일반처럼 발송', async () => {
        build({ REVIEW_EMAIL: 'review@whenwemeet.day', REVIEW_CODE: '12345' });
        await service.request({ email: 'review@whenwemeet.day', clientIp: 'x' });
        expect(mail.sent).toHaveLength(1);
        expect(challenges.invalidateLiveAndCreateTx.mock.calls[0][0].isReview).toBe(false);
      });
    });
  });

  describe('inspect (D-113)', () => {
    it('형식이 틀리거나 없으면 INVALID + null, 있으면 상태와 가린 이메일. 소비하지 않는다', async () => {
      expect(await service.inspect('short')).toEqual({ state: 'INVALID', emailMasked: null });
      expect(challenges.findByLinkTokenHash).not.toHaveBeenCalled();
      challenges.findByLinkTokenHash.mockResolvedValue(null);
      expect(await service.inspect(TOKEN)).toEqual({ state: 'INVALID', emailMasked: null });
      challenges.findByLinkTokenHash.mockResolvedValue(row());
      expect(await service.inspect(TOKEN)).toEqual({ state: 'VALID', emailMasked: 'ki***@example.com' });
      expect(challenges.findByLinkTokenHash).toHaveBeenCalledWith(sha256hex(TOKEN));
      challenges.findByLinkTokenHash.mockResolvedValue(row({ usedAt: NOW }));
      expect((await service.inspect(TOKEN)).state).toBe('USED');
      challenges.findByLinkTokenHash.mockResolvedValue(row({ invalidatedAt: NOW }));
      expect((await service.inspect(TOKEN)).state).toBe('EXPIRED');
      expect(challenges.consume).not.toHaveBeenCalled();
    });

    it('linkStateOf: 15분 경계 (expiresAt == now 이면 만료), 사용됨이 먼저', () => {
      expect(linkStateOf(row({ expiresAt: new Date(NOW.getTime() + 1) }), NOW)).toBe('VALID');
      expect(linkStateOf(row({ expiresAt: NOW }), NOW)).toBe('EXPIRED');
      expect(linkStateOf(row({ usedAt: NOW, invalidatedAt: NOW }), NOW)).toBe('USED');
      expect(linkStateOf(null, NOW)).toBe('INVALID');
    });
  });

  describe('verifyLink', () => {
    it('형식 틀림, 없음, 사용됨, 만료 → EMAIL_LINK_INVALID { reason }', async () => {
      await expect(service.verifyLink('bad', 'web')).rejects.toMatchObject({ code: 'EMAIL_LINK_INVALID', reason: { reason: 'INVALID' } });
      challenges.findByLinkTokenHash.mockResolvedValue(null);
      await expect(service.verifyLink(TOKEN, 'web')).rejects.toMatchObject({ reason: { reason: 'INVALID' } });
      challenges.findByLinkTokenHash.mockResolvedValue(row({ usedAt: NOW }));
      await expect(service.verifyLink(TOKEN, 'web')).rejects.toMatchObject({ reason: { reason: 'USED' } });
      challenges.findByLinkTokenHash.mockResolvedValue(row({ expiresAt: NOW }));
      await expect(service.verifyLink(TOKEN, 'web')).rejects.toMatchObject({ reason: { reason: 'EXPIRED' } });
      expect(challenges.consume).not.toHaveBeenCalled();
    });

    it('동시 소비에 져서 count 0 이면 다시 판정 (사용됨 → USED, 무효 → EXPIRED)', async () => {
      challenges.findByLinkTokenHash.mockResolvedValue(row());
      challenges.consume.mockResolvedValue(false);
      challenges.findById.mockResolvedValue(row({ usedAt: NOW }));
      await expect(service.verifyLink(TOKEN, 'web')).rejects.toMatchObject({ reason: { reason: 'USED' } });
      challenges.findById.mockResolvedValue(row({ invalidatedAt: NOW }));
      await expect(service.verifyLink(TOKEN, 'web')).rejects.toMatchObject({ reason: { reason: 'EXPIRED' } });
      challenges.findById.mockResolvedValue(row());
      await expect(service.verifyLink(TOKEN, 'web')).rejects.toMatchObject({ reason: { reason: 'USED' } });
    });

    it('기존 계정이면 SESSION (JWT, 행의 next). app 이면 lastAppLoginAt', async () => {
      challenges.findByLinkTokenHash.mockResolvedValue(row());
      challenges.consume.mockResolvedValue(true);
      users.findUserIdByAccount.mockResolvedValue(42);
      expect(await service.verifyLink(TOKEN, 'web')).toEqual({ kind: 'SESSION', token: 'jwt-42', next: '/join/ABC123?auto=1' });
      expect(challenges.consume).toHaveBeenCalledWith(7, 'LINK', NOW);
      expect(users.findUserIdByAccount).toHaveBeenCalledWith('EMAIL', 'kim@example.com');
      expect(users.markAppLogin).not.toHaveBeenCalled();
      await service.verifyLink(TOKEN, 'app');
      expect(users.markAppLogin).toHaveBeenCalledWith(42, NOW);
      expect(challenges.setSignupTicket).not.toHaveBeenCalled();
    });

    it('처음 이메일이면 SIGNUP: 30분 가입 티켓의 해시만 저장', async () => {
      challenges.findByLinkTokenHash.mockResolvedValue(row());
      challenges.consume.mockResolvedValue(true);
      users.findUserIdByAccount.mockResolvedValue(null);
      const result = await service.verifyLink(TOKEN, 'web');
      expect(result.kind).toBe('SIGNUP');
      if (result.kind !== 'SIGNUP') return;
      expect(result.signupToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(result.next).toBe('/join/ABC123?auto=1');
      expect(challenges.setSignupTicket).toHaveBeenCalledWith(7, sha256hex(result.signupToken), new Date(NOW.getTime() + SIGNUP_TTL_MS));
      expect(auth.signToken).not.toHaveBeenCalled();
    });
  });

  describe('verifyCode', () => {
    const CODE = '012345';
    const live = () => row({ codeHash: hashCode(cfg.codeKey, sha256hex(TOKEN), CODE) });

    beforeEach(() => {
      auth.signToken.mockClear();
    });

    it('살아 있는 메일이 없으면 EMAIL_CODE_EXPIRED (이메일은 정규화해 찾는다)', async () => {
      challenges.findLatestLiveByEmail.mockResolvedValue(null);
      await expect(service.verifyCode(' KIM@example.com', CODE, 'web')).rejects.toMatchObject({ code: 'EMAIL_CODE_EXPIRED' });
      expect(challenges.findLatestLiveByEmail).toHaveBeenCalledWith('kim@example.com', NOW);
    });

    it('틀리면 attempts +1 → EMAIL_CODE_INVALID { attemptsLeft }, 5번째는 LOCKED, 이미 끝난 행이면 EXPIRED', async () => {
      challenges.findLatestLiveByEmail.mockResolvedValue(live());
      challenges.registerWrongCodeTx.mockResolvedValue({ counted: true, attempts: 1, locked: false });
      await expect(service.verifyCode('kim@example.com', '999999', 'web')).rejects.toMatchObject({ code: 'EMAIL_CODE_INVALID', reason: { attemptsLeft: 4 } });
      expect(challenges.registerWrongCodeTx).toHaveBeenCalledWith(7, NOW, 5);
      challenges.registerWrongCodeTx.mockResolvedValue({ counted: true, attempts: 4, locked: false });
      await expect(service.verifyCode('kim@example.com', '999999', 'web')).rejects.toMatchObject({ reason: { attemptsLeft: 1 } });
      challenges.registerWrongCodeTx.mockResolvedValue({ counted: true, attempts: 5, locked: true });
      await expect(service.verifyCode('kim@example.com', '999999', 'web')).rejects.toMatchObject({ code: 'EMAIL_CODE_LOCKED' });
      challenges.registerWrongCodeTx.mockResolvedValue({ counted: false, attempts: 5, locked: false });
      await expect(service.verifyCode('kim@example.com', '999999', 'web')).rejects.toMatchObject({ code: 'EMAIL_CODE_EXPIRED' });
      expect(challenges.consume).not.toHaveBeenCalled();
    });

    it('맞으면 소비 → SESSION. 소비에 지면 EXPIRED', async () => {
      challenges.findLatestLiveByEmail.mockResolvedValue(live());
      challenges.consume.mockResolvedValue(true);
      users.findUserIdByAccount.mockResolvedValue(42);
      expect(await service.verifyCode('kim@example.com', CODE, 'app')).toEqual({ kind: 'SESSION', token: 'jwt-42', next: '/join/ABC123?auto=1' });
      expect(challenges.consume).toHaveBeenCalledWith(7, 'CODE', NOW);
      expect(users.markAppLogin).toHaveBeenCalledWith(42, NOW);
      expect(challenges.registerWrongCodeTx).not.toHaveBeenCalled();

      challenges.consume.mockResolvedValue(false);
      await expect(service.verifyCode('kim@example.com', CODE, 'web')).rejects.toMatchObject({ code: 'EMAIL_CODE_EXPIRED' });
    });

    it('심사 계정: 고정 코드로 같은 검증 경로를 지난다, 다른 코드는 실패', async () => {
      build({ REVIEW_EMAIL: 'review@whenwemeet.day', REVIEW_CODE: '246810' });
      await service.request({ email: 'review@whenwemeet.day', clientIp: 'x' });
      const input = challenges.invalidateLiveAndCreateTx.mock.calls[0][0];
      challenges.findLatestLiveByEmail.mockResolvedValue(row({ email: input.email, linkTokenHash: input.linkTokenHash, codeHash: input.codeHash, isReview: true }));
      challenges.registerWrongCodeTx.mockResolvedValue({ counted: true, attempts: 1, locked: false });
      await expect(service.verifyCode('review@whenwemeet.day', '000000', 'app')).rejects.toMatchObject({ code: 'EMAIL_CODE_INVALID' });
      challenges.consume.mockResolvedValue(true);
      users.findUserIdByAccount.mockResolvedValue(99);
      expect(await service.verifyCode('review@whenwemeet.day', '246810', 'app')).toMatchObject({ kind: 'SESSION', token: 'jwt-99' });
    });
  });

  describe('signup (D-114)', () => {
    const SIGNUP = 'S'.repeat(43);
    const ticket = { id: 7, email: 'kim@example.com', next: '/join/ABC123?auto=1' };

    it('형식 틀림, 없음/만료, 소비에 짐 → 401 SIGNUP_TOKEN_INVALID', async () => {
      await expect(service.signup('bad', '닉네임', 'web')).rejects.toMatchObject({ code: 'SIGNUP_TOKEN_INVALID' });
      challenges.findSignupTicket.mockResolvedValue(null);
      await expect(service.signup(SIGNUP, '닉네임', 'web')).rejects.toMatchObject({ code: 'SIGNUP_TOKEN_INVALID' });
      expect(challenges.findSignupTicket).toHaveBeenCalledWith(sha256hex(SIGNUP), NOW);
      challenges.findSignupTicket.mockResolvedValue(ticket);
      challenges.consumeSignupTicket.mockResolvedValue(false);
      await expect(service.signup(SIGNUP, '닉네임', 'web')).rejects.toMatchObject({ code: 'SIGNUP_TOKEN_INVALID' });
      expect(users.createWithAccountTx).not.toHaveBeenCalled();
    });

    it('User + EMAIL 계정(rawProfile null) + 개인 팀 → JWT, 행의 next', async () => {
      challenges.findSignupTicket.mockResolvedValue(ticket);
      challenges.consumeSignupTicket.mockResolvedValue(true);
      users.createWithAccountTx.mockResolvedValue({ id: 5, nickname: '닉네임', profileImageUrl: null, createdAt: NOW });
      expect(await service.signup(SIGNUP, '닉네임', 'web')).toEqual({ token: 'jwt-5', next: '/join/ABC123?auto=1' });
      expect(users.createWithAccountTx).toHaveBeenCalledWith(
        { provider: 'EMAIL', providerUserId: 'kim@example.com', email: 'kim@example.com', rawProfile: null, nickname: '닉네임' },
        { name: '내 달력', color: '#F26D6D', publicCode: expect.stringMatching(/^[a-z0-9]{8}$/) },
      );
      expect(users.markAppLogin).not.toHaveBeenCalled();
      await service.signup(SIGNUP, '닉네임', 'app');
      expect(users.markAppLogin).toHaveBeenCalledWith(5, NOW);
    });

    it('같은 이메일이 먼저 가입했으면(P2002) 그 계정으로 로그인. 계정이 없거나 다른 오류면 그대로 던진다', async () => {
      challenges.findSignupTicket.mockResolvedValue(ticket);
      challenges.consumeSignupTicket.mockResolvedValue(true);
      users.createWithAccountTx.mockRejectedValue({ code: 'P2002' });
      users.findUserIdByAccount.mockResolvedValue(8);
      expect(await service.signup(SIGNUP, '닉네임', 'web')).toEqual({ token: 'jwt-8', next: '/join/ABC123?auto=1' });

      users.findUserIdByAccount.mockResolvedValue(null);
      await expect(service.signup(SIGNUP, '닉네임', 'web')).rejects.toEqual({ code: 'P2002' });
      users.createWithAccountTx.mockRejectedValue(new Error('db down'));
      await expect(service.signup(SIGNUP, '닉네임', 'web')).rejects.toThrow('db down');
    });
  });
});
