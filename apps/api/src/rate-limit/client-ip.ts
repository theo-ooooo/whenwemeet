import type { Request } from 'express';
import { safeEqualText } from '../email-login/email-crypto.js';
import { CLIENT_IP_HEADER, INTERNAL_KEY_HEADER, UNKNOWN_IP } from '../email-login/email-login.guard.js';

/** Railway 엣지가 넣는 클라이언트 IP 헤더 (Railway 문서 Specs & Limits 에 명시된 유일한 헤더) */
export const REAL_IP_HEADER = 'x-real-ip';
/** 내부 키는 맞지만 X-Client-IP 가 없는 요청(웹 서버 자신의 호출, OG 이미지 등)의 묶음 */
export const INTERNAL_IP = 'internal';
const MAX_IP_LENGTH = 100;

type IpRequest = Pick<Request, 'headers'> & { socket?: { remoteAddress?: string } };

/**
 * (#186) 요청 제한에 쓸 IP (api.md 1장 "요청 제한", D-143).
 * 1. X-Internal-Key 가 INTERNAL_API_KEY 와 같으면 웹 서버가 보낸 요청. X-Client-IP, 없으면 "internal"
 * 2. 아니면(앱 네이티브 로그인, 브라우저 리다이렉트처럼 직접 온 요청) Railway 의 X-Real-IP, 없으면 소켓 주소.
 *    X-Forwarded-For 는 Railway 가 덮어쓰는지 알 수 없어 위조될 수 있으므로 쓰지 않는다
 */
export function clientIpOf(request: IpRequest, internalApiKey: string | undefined): string {
  const given = headerValue(request.headers[INTERNAL_KEY_HEADER]);
  if (internalApiKey && given !== undefined && safeEqualText(given, internalApiKey)) {
    return ipValue(request.headers[CLIENT_IP_HEADER]) ?? INTERNAL_IP;
  }
  return ipValue(request.headers[REAL_IP_HEADER]) ?? ipValue(request.socket?.remoteAddress) ?? UNKNOWN_IP;
}

function headerValue(header: string | string[] | undefined): string | undefined {
  return Array.isArray(header) ? header[0] : header;
}

function ipValue(header: string | string[] | undefined): string | undefined {
  const value = headerValue(header)?.trim();
  if (!value || value.length > MAX_IP_LENGTH) return undefined;
  return value;
}
