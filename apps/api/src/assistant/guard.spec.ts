import type { ModelResult } from './assistant-model.js';
import { decide } from './guard.js';
import { ASSISTANT_TOOLS, checkArgs, TOOL_NAMES, TOOL_SCHEMAS, type Schema } from './tools.js';

const result = (calls: { name: string; arguments: string }[], extra: Partial<ModelResult> = {}): ModelResult => ({
  toolCalls: calls,
  text: '모델 글자',
  finishReason: 'tool_calls',
  usage: null,
  model: 'm',
  ...extra,
});
const call = (name: string, args: unknown) => ({ name, arguments: JSON.stringify(args) });

describe('decide (서버 가드, 설계 5장)', () => {
  it('도구 없음(글만, 빈 답), finish_reason length / content_filter → 거절', () => {
    expect(decide(result([]))).toEqual({ kind: 'refusal' });
    expect(decide(result([], { text: null }))).toEqual({ kind: 'refusal' });
    expect(decide(result([call('greet', {})], { finishReason: 'length' }))).toEqual({ kind: 'refusal' });
    expect(decide(result([call('greet', {})], { finishReason: 'content_filter' }))).toEqual({ kind: 'refusal' });
  });

  it('모르는 도구, 깨진 JSON, 스키마 위반(모르는 키, 빠진 키, 형, enum, pattern) → 형식 실패', () => {
    expect(decide(result([call('run_sql', {})]))).toEqual({ kind: 'invalid' });
    expect(decide(result([{ name: 'greet', arguments: '{' }]))).toEqual({ kind: 'invalid' });
    expect(decide(result([call('greet', { extra: 1 })]))).toEqual({ kind: 'invalid' });
    expect(decide(result([call('refuse', {})]))).toEqual({ kind: 'invalid' });
    expect(decide(result([call('refuse', { reason: 'bored' })]))).toEqual({ kind: 'invalid' });
    expect(decide(result([call('list_events', { fromDate: '11/16', toDate: '2026-11-20', member: null })]))).toEqual({ kind: 'invalid' });
    expect(decide(result([call('list_events', { fromDate: '2026-11-16', toDate: '2026-11-20', member: 3 })]))).toEqual({ kind: 'invalid' });
    expect(decide(result([call('constructor', {})]))).toEqual({ kind: 'invalid' });
  });

  it('refuse → 거절, greet → 인사, 데이터 도구 → 인자 그대로 (첫 번째 도구만 본다)', () => {
    expect(decide(result([call('refuse', { reason: 'role_change' })]))).toEqual({ kind: 'refusal' });
    expect(decide(result([call('greet', {})]))).toEqual({ kind: 'greet' });
    const args = { field: 'date' };
    expect(decide(result([call('ask_clarification', args), call('refuse', { reason: 'off_topic' })]))).toEqual({ kind: 'tool', name: 'ask_clarification', args });
    expect(decide(result([call('refuse', { reason: 'off_topic' }), call('ask_clarification', args)]))).toEqual({ kind: 'refusal' });
  });
});

describe('도구 스키마 (설계 3-2)', () => {
  it('도구 9개, 모두 strict 규칙: object, 모든 키 필수, additionalProperties false, id 인자 없음', () => {
    expect(TOOL_NAMES).toEqual(['draft_event', 'find_free_time', 'draft_poll', 'list_events', 'find_anniversary', 'ask_clarification', 'report_unsupported', 'refuse', 'greet']);
    expect(ASSISTANT_TOOLS).toHaveLength(9);
    const walk = (schema: Schema, path: string) => {
      if (schema.type === 'object') {
        expect(schema.additionalProperties, path).toBe(false);
        expect([...(schema.required ?? [])].sort(), path).toEqual(Object.keys(schema.properties ?? {}).sort());
        for (const [key, child] of Object.entries(schema.properties ?? {})) {
          expect(key.toLowerCase().endsWith('id'), `${path}.${key}`).toBe(false);
          walk(child, `${path}.${key}`);
        }
      }
      if (schema.items) walk(schema.items, `${path}[]`);
    };
    for (const name of TOOL_NAMES) walk(TOOL_SCHEMAS[name].parameters as Schema, name);
  });

  it('checkArgs: 배열 개수, 항목, null 허용', () => {
    const poll = TOOL_SCHEMAS.draft_poll.parameters as Schema;
    const option = { date: '2026-11-21', startTime: '18:00', endTime: '20:00' };
    expect(checkArgs(poll, { title: 't', options: [option, option], participants: [], everyone: true })).toBe(true);
    expect(checkArgs(poll, { title: 't', options: [option], participants: [], everyone: true })).toBe(false);
    expect(checkArgs(poll, { title: 't', options: Array(6).fill(option), participants: [], everyone: true })).toBe(false);
    expect(checkArgs(poll, { title: 't', options: [option, { ...option, endTime: '25:00' }], participants: [], everyone: true })).toBe(false);
    expect(checkArgs(poll, { title: 't', options: [option, option], participants: [1], everyone: true })).toBe(false);
    expect(checkArgs(poll, [])).toBe(false);
    const free = TOOL_SCHEMAS.find_free_time.parameters as Schema;
    const base = { fromDate: '2026-11-16', toDate: '2026-11-22', days: 'all', dayStart: null, dayEnd: '24:00', minMinutes: 90, participants: [], everyone: true, includeMe: true, next: 'show', purpose: null };
    expect(checkArgs(free, base)).toBe(true);
    expect(checkArgs(free, { ...base, minMinutes: 90.5 })).toBe(false);
    expect(checkArgs(free, { ...base, dayStart: '24:00' })).toBe(false);
  });
});
