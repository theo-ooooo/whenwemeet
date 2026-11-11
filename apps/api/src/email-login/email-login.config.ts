import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CODE_KEY_INFO, CODE_PATTERN, deriveKey, IP_KEY_INFO, isAcceptableEmail, normalizeEmail, safeEqualText } from './email-crypto.js';

/** 보내는 주소 기본값 (기획 3-2) */
export const DEFAULT_EMAIL_FROM = '언제볼까 <noreply@whenwemeet.day>';
/** Resend API 기본 주소. e2e 는 RESEND_API_URL 로 가짜 서버를 넣을 수 있다 */
export const DEFAULT_RESEND_API_URL = 'https://api.resend.com';

/** 심사 계정 (D-118). 두 값이 다 맞을 때만 있다 */
export interface ReviewAccount {
  email: string;
  code: string;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * (#245) 이메일 로그인 환경 변수 (이메일-로그인.md 4-4). 모두 운영 기동 필수가 아니다.
 * 비밀값(RESEND_API_KEY, INTERNAL_API_KEY, REVIEW_CODE) 은 로그에 싣지 않는다
 */
@Injectable()
export class EmailLoginConfig {
  private readonly logger = new Logger('EmailLogin');
  /** EMAIL_LOGIN_ENABLED === '1' (D-119) */
  readonly enabled: boolean;
  readonly production: boolean;
  /** 비어 있으면 null. 개발에서만 키 없이 통과 (D-115) */
  readonly internalApiKey: string | null;
  readonly resendApiKey: string | null;
  readonly resendApiUrl: string;
  readonly from: string;
  readonly webOrigin: string;
  /** 코드 해시 키, IP 해시 키. JWT_SECRET 에서 파생 (D-112) */
  readonly codeKey: Buffer;
  readonly ipKey: Buffer;
  readonly review: ReviewAccount | null;

  constructor(config: ConfigService) {
    this.enabled = text(config.get('EMAIL_LOGIN_ENABLED')) === '1';
    this.production = config.get('NODE_ENV') === 'production';
    this.internalApiKey = text(config.get('INTERNAL_API_KEY')) || null;
    this.resendApiKey = text(config.get('RESEND_API_KEY')) || null;
    this.resendApiUrl = (text(config.get('RESEND_API_URL')) || DEFAULT_RESEND_API_URL).replace(/\/+$/, '');
    this.from = text(config.get('EMAIL_FROM')) || DEFAULT_EMAIL_FROM;
    this.webOrigin = text(config.get('WEB_ORIGIN')).replace(/\/+$/, '');
    const secret = config.getOrThrow<string>('JWT_SECRET');
    this.codeKey = deriveKey(secret, CODE_KEY_INFO);
    this.ipKey = deriveKey(secret, IP_KEY_INFO);
    this.review = parseReview(config.get('REVIEW_EMAIL'), config.get('REVIEW_CODE'));
    if (this.enabled && !this.review) this.logger.warn('심사 계정 꺼짐 (REVIEW_EMAIL, REVIEW_CODE 가 비었거나 코드가 6자리 숫자가 아님)');
  }

  /** 엔드포인트를 받을 수 있는지. 꺼져 있거나, 운영에서 Resend 키나 내부 키가 없으면 false (503 EMAIL_NOT_CONFIGURED) */
  get available(): boolean {
    if (!this.enabled) return false;
    if (this.production && (!this.internalApiKey || !this.resendApiKey)) return false;
    return true;
  }

  /** 정규화한 이메일이 심사 이메일인지 (상수 시간 비교) */
  isReviewEmail(email: string): boolean {
    return this.review !== null && safeEqualText(email, this.review.email);
  }
}

/** REVIEW_EMAIL 은 정규화 후 이메일 모양, REVIEW_CODE 는 6자리 숫자. 하나라도 어긋나면 null (D-118) */
export function parseReview(rawEmail: unknown, rawCode: unknown): ReviewAccount | null {
  const email = normalizeEmail(text(rawEmail));
  const code = text(rawCode);
  if (!isAcceptableEmail(email) || !CODE_PATTERN.test(code)) return null;
  return { email, code };
}
