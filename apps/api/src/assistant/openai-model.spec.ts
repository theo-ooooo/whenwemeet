import { APIConnectionError, APIConnectionTimeoutError, APIError, APIUserAbortError, AuthenticationError, InternalServerError, PermissionDeniedError, RateLimitError } from 'openai';
import { fakeConfig } from '../testing/fake-config.js';
import { AssistantModelError, assistantModelChoice, UnavailableAssistantModel } from './assistant-model.js';
import { createAssistantModel } from './assistant.module.js';
import { FakeAssistantModel } from './fake-model.js';
import { OPENAI_TIMEOUT_MS, OpenAiAssistantModel, toModelError } from './openai-model.js';
import { ASSISTANT_TOOLS } from './tools.js';

const headers = new Headers();
const completion = {
  id: 'c',
  object: 'chat.completion',
  created: 0,
  model: 'gpt-4o-mini-2024-07-18',
  choices: [
    {
      index: 0,
      finish_reason: 'tool_calls',
      logprobs: null,
      message: {
        role: 'assistant',
        content: '버려질 글',
        refusal: null,
        tool_calls: [
          { id: 't1', type: 'function', function: { name: 'greet', arguments: '{}' } },
          { id: 't2', type: 'custom', custom: { name: 'x', input: '' } },
        ],
      },
    },
  ],
  usage: { prompt_tokens: 2500, completion_tokens: 40, total_tokens: 2540, prompt_tokens_details: { cached_tokens: 1024 } },
};

describe('OpenAiAssistantModel (SDK 목, 실제 호출 없음)', () => {
  it('Chat Completions 인자: 도구 강제, 병렬 끔, strict, store false, temperature 0, 1000 토큰(#474), 10초, 재시도 없음, abort 신호', async () => {
    const create = vi.fn().mockResolvedValue(completion);
    const model = new OpenAiAssistantModel({ chat: { completions: { create } } } as never, 'gpt-4o-mini');
    const signal = new AbortController().signal;
    const result = await model.complete([{ role: 'user', content: '안녕' }], ASSISTANT_TOOLS, signal);
    const [body, options] = create.mock.calls[0];
    expect(body).toMatchObject({
      model: 'gpt-4o-mini',
      tool_choice: 'required',
      parallel_tool_calls: false,
      temperature: 0,
      max_completion_tokens: 1000,
      store: false,
      messages: [{ role: 'user', content: '안녕' }],
    });
    expect(body.tools).toHaveLength(9);
    expect(body.tools.every((tool: { type: string; function: { strict: boolean } }) => tool.type === 'function' && tool.function.strict === true)).toBe(true);
    expect(options).toEqual({ signal, timeout: OPENAI_TIMEOUT_MS, maxRetries: 0 });
    expect(result).toEqual({
      toolCalls: [{ name: 'greet', arguments: '{}' }],
      text: '버려질 글',
      finishReason: 'tool_calls',
      usage: { promptTokens: 2500, cachedTokens: 1024, completionTokens: 40 },
      model: 'gpt-4o-mini-2024-07-18',
    });
  });

  it('빈 응답, usage 없음도 받는다', async () => {
    const create = vi.fn().mockResolvedValue({ ...completion, choices: [], usage: undefined });
    const result = await new OpenAiAssistantModel({ chat: { completions: { create } } } as never, 'm').complete([], []);
    expect(result).toMatchObject({ toolCalls: [], text: null, finishReason: null, usage: null });
  });

  it('SDK 오류 → 401/403 인증(알림), 429 잔액(알림) / 한도, 5xx, 연결 실패 = 쓸 수 없음, 시간 초과, 사용자 취소', async () => {
    const create = vi.fn().mockRejectedValue(new AuthenticationError(401, { message: 'bad key' }, 'bad key', headers));
    await expect(new OpenAiAssistantModel({ chat: { completions: { create } } } as never, 'm').complete([], [])).rejects.toMatchObject({
      kind: 'unavailable',
      httpStatus: 401,
      alert: 'auth',
    });
    expect(toModelError(new PermissionDeniedError(403, undefined, 'x', headers))).toMatchObject({ kind: 'unavailable', alert: 'auth' });
    expect(toModelError(new RateLimitError(429, { code: 'insufficient_quota' }, 'quota', headers))).toMatchObject({ kind: 'unavailable', httpStatus: 429, alert: 'quota' });
    expect(toModelError(new RateLimitError(429, { code: 'rate_limit_exceeded' }, 'rate', headers))).toMatchObject({ kind: 'unavailable', alert: null });
    expect(toModelError(new InternalServerError(503, undefined, 'x', headers))).toMatchObject({ kind: 'unavailable', httpStatus: 503, alert: null });
    expect(toModelError(new APIConnectionError({ message: 'down' }))).toMatchObject({ kind: 'unavailable', httpStatus: null });
    expect(toModelError(new APIConnectionTimeoutError())).toMatchObject({ kind: 'timeout' });
    expect(toModelError(new APIUserAbortError())).toMatchObject({ kind: 'aborted' });
    expect(toModelError(new APIError(undefined, undefined, 'x', undefined))).toMatchObject({ kind: 'unavailable' });
    expect(toModelError(new Error('그 밖'))).toMatchObject({ kind: 'unavailable' });
    const known = new AssistantModelError('timeout');
    expect(toModelError(known)).toBe(known);
  });

  it('create 는 키와 모델로 클라이언트를 만든다 (호출하지 않음)', () => {
    expect(OpenAiAssistantModel.create('sk-test-not-real', 'gpt-4o-mini').kind).toBe('openai');
  });
});

describe('모델 고르기 (D-271)', () => {
  it('운영: 키 있으면 OpenAI, 없으면 미설정, ASSISTANT_FAKE 는 무시', () => {
    expect(assistantModelChoice(fakeConfig({ NODE_ENV: 'production', OPENAI_API_KEY: ' k ' }))).toEqual({ kind: 'openai', apiKey: 'k', model: 'gpt-4.1-mini' });
    expect(assistantModelChoice(fakeConfig({ NODE_ENV: 'production', ASSISTANT_FAKE: '1' })).kind).toBe('unavailable');
    expect(assistantModelChoice(fakeConfig({ NODE_ENV: 'production', OPENAI_API_KEY: 'k', OPENAI_MODEL: 'gpt-x' })).model).toBe('gpt-x');
  });

  it('로컬: ASSISTANT_FAKE=1 이면 키가 있어도 가짜, 아니면 키 유무', () => {
    expect(assistantModelChoice(fakeConfig({ OPENAI_API_KEY: 'k', ASSISTANT_FAKE: '1' })).kind).toBe('fake');
    expect(assistantModelChoice(fakeConfig({})).kind).toBe('unavailable');
    expect(assistantModelChoice(fakeConfig({ OPENAI_API_KEY: '' })).kind).toBe('unavailable');
  });

  it('createAssistantModel 은 고른 종류의 모델을 만든다', async () => {
    expect(createAssistantModel(fakeConfig({ ASSISTANT_FAKE: '1' }))).toBeInstanceOf(FakeAssistantModel);
    expect(createAssistantModel(fakeConfig({ NODE_ENV: 'production', OPENAI_API_KEY: 'sk-test-not-real' }))).toBeInstanceOf(OpenAiAssistantModel);
    const none = createAssistantModel(fakeConfig({}));
    expect(none).toBeInstanceOf(UnavailableAssistantModel);
    await expect(none.complete([], [])).rejects.toMatchObject({ kind: 'unavailable' });
  });
});

describe('FakeAssistantModel (키워드)', () => {
  const fake = new FakeAssistantModel();
  const pick = async (text: string) => {
    const result = await fake.complete([{ role: 'system', content: 's' }, { role: 'user', content: text }]);
    const call = result.toolCalls[0];
    return call ? { name: call.name, args: JSON.parse(call.arguments) as Record<string, unknown> } : null;
  };

  it('키워드별 도구', async () => {
    expect(await pick('내일 하늘이랑 저녁 잡아 줘')).toMatchObject({
      name: 'draft_event',
      args: { events: [{ date: { kind: 'relativeDays', days: 1 }, endDate: { kind: null }, startTime: '19:00', participants: ['하늘'] }] },
    });
    // (#474) 일정 2개
    const two = await pick('내일 7시 회식, 토요일 2시 영화 잡아 줘');
    expect(two?.args.events).toMatchObject([
      { title: '회식', date: { kind: 'relativeDays', days: 1 }, startTime: '19:00' },
      { title: '영화', date: { kind: 'weekday', weekday: '토', which: 'nearest' }, startTime: '14:00' },
    ]);
    expect(await pick('빈 시간 찾아서 투표')).toMatchObject({
      name: 'find_free_time',
      args: { from: { kind: 'relativeDays', days: 0 }, to: { kind: 'relativeDays', days: 6 }, next: 'poll', everyone: true },
    });
    expect(await pick('이번 주에 뭐 있어?')).toMatchObject({ name: 'list_events', args: { from: { kind: 'week', which: 'this' }, to: { kind: null }, member: null } });
    expect(await pick('하늘 생일')).toMatchObject({ name: 'find_anniversary' });
    expect(await pick('8시로 바꿔 줘')).toMatchObject({ name: 'report_unsupported', args: { action: 'edit_event' } });
    expect(await pick('회식 지워 줘')).toMatchObject({ name: 'report_unsupported', args: { action: 'delete_event' } });
    expect(await pick('고마워')).toMatchObject({ name: 'greet' });
    expect(await pick('날씨 어때')).toBeNull();
    await expect(fake.complete([{ role: 'user', content: '느려' }])).rejects.toMatchObject({ kind: 'timeout' });
    await expect(fake.complete([{ role: 'user', content: '고장' }])).rejects.toMatchObject({ kind: 'unavailable' });
    await expect(fake.complete([])).resolves.toMatchObject({ toolCalls: [] });
  });
});
