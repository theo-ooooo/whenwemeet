import type { ConfigService } from '@nestjs/config';

/** (#450) 모델 주입 토큰 (설계 AI-비서.md 3장, D-265). 운영 OpenAI, `ASSISTANT_FAKE=1` 가짜, 키 없음 미설정. 장소 검색 공급자와 같은 방식 */
export const ASSISTANT_MODEL = Symbol('ASSISTANT_MODEL');

export const DEFAULT_OPENAI_MODEL = 'gpt-4o-mini';

export interface ModelMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** 모델에 넘기는 함수 도구 하나 (tools.ts) */
export interface ModelTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/** 모델이 부른 도구. arguments 는 모델이 보낸 JSON 글자 그대로 (guard.ts 가 다시 검사한다) */
export interface ModelToolCall {
  name: string;
  arguments: string;
}

export interface ModelUsage {
  promptTokens: number;
  cachedTokens: number;
  completionTokens: number;
}

/** 모델 한 번의 결과. text 는 로그에도 화면에도 쓰지 않는다 (guard.ts, D-267) */
export interface ModelResult {
  toolCalls: ModelToolCall[];
  text: string | null;
  finishReason: string | null;
  usage: ModelUsage | null;
  model: string;
}

export interface AssistantModel {
  /** 공급자 이름 (로그용). unavailable 이면 `/me.assistant.available = false` */
  readonly kind: 'openai' | 'fake' | 'unavailable';
  complete(messages: ModelMessage[], tools: readonly ModelTool[], signal?: AbortSignal): Promise<ModelResult>;
}

/**
 * 모델 호출 실패.
 * - unavailable: 키 없음, 401/403, 429(잔액, 한도), 5xx, 연결 실패 → 503 ASSISTANT_UNAVAILABLE
 * - timeout: 10초 초과 → 504 ASSISTANT_TIMEOUT
 * - aborted: 사용자가 화면을 닫아 요청이 끊김 (횟수를 되돌리지 않는다, 7-2)
 * alert 는 계정 주인이 손봐야 하는 원인 (키 인증 실패 auth, 잔액 부족 quota). Sentry 로 알린다 (D-271)
 */
export class AssistantModelError extends Error {
  constructor(
    readonly kind: 'unavailable' | 'timeout' | 'aborted',
    readonly httpStatus: number | null = null,
    readonly alert: 'auth' | 'quota' | null = null,
  ) {
    super(`볼까 모델 실패: ${kind}${httpStatus ? ` ${httpStatus}` : ''}`);
    this.name = 'AssistantModelError';
  }
}

/** 키가 없을 때. 메시지는 503 이고 `/me` 의 available 은 false */
export class UnavailableAssistantModel implements AssistantModel {
  readonly kind = 'unavailable' as const;

  complete(): Promise<ModelResult> {
    return Promise.reject(new AssistantModelError('unavailable'));
  }
}

/** 어느 모델을 쓸지 (D-271). 운영은 키가 있을 때만 OpenAI. 그 밖은 `ASSISTANT_FAKE=1` 이면 가짜(키가 있어도), 아니면 키 유무 */
export function assistantModelChoice(config: ConfigService): { kind: AssistantModel['kind']; apiKey: string | null; model: string } {
  const apiKey = config.get<string>('OPENAI_API_KEY')?.trim() || null;
  const model = config.get<string>('OPENAI_MODEL')?.trim() || DEFAULT_OPENAI_MODEL;
  const production = config.get<string>('NODE_ENV') === 'production';
  const fake = !production && config.get<string>('ASSISTANT_FAKE') === '1';
  if (fake) return { kind: 'fake', apiKey: null, model: 'fake' };
  if (apiKey) return { kind: 'openai', apiKey, model };
  return { kind: 'unavailable', apiKey: null, model };
}
