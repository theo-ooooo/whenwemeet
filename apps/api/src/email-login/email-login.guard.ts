import { CanActivate, createParamDecorator, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ApiException } from '../common/errors.js';
import { safeEqualText } from './email-crypto.js';
import { EmailLoginConfig } from './email-login.config.js';

/** 웹 서버가 넣는 헤더 (D-115) */
export const INTERNAL_KEY_HEADER = 'x-internal-key';
export const CLIENT_IP_HEADER = 'x-client-ip';
/** 키가 맞지 않거나 IP 헤더가 없을 때 쓰는 IP 자리값 */
export const UNKNOWN_IP = 'unknown';
const MAX_IP_LENGTH = 100;

type EmailLoginRequest = Request & { emailClientIp?: string };

/**
 * (#245) 이메일 엔드포인트 공통 문 (이메일-로그인.md 4-1, D-115, D-119).
 * 1. 응답은 모두 Cache-Control: no-store (오류 포함)
 * 2. 스위치 꺼짐, 운영에서 키 미설정 → 503 EMAIL_NOT_CONFIGURED
 * 3. INTERNAL_API_KEY 가 있으면 X-Internal-Key 상수 시간 비교, 다르거나 없으면 403. 비어 있으면(개발만 여기까지 온다) 통과
 * 4. 키가 맞을 때만 X-Client-IP 를 믿는다. 아니면 "unknown"
 */
@Injectable()
export class EmailLoginGuard implements CanActivate {
  constructor(private readonly config: EmailLoginConfig) {}

  canActivate(context: ExecutionContext): boolean {
    const http = context.switchToHttp();
    http.getResponse<Response>().setHeader('Cache-Control', 'no-store');
    if (!this.config.available) throw new ApiException('EMAIL_NOT_CONFIGURED');

    const request = http.getRequest<EmailLoginRequest>();
    const expected = this.config.internalApiKey;
    if (!expected) {
      request.emailClientIp = UNKNOWN_IP;
      return true;
    }
    const given = request.headers[INTERNAL_KEY_HEADER];
    if (typeof given !== 'string' || !safeEqualText(given, expected)) {
      throw new ApiException('FORBIDDEN', '허용되지 않은 요청이에요');
    }
    request.emailClientIp = trustedIp(request.headers[CLIENT_IP_HEADER]);
    return true;
  }
}

function trustedIp(header: string | string[] | undefined): string {
  const value = (Array.isArray(header) ? header[0] : header)?.trim();
  if (!value || value.length > MAX_IP_LENGTH) return UNKNOWN_IP;
  return value;
}

/** 가드가 정한 클라이언트 IP (해시로만 저장, D-112) */
export const ClientIp = createParamDecorator((_data: unknown, context: ExecutionContext): string => {
  return context.switchToHttp().getRequest<EmailLoginRequest>().emailClientIp ?? UNKNOWN_IP;
});
