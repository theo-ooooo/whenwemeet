import type { Request } from 'express';
import { safeEqualText } from '../email-login/email-crypto.js';
import { INTERNAL_KEY_HEADER } from '../email-login/email-login.guard.js';

/** (#532) 웹 서버가 브라우저 User-Agent 를 실어 보내는 헤더 (D-288). X-Internal-Key 가 맞을 때만 믿는다 */
export const CLIENT_UA_HEADER = 'x-client-ua';

/** 읽을 User-Agent 최대 길이. 넘는 값은 앞부분만 본다 */
const MAX_UA_LENGTH = 512;

/** 앱 셸이 WebView applicationNameForUserAgent 로 붙이는 접미사 (web lib/app-bridge.ts APP_UA 와 같은 규칙).
 *  버전은 UserClient.appVersion VARCHAR(32) 에 맞춰 32자까지만 앱으로 본다 */
const APP_UA = /\bWhenwemeetApp\/([0-9A-Za-z.+-]{1,32}) \((ios|android)\)/;

export type ClientPlatform = 'ios' | 'android' | 'web';
export interface ClientInfo {
  platform: ClientPlatform;
  /** ios, android 만. web 은 null */
  appVersion: string | null;
}

/**
 * (#532) User-Agent → 기종과 앱 버전 (D-288). `WhenwemeetApp/<버전> (ios|android)` 가 있으면 그 기종, 아니면 web.
 * 원문은 돌려주지 않는다 (저장은 기종과 버전만)
 */
export function parseClientUserAgent(ua: string): ClientInfo {
  const m = APP_UA.exec(ua.slice(0, MAX_UA_LENGTH));
  if (!m) return { platform: 'web', appVersion: null };
  return { platform: m[2] as 'ios' | 'android', appVersion: m[1] };
}

type UaRequest = Pick<Request, 'headers'>;

function headerValue(
  header: string | string[] | undefined,
): string | undefined {
  return Array.isArray(header) ? header[0] : header;
}

/**
 * (#532) 믿을 수 있는 접속 기종. X-Internal-Key 가 INTERNAL_API_KEY 와 같을 때(웹 서버가 보낸 요청)만 X-Client-UA 를 읽는다.
 * 키가 없거나 틀리면(직접 온 요청, 개발 환경의 키 미설정), UA 헤더가 없으면(웹 서버 자신의 호출) null = 기록하지 않음.
 * 요청 제한의 X-Client-IP 와 같은 판정 (rate-limit/client-ip.ts)
 */
export function trustedClientOf(
  request: UaRequest,
  internalApiKey: string | undefined,
): ClientInfo | null {
  const given = headerValue(request.headers[INTERNAL_KEY_HEADER]);
  if (
    !internalApiKey ||
    given === undefined ||
    !safeEqualText(given, internalApiKey)
  )
    return null;
  const ua = headerValue(request.headers[CLIENT_UA_HEADER])?.trim();
  if (!ua) return null;
  return parseClientUserAgent(ua);
}
