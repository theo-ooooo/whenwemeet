import OpenAI, {
  APIConnectionTimeoutError,
  APIError,
  APIUserAbortError,
} from 'openai';
import {
  AssistantModelError,
  type AssistantModel,
  type ModelMessage,
  type ModelResult,
  type ModelTool,
} from './assistant-model.js';

/** (#450) OpenAI 호출 제한 시간. 재시도 없음 (D-265) */
export const OPENAI_TIMEOUT_MS = 10_000;
/**
 * 도구 호출 인자만 받으므로 출력은 짧다 (설계 9장). (#458) 날짜가 표현 객체(when)가 되어 후보 5개 투표 인자가 300 토큰에 닿으므로 500.
 * (#474) 일정 초안이 5개까지 한 번에 오면(일정 하나 약 110 토큰) 500 을 넘어 잘리므로 1000 (D-280). 실제 쓴 만큼만 값이 나간다
 */
export const OPENAI_MAX_COMPLETION_TOKENS = 1000;

/** 우리가 쓰는 SDK 부분만 (테스트가 목으로 바꾼다) */
export interface ChatCompletionsClient {
  chat: { completions: { create: OpenAI['chat']['completions']['create'] } };
}

/** SDK 오류 → AssistantModelError. 응답 본문, 키는 메시지에 싣지 않는다 */
export function toModelError(error: unknown): AssistantModelError {
  if (error instanceof AssistantModelError) return error;
  if (error instanceof APIUserAbortError)
    return new AssistantModelError('aborted');
  if (error instanceof APIConnectionTimeoutError)
    return new AssistantModelError('timeout');
  if (error instanceof APIError && typeof error.status === 'number') {
    const status = error.status;
    if (status === 401 || status === 403)
      return new AssistantModelError('unavailable', status, 'auth');
    if (status === 429)
      return new AssistantModelError(
        'unavailable',
        status,
        error.code === 'insufficient_quota' ? 'quota' : null,
      );
    return new AssistantModelError('unavailable', status);
  }
  // 연결 실패(APIConnectionError) 와 그 밖
  return new AssistantModelError('unavailable');
}

/**
 * (#450) OpenAI Chat Completions (설계 AI-비서.md 3장, D-265). 요청당 한 번, 도구 호출 강제.
 * `store: false` 로 OpenAI 쪽 저장(대시보드 기록)을 끈다
 */
export class OpenAiAssistantModel implements AssistantModel {
  readonly kind = 'openai' as const;

  constructor(
    private readonly client: ChatCompletionsClient,
    private readonly model: string,
  ) {}

  static create(apiKey: string, model: string): OpenAiAssistantModel {
    return new OpenAiAssistantModel(
      new OpenAI({ apiKey, timeout: OPENAI_TIMEOUT_MS, maxRetries: 0 }),
      model,
    );
  }

  async complete(
    messages: ModelMessage[],
    tools: readonly ModelTool[],
    signal?: AbortSignal,
  ): Promise<ModelResult> {
    let completion: OpenAI.Chat.Completions.ChatCompletion;
    try {
      completion = await this.client.chat.completions.create(
        {
          model: this.model,
          messages,
          tools: tools.map((tool) => ({
            type: 'function' as const,
            function: {
              name: tool.name,
              description: tool.description,
              parameters: tool.parameters,
              strict: true,
            },
          })),
          tool_choice: 'required',
          parallel_tool_calls: false,
          temperature: 0,
          max_completion_tokens: OPENAI_MAX_COMPLETION_TOKENS,
          store: false,
        },
        { signal, timeout: OPENAI_TIMEOUT_MS, maxRetries: 0 },
      );
    } catch (error) {
      throw toModelError(error);
    }
    const choice = completion.choices[0];
    const toolCalls = (choice?.message.tool_calls ?? []).flatMap((call) =>
      call.type === 'function'
        ? [{ name: call.function.name, arguments: call.function.arguments }]
        : [],
    );
    const usage = completion.usage;
    return {
      toolCalls,
      text: choice?.message.content ?? null,
      finishReason: choice?.finish_reason ?? null,
      usage: usage
        ? {
            promptTokens: usage.prompt_tokens,
            cachedTokens: usage.prompt_tokens_details?.cached_tokens ?? 0,
            completionTokens: usage.completion_tokens,
          }
        : null,
      model: completion.model,
    };
  }
}
