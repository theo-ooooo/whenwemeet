import { Inject, Injectable, Logger } from '@nestjs/common';
import { AuthService, PERSONAL_GROUP_NAME } from '../auth/auth.service.js';
import { sanitizeNext } from '../auth/next-path.js';
import { ApiException } from '../common/errors.js';
import { MEMBER_COLORS } from '../common/member.js';
import { generatePublicCode } from '../common/public-code.js';
import { isUniqueViolation } from '../groups/invite-code.js';
import { UsersRepository } from '../users/users.repository.js';
import { hashCode, hmacHex, maskEmail, newCode, newToken, normalizeEmail, safeEqualHex, sha256hex, TOKEN_PATTERN } from './email-crypto.js';
import { EmailLoginConfig } from './email-login.config.js';
import { ChallengeRow, EmailLoginChallengesRepository } from './email-login.repository.js';
import { MAIL_CLIENT, MailSendError, type MailClient } from './mail-client.js';
import { renderLinkMail, renderLoginMail } from './mail-template.js';

/** 링크와 코드 유효 시간 (3장) */
export const CHALLENGE_TTL_MS = 15 * 60 * 1000;
/** 가입 티켓 유효 시간 (D-114) */
export const SIGNUP_TTL_MS = 30 * 60 * 1000;
/** 행 보관 기간 (D-111). 요청마다 이보다 오래된 행을 지운다 */
export const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
/** 틀린 코드 한도. 이 횟수째 틀리면 그 메일은 무효 (기획 3-1) */
export const MAX_CODE_ATTEMPTS = 5;
/** 횟수 제한 (기획 3-2, D-111) */
export const COOLDOWN_SEC = 60;
export const HOURLY_EMAIL_LIMIT = 5;
export const HOURLY_IP_LIMIT = 20;
const HOUR_MS = 60 * 60 * 1000;

export type EmailLoginClient = 'web' | 'app';

/** POST /auth/email/link, /auth/email/code 응답 (4-2) */
export type AuthResult = { kind: 'SESSION'; token: string; next: string } | { kind: 'SIGNUP'; signupToken: string; next: string };

export type LinkState = 'VALID' | 'EXPIRED' | 'USED' | 'INVALID';

export interface RequestInput {
  email: string;
  next?: string;
  clientIp: string;
  /** (#198) 로그인한 사용자의 이메일 연결이면 그 사용자 (D-257). 메일은 코드만, 행은 purpose LINK */
  linkUserId?: number;
}

function linkInvalid(reason: Exclude<LinkState, 'VALID'>): ApiException {
  return new ApiException('EMAIL_LINK_INVALID', undefined, { reason });
}

/** 행 상태 → 링크 상태. 사용됨이 먼저, 무효와 만료는 EXPIRED */
export function linkStateOf(row: ChallengeRow | null, now: Date): LinkState {
  if (!row) return 'INVALID';
  if (row.usedAt) return 'USED';
  if (row.invalidatedAt || row.expiresAt.getTime() <= now.getTime()) return 'EXPIRED';
  return 'VALID';
}

/** 도메인만 (9-3. 이메일 전체는 로그에 남기지 않는다) */
function domainOf(email: string): string {
  return email.slice(email.lastIndexOf('@') + 1);
}

/**
 * (#245) 이메일 링크 + 6자리 코드 로그인 (이메일-로그인.md 4장, D-110 ~ D-118).
 * 요청 단계는 사용자를 조회하지 않아 가입 여부를 드러내지 않는다
 */
@Injectable()
export class EmailLoginService {
  private readonly logger = new Logger('EmailLogin');

  constructor(
    private readonly challenges: EmailLoginChallengesRepository,
    private readonly users: UsersRepository,
    private readonly auth: AuthService,
    private readonly config: EmailLoginConfig,
    @Inject(MAIL_CLIENT) private readonly mail: MailClient,
  ) {}

  /** POST /auth/email/request. 가입 여부, 발송 성공과 무관하게 같은 응답 */
  async request(input: RequestInput): Promise<{ cooldownSec: number; expiresInSec: number }> {
    const started = Date.now();
    const now = new Date();
    const email = normalizeEmail(input.email);
    const next = sanitizeNext(input.next);
    const ipHash = hmacHex(this.config.ipKey, input.clientIp);

    await this.assertWithinLimits(email, ipHash, now);

    const linkUserId = input.linkUserId ?? null;
    // (#198) 연결 메일은 심사 계정 예외(REVIEW_CODE)를 쓰지 않는다. 심사 계정에 다른 로그인을 붙일 일이 없다
    const review = linkUserId === null && this.config.isReviewEmail(email);
    const linkToken = newToken();
    const linkTokenHash = sha256hex(linkToken);
    const code = review && this.config.review ? this.config.review.code : newCode();
    const id = await this.challenges.invalidateLiveAndCreateTx({
      email,
      linkTokenHash,
      codeHash: hashCode(this.config.codeKey, linkTokenHash, code),
      expiresAt: new Date(now.getTime() + CHALLENGE_TTL_MS),
      next,
      ipHash,
      isReview: review,
      // 심사 계정은 보내지 않는다 (D-118). 일반은 임시 FAILED 로 넣고 접수되면 SENT
      sendStatus: review ? 'SKIPPED' : 'FAILED',
      createdAt: now,
      ...(linkUserId !== null ? { purpose: 'LINK' as const, userId: linkUserId } : {}),
    });

    let sendStatus = review ? 'SKIPPED' : 'FAILED';
    let failure = '';
    if (!review) {
      const mail = linkUserId !== null ? renderLinkMail({ code }) : renderLoginMail({ link: `${this.config.webOrigin}/auth/email?token=${linkToken}`, code });
      try {
        const result = await this.mail.send({ to: email, ...mail, idempotencyKey: `email-login-${id}` });
        sendStatus = result.status;
        await this.challenges.markSendResult(id, result.status, result.status === 'SENT' ? result.id : null);
      } catch (error) {
        failure = error instanceof MailSendError ? ` http=${error.httpStatus ?? '-'} error=${error.errorName}` : ' error=UNEXPECTED';
      }
    }

    await this.challenges.deleteCreatedBefore(new Date(now.getTime() - RETENTION_MS));
    const line = `request challengeId=${id}${linkUserId !== null ? ' purpose=LINK' : ''} domain=${domainOf(email)} review=${review} sendStatus=${sendStatus}${failure} ms=${Date.now() - started}`;
    if (sendStatus === 'FAILED') this.logger.warn(line);
    else this.logger.log(line);
    return { cooldownSec: COOLDOWN_SEC, expiresInSec: CHALLENGE_TTL_MS / 1000 };
  }

  /** POST /auth/email/link/inspect. 소비하지 않는다 (D-113). INVALID 면 emailMasked null */
  async inspect(token: string): Promise<{ state: LinkState; emailMasked: string | null }> {
    if (!TOKEN_PATTERN.test(token)) return { state: 'INVALID', emailMasked: null };
    const row = await this.challenges.findByLinkTokenHash(sha256hex(token));
    const state = linkStateOf(row, new Date());
    return { state, emailMasked: row ? maskEmail(row.email) : null };
  }

  /** POST /auth/email/link. 1회 소비 → 기존 계정 SESSION, 처음 SIGNUP */
  async verifyLink(token: string, client: EmailLoginClient): Promise<AuthResult> {
    if (!TOKEN_PATTERN.test(token)) throw linkInvalid('INVALID');
    const now = new Date();
    const row = await this.challenges.findByLinkTokenHash(sha256hex(token));
    const state = linkStateOf(row, now);
    if (state !== 'VALID' || !row) throw linkInvalid(state === 'VALID' ? 'INVALID' : state);
    if (!(await this.challenges.consume(row.id, 'LINK', now))) {
      // 그 사이 다른 요청이 썼거나 무효가 됐다. 다시 판정
      const after = linkStateOf(await this.challenges.findById(row.id), now);
      throw linkInvalid(after === 'VALID' ? 'USED' : after);
    }
    return this.complete(row, 'LINK', client, now);
  }

  /** POST /auth/email/code. 이메일의 살아 있는 최신 메일과 코드 대조 */
  async verifyCode(rawEmail: string, code: string, client: EmailLoginClient): Promise<AuthResult> {
    const now = new Date();
    const email = normalizeEmail(rawEmail);
    const row = await this.challenges.findLatestLiveByEmail(email, now);
    if (!row) throw new ApiException('EMAIL_CODE_EXPIRED');

    if (!safeEqualHex(hashCode(this.config.codeKey, row.linkTokenHash, code), row.codeHash)) {
      const wrong = await this.challenges.registerWrongCodeTx(row.id, now, MAX_CODE_ATTEMPTS);
      this.logger.log(`verify challengeId=${row.id} via=CODE result=${wrong.locked ? 'EMAIL_CODE_LOCKED' : wrong.counted ? 'EMAIL_CODE_INVALID' : 'EMAIL_CODE_EXPIRED'}`);
      if (!wrong.counted) throw new ApiException('EMAIL_CODE_EXPIRED');
      if (wrong.locked) throw new ApiException('EMAIL_CODE_LOCKED');
      throw new ApiException('EMAIL_CODE_INVALID', undefined, { attemptsLeft: MAX_CODE_ATTEMPTS - wrong.attempts });
    }
    if (!(await this.challenges.consume(row.id, 'CODE', now))) throw new ApiException('EMAIL_CODE_EXPIRED');
    return this.complete(row, 'CODE', client, now);
  }

  /**
   * (#198) 이메일 연결 코드 확인 (POST /me/auth-accounts { provider: EMAIL, email, code }, D-257).
   * userId 가 요청한 살아 있는 최신 LINK 메일과 대조하고 맞으면 소비. 틀린 횟수, 잠금, 만료는 로그인 코드와 같은 규칙과 오류.
   * 성공이면 정규화한 이메일
   */
  async verifyLinkCode(userId: number, rawEmail: string, code: string): Promise<string> {
    if (!this.config.available) throw new ApiException('EMAIL_NOT_CONFIGURED');
    const now = new Date();
    const email = normalizeEmail(rawEmail);
    const row = await this.challenges.findLatestLiveLink(email, userId, now);
    if (!row) throw new ApiException('EMAIL_CODE_EXPIRED');
    if (!safeEqualHex(hashCode(this.config.codeKey, row.linkTokenHash, code), row.codeHash)) {
      const wrong = await this.challenges.registerWrongCodeTx(row.id, now, MAX_CODE_ATTEMPTS);
      this.logger.log(`link challengeId=${row.id} result=${wrong.locked ? 'EMAIL_CODE_LOCKED' : wrong.counted ? 'EMAIL_CODE_INVALID' : 'EMAIL_CODE_EXPIRED'}`);
      if (!wrong.counted) throw new ApiException('EMAIL_CODE_EXPIRED');
      if (wrong.locked) throw new ApiException('EMAIL_CODE_LOCKED');
      throw new ApiException('EMAIL_CODE_INVALID', undefined, { attemptsLeft: MAX_CODE_ATTEMPTS - wrong.attempts });
    }
    if (!(await this.challenges.consume(row.id, 'CODE', now))) throw new ApiException('EMAIL_CODE_EXPIRED');
    this.logger.log(`link challengeId=${row.id} result=VERIFIED`);
    return email;
  }

  /** POST /auth/email/signup. 가입 티켓 1회 소비 → User + EMAIL 계정 + 개인 팀 → 세션 JWT */
  async signup(signupToken: string, nickname: string, client: EmailLoginClient): Promise<{ token: string; next: string }> {
    if (!TOKEN_PATTERN.test(signupToken)) throw new ApiException('SIGNUP_TOKEN_INVALID');
    const now = new Date();
    const hash = sha256hex(signupToken);
    const ticket = await this.challenges.findSignupTicket(hash, now);
    if (!ticket || !(await this.challenges.consumeSignupTicket(hash, now))) throw new ApiException('SIGNUP_TOKEN_INVALID');

    let userId: number;
    try {
      const user = await this.users.createWithAccountTx(
        { provider: 'EMAIL', providerUserId: ticket.email, email: ticket.email, rawProfile: null, nickname },
        { name: PERSONAL_GROUP_NAME, color: MEMBER_COLORS[0], publicCode: generatePublicCode() },
      );
      userId = user.id;
    } catch (error) {
      // 같은 이메일이 다른 탭에서 먼저 가입했다 → 그 계정으로 로그인 (닉네임은 무시)
      if (!isUniqueViolation(error)) throw error;
      const existing = await this.users.findUserIdByAccount('EMAIL', ticket.email);
      if (existing === null) throw error;
      userId = existing;
    }
    if (client === 'app') await this.users.markAppLogin(userId, now);
    this.logger.log(`signup challengeId=${ticket.id} result=SESSION`);
    return { token: await this.auth.signToken(userId), next: sanitizeNext(ticket.next) };
  }

  /** 소비한 메일 → 기존 계정이면 JWT, 아니면 30분 가입 티켓 */
  private async complete(row: ChallengeRow, via: 'LINK' | 'CODE', client: EmailLoginClient, now: Date): Promise<AuthResult> {
    const next = sanitizeNext(row.next);
    const userId = await this.users.findUserIdByAccount('EMAIL', row.email);
    if (userId !== null) {
      // D-97 지표 분모 유지: 앱에서 로그인되면 lastAppLoginAt
      if (client === 'app') await this.users.markAppLogin(userId, now);
      this.logger.log(`verify challengeId=${row.id} via=${via} result=SESSION`);
      return { kind: 'SESSION', token: await this.auth.signToken(userId), next };
    }
    const signupToken = newToken();
    await this.challenges.setSignupTicket(row.id, sha256hex(signupToken), new Date(now.getTime() + SIGNUP_TTL_MS));
    this.logger.log(`verify challengeId=${row.id} via=${via} result=SIGNUP`);
    return { kind: 'SIGNUP', signupToken, next };
  }

  /** 4-2 request 2단계. 쿨다운 → 시간당 이메일 → 시간당 IP 순 */
  private async assertWithinLimits(email: string, ipHash: string, now: Date): Promise<void> {
    const nowMs = now.getTime();
    const last = await this.challenges.latestCreatedAtByEmail(email);
    if (last && nowMs - last.getTime() < COOLDOWN_SEC * 1000) {
      throw rateLimited('COOLDOWN', last.getTime() + COOLDOWN_SEC * 1000 - nowMs);
    }
    const since = new Date(nowMs - HOUR_MS);
    const byEmail = await this.challenges.countRecentByEmail(email, since);
    if (byEmail.count >= HOURLY_EMAIL_LIMIT) throw rateLimited('HOURLY', (byEmail.oldest?.getTime() ?? nowMs) + HOUR_MS - nowMs);
    const byIp = await this.challenges.countRecentByIp(ipHash, since);
    if (byIp.count >= HOURLY_IP_LIMIT) throw rateLimited('IP', (byIp.oldest?.getTime() ?? nowMs) + HOUR_MS - nowMs);
  }
}

function rateLimited(reason: 'COOLDOWN' | 'HOURLY' | 'IP', remainingMs: number): ApiException {
  return new ApiException('EMAIL_RATE_LIMITED', undefined, { reason, retryAfterSec: Math.max(1, Math.ceil(remainingMs / 1000)) });
}
