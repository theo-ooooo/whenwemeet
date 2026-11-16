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
    const when = { kind: 'date', date: '2026-11-16', days: null, weekday: null, which: null, month: null, day: null };
    expect(decide(result([call('list_events', { from: { ...when, date: '11/16' }, to: when, member: null })]))).toEqual({ kind: 'invalid' });
    expect(decide(result([call('list_events', { from: when, to: when, member: 3 })]))).toEqual({ kind: 'invalid' });
    // (#458) 계산한 날짜만 보내는 옛 모양, 날짜 표현의 모르는 kind, 요일 숫자, 빠진 키
    expect(decide(result([call('list_events', { fromDate: '2026-11-16', toDate: '2026-11-20', member: null })]))).toEqual({ kind: 'invalid' });
    expect(decide(result([call('list_events', { from: { ...when, kind: 'tomorrow' }, to: when, member: null })]))).toEqual({ kind: 'invalid' });
    expect(decide(result([call('list_events', { from: { ...when, kind: 'weekday', weekday: 5 }, to: when, member: null })]))).toEqual({ kind: 'invalid' });
    const { day: _day, ...missing } = when;
    expect(decide(result([call('list_events', { from: missing, to: when, member: null })]))).toEqual({ kind: 'invalid' });
    expect(decide(result([call('list_events', { from: { ...when, days: 1.5 }, to: when, member: null })]))).toEqual({ kind: 'invalid' });
    expect(decide(result([call('constructor', {})]))).toEqual({ kind: 'invalid' });
  });

  it('refuse → 거절, greet → 인사, 데이터 도구 → 인자 그대로 (첫 번째 도구만 본다)', () => {
    expect(decide(result([call('refuse', { reason: 'role_change' })]))).toEqual({ kind: 'refusal' });
    expect(decide(result([call('greet', {})]))).toEqual({ kind: 'greet' });
    const args = { field: 'date' };
    expect(decide(result([call('ask_clarification', args), call('refuse', { reason: 'off_topic' })]))).toEqual({ kind: 'tool', name: 'ask_clarification', args });
    expect(decide(result([call('refuse', { reason: 'off_topic' }), call('ask_clarification', args)]))).toEqual({ kind: 'refusal' });
  });

  it('(#474) draft_event 일정이 5개를 넘으면 앞 5개만 넘기고, 5개 안의 형식 실패는 그대로 형식 실패', () => {
    const nowhen = { kind: null, date: null, days: null, weekday: null, which: null, month: null, day: null };
    const event = (title: string) => ({ title, date: { ...nowhen, kind: 'relativeDays', days: 1 }, startTime: '19:00', endDate: nowhen, endTime: null, allDay: false, place: null, participants: [], everyone: false, includeMe: true });
    const seven = Array.from({ length: 7 }, (_, i) => event(`일정${i + 1}`));
    const outcome = decide(result([call('draft_event', { events: seven })]));
    expect(outcome).toMatchObject({ kind: 'tool', name: 'draft_event' });
    expect((outcome as unknown as { args: { events: { title: string }[] } }).args.events.map((e) => e.title)).toEqual(['일정1', '일정2', '일정3', '일정4', '일정5']);
    // 6번째(버리는 일정)가 깨져 있어도 앞 5개로 본다. 앞 5개 안이 깨지면 형식 실패
    expect(decide(result([call('draft_event', { events: [...seven.slice(0, 5), { bad: 1 }] })]))).toMatchObject({ kind: 'tool' });
    expect(decide(result([call('draft_event', { events: [{ bad: 1 }, ...seven] })]))).toEqual({ kind: 'invalid' });
    expect(decide(result([call('draft_event', { events: [] })]))).toEqual({ kind: 'invalid' });
    expect(decide(result([call('draft_event', seven[0])]))).toEqual({ kind: 'invalid' });
  });
});

describe('(#474) kind 만 빠진 날짜 표현 채우기 (D-281)', () => {
  const none = { kind: null, date: null, days: null, weekday: null, which: null, month: null, day: null };
  const event = (date: Record<string, unknown>) => ({
    title: '회식', date, startTime: '19:00', endDate: none, endTime: null, allDay: false, place: null,
    participants: [], everyone: false, includeMe: true,
  });
  const datesOf = (args: unknown) => (args as { events: { date: { kind: unknown }; endDate: { kind: unknown } }[] }).events;

  it('요일, 날짜, 며칠 뒤, 며칠 값이 있으면 그 kind, 값이 없으면 null 그대로', () => {
    const outcome = decide(result([call('draft_event', { events: [
      event({ ...none, weekday: '금', which: 'nearest' }),
      event({ ...none, date: '2026-12-01' }),
      event({ ...none, days: 1 }),
      event({ ...none, month: 11, day: 27 }),
      event(none),
    ] })]));
    expect(outcome.kind).toBe('tool');
    const events = datesOf((outcome as { args: unknown }).args);
    expect(events.map((e) => e.date.kind)).toEqual(['weekday', 'date', 'relativeDays', 'monthDay', null]);
    expect(events.every((e) => e.endDate.kind === null)).toBe(true);
  });

  it('kind 가 있으면 건드리지 않는다', () => {
    const when = { ...none, kind: 'week', which: 'next', weekday: '금' };
    const outcome = decide(result([call('list_events', { from: when, to: none, member: null })]));
    expect((outcome as { args: Record<string, unknown> }).args.from).toEqual(when);
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
    const nowhen = { kind: null, date: null, days: null, weekday: null, which: null, month: null, day: null };
    const option = { date: { ...nowhen, kind: 'weekday', weekday: '토', which: 'this' }, startTime: '18:00', endTime: '20:00' };
    expect(checkArgs(poll, { title: 't', options: [option, option], participants: [], everyone: true })).toBe(true);
    expect(checkArgs(poll, { title: 't', options: [option], participants: [], everyone: true })).toBe(false);
    expect(checkArgs(poll, { title: 't', options: Array(6).fill(option), participants: [], everyone: true })).toBe(false);
    expect(checkArgs(poll, { title: 't', options: [option, { ...option, endTime: '25:00' }], participants: [], everyone: true })).toBe(false);
    expect(checkArgs(poll, { title: 't', options: [option, option], participants: [1], everyone: true })).toBe(false);
    expect(checkArgs(poll, [])).toBe(false);
    // (#474) draft_event 는 일정 객체 배열 (1~5개), 일정마다 스키마 검사
    const draftSchema = TOOL_SCHEMAS.draft_event.parameters as Schema;
    const event = { title: '회식', date: { ...nowhen, kind: 'relativeDays', days: 1 }, startTime: '19:00', endDate: nowhen, endTime: null, allDay: false, place: null, participants: [], everyone: false, includeMe: true };
    expect(checkArgs(draftSchema, { events: [event] })).toBe(true);
    expect(checkArgs(draftSchema, { events: Array(5).fill(event) })).toBe(true);
    expect(checkArgs(draftSchema, { events: [] })).toBe(false);
    expect(checkArgs(draftSchema, { events: Array(6).fill(event) })).toBe(false);
    expect(checkArgs(draftSchema, event)).toBe(false);
    expect(checkArgs(draftSchema, { events: [event, { ...event, startTime: '7pm' }] })).toBe(false);
    expect(checkArgs(draftSchema, { events: [event, { ...event, groupId: 2 }] })).toBe(false);
    const { includeMe: _includeMe, ...noIncludeMe } = event;
    expect(checkArgs(draftSchema, { events: [event, noIncludeMe] })).toBe(false);
    expect(checkArgs(draftSchema, { events: [event, 'event'] })).toBe(false);
    const free = TOOL_SCHEMAS.find_free_time.parameters as Schema;
    const base = { from: { ...nowhen, kind: 'week', which: 'next' }, to: nowhen, days: 'all', dayStart: null, dayEnd: '24:00', minMinutes: 90, participants: [], everyone: true, includeMe: true, next: 'show', purpose: null };
    expect(checkArgs(free, base)).toBe(true);
    expect(checkArgs(free, { ...base, minMinutes: 90.5 })).toBe(false);
    expect(checkArgs(free, { ...base, dayStart: '24:00' })).toBe(false);
  });
});
