import { Logger } from '@nestjs/common';
import type { EmailLoginConfig } from './email-login.config.js';

/** (#245) 메일 발송 주입 토큰 (이메일-로그인.md 5장). 구현은 Resend, 콘솔(개발), 테스트 가짜 */
export const MAIL_CLIENT = Symbol('MAIL_CLIENT');
export type FetchFn = typeof fetch;

/** Resend 요청 제한 시간. 재시도 없음 (D-117) */
export const RESEND_TIMEOUT_MS = 10_000;

export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Resend `Idempotency-Key` (`email-login-<challengeId>`) */
  idempotencyKey: string;
}

/**
 * 발송 결과. SENT 는 받는 쪽이 접수함(2xx), SKIPPED 는 실제로 보내지 않음(개발 콘솔).
 * 실패는 MailSendError 를 던진다
 */
export type MailSendResult =
  { status: 'SENT'; id: string | null } | { status: 'SKIPPED' };

export interface MailClient {
  send(message: MailMessage): Promise<MailSendResult>;
}

/** 발송 실패. 로그에는 HTTP 상태와 Resend 오류 name 만 남긴다 (9-3) */
export class MailSendError extends Error {
  constructor(
    readonly httpStatus: number | null,
    readonly errorName: string,
  ) {
    super(`메일 발송 실패: ${httpStatus ?? '-'} ${errorName}`);
    this.name = 'MailSendError';
  }
}

/** Resend HTTP API 를 fetch 로 직접 부른다 (D-117). 10초 제한, 재시도 없음 */
export class ResendMailClient implements MailClient {
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
    private readonly apiUrl: string,
    private readonly fetchFn: FetchFn = (...args) => fetch(...args),
  ) {}

  async send(message: MailMessage): Promise<MailSendResult> {
    let response: Response;
    try {
      response = await this.fetchFn(`${this.apiUrl}/emails`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': message.idempotencyKey,
        },
        body: JSON.stringify({
          from: this.from,
          to: [message.to],
          subject: message.subject,
          html: message.html,
          text: message.text,
          tags: [{ name: 'type', value: 'login' }],
        }),
        signal: AbortSignal.timeout(RESEND_TIMEOUT_MS),
      });
    } catch (error) {
      const timeout =
        error instanceof Error &&
        (error.name === 'TimeoutError' || error.name === 'AbortError');
      throw new MailSendError(null, timeout ? 'TIMEOUT' : 'CONNECTION');
    }
    const body = (await response.json().catch(() => null)) as {
      id?: unknown;
      name?: unknown;
    } | null;
    if (!response.ok) {
      throw new MailSendError(
        response.status,
        typeof body?.name === 'string' ? body.name.slice(0, 64) : 'unknown',
      );
    }
    return {
      status: 'SENT',
      id: typeof body?.id === 'string' ? body.id.slice(0, 64) : null,
    };
  }
}

/**
 * 개발용 (D-117). 보내지 않고 메일 본문(링크와 코드)을 콘솔에 찍는다.
 * 운영에서는 쓰이지 않지만(키가 없으면 503), 만일을 위해 운영이면 본문을 찍지 않는다
 */
export class ConsoleMailClient implements MailClient {
  private readonly logger = new Logger('EmailLogin');

  constructor(private readonly production: boolean) {}

  async send(message: MailMessage): Promise<MailSendResult> {
    if (!this.production)
      this.logger.log(
        `[개발 메일, 보내지 않음] ${message.subject}\n${message.text}`,
      );
    return { status: 'SKIPPED' };
  }
}

/** RESEND_API_KEY 가 있으면 Resend, 없으면 콘솔 */
export function createMailClient(
  config: EmailLoginConfig,
  fetchFn?: FetchFn,
): MailClient {
  if (config.resendApiKey)
    return new ResendMailClient(
      config.resendApiKey,
      config.from,
      config.resendApiUrl,
      fetchFn,
    );
  return new ConsoleMailClient(config.production);
}
