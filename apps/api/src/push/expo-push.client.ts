import { Inject, Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ExpoMessage } from './push-copy.js';

/** Expo 푸시 HTTP API 기본 주소 (D-94). e2e 는 EXPO_PUSH_URL 로 가짜 서버를 넣는다 */
export const DEFAULT_EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push';
/** 한 요청에 담는 메시지 수 상한 */
export const EXPO_SEND_CHUNK = 100;
/** 영수증 한 요청의 id 수 상한 */
export const EXPO_RECEIPT_CHUNK = 1000;
/** 요청 제한 시간 */
export const EXPO_TIMEOUT_MS = 10_000;

/** 테스트가 가짜 fetch 를 넣는 토큰. 없으면 전역 fetch */
export const PUSH_FETCH = Symbol('PUSH_FETCH');
export type FetchFn = typeof fetch;

/** 메시지 하나의 티켓 */
export type ExpoTicket = { status: 'ok'; id: string } | { status: 'error'; code: string };

/**
 * 발송 결과 (설계 5-6 표).
 * - tickets: 200, 메시지 순서대로 티켓
 * - retry: 429, 5xx, 요청을 보내기 전 연결 실패 → 다시 보내도 안전
 * - unknown: 타임아웃, 응답 본문 해석 실패 → 접수됐을 수 있어 다시 보내지 않는다 (D-89)
 * - rejected: 그 밖의 4xx (요청 자체 거절)
 */
export type ExpoSendResult =
  | { type: 'tickets'; tickets: ExpoTicket[] }
  | { type: 'retry'; reason: string }
  | { type: 'unknown'; reason: string }
  | { type: 'rejected'; code: string };

/** 영수증 id → 'ok' | 오류 코드. 요청이 실패하면 null (다음 틱에 다시) */
export type ExpoReceipts = Map<string, string> | null;

interface RawTicket {
  status?: unknown;
  id?: unknown;
  message?: unknown;
  details?: { error?: unknown };
}

function errorCode(raw: { details?: { error?: unknown }; message?: unknown }): string {
  return typeof raw.details?.error === 'string' ? raw.details.error : 'UnknownError';
}

/** fetch 로 Expo 푸시 API 를 직접 부른다 (D-94). SDK 를 쓰지 않는다 */
@Injectable()
export class ExpoPushClient {
  private readonly baseUrl: string;
  private readonly accessToken: string | undefined;
  private readonly fetchFn: FetchFn;

  constructor(config: ConfigService, @Optional() @Inject(PUSH_FETCH) fetchFn?: FetchFn) {
    this.baseUrl = (config.get<string>('EXPO_PUSH_URL') || DEFAULT_EXPO_PUSH_URL).replace(/\/+$/, '');
    this.accessToken = config.get<string>('EXPO_ACCESS_TOKEN') || undefined;
    this.fetchFn = fetchFn ?? ((...args) => fetch(...args));
  }

  /** 메시지 최대 100개를 한 요청으로 */
  async send(messages: ExpoMessage[]): Promise<ExpoSendResult> {
    let response: Response;
    try {
      response = await this.post('/send', messages);
    } catch (error) {
      return isTimeout(error) ? { type: 'unknown', reason: 'TIMEOUT' } : { type: 'retry', reason: 'CONNECTION' };
    }
    if (response.status === 429 || response.status >= 500) return { type: 'retry', reason: `HTTP_${response.status}` };
    if (!response.ok) return { type: 'rejected', code: `HTTP_${response.status}` };
    let body: { data?: unknown };
    try {
      body = (await response.json()) as { data?: unknown };
    } catch {
      return { type: 'unknown', reason: 'BAD_RESPONSE' };
    }
    if (!Array.isArray(body.data) || body.data.length !== messages.length) return { type: 'unknown', reason: 'BAD_RESPONSE' };
    const tickets = (body.data as RawTicket[]).map((raw): ExpoTicket => {
      if (raw?.status === 'ok' && typeof raw.id === 'string') return { status: 'ok', id: raw.id };
      return { status: 'error', code: errorCode(raw ?? {}) };
    });
    return { type: 'tickets', tickets };
  }

  /** 영수증 (최대 1000개). 실패하면 null */
  async getReceipts(ids: string[]): Promise<ExpoReceipts> {
    try {
      const response = await this.post('/getReceipts', { ids });
      if (!response.ok) return null;
      const body = (await response.json()) as { data?: Record<string, { status?: unknown; details?: { error?: unknown } }> };
      const result = new Map<string, string>();
      for (const [id, receipt] of Object.entries(body.data ?? {})) {
        result.set(id, receipt?.status === 'ok' ? 'ok' : errorCode(receipt ?? {}));
      }
      return result;
    } catch {
      return null;
    }
  }

  private post(path: string, body: unknown): Promise<Response> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'Accept-Encoding': 'gzip, deflate',
    };
    if (this.accessToken) headers.Authorization = `Bearer ${this.accessToken}`;
    return this.fetchFn(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(EXPO_TIMEOUT_MS),
    });
  }
}

function isTimeout(error: unknown): boolean {
  return error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
}
