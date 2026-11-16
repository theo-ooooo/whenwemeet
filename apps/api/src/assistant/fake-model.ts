import { AssistantModelError, type AssistantModel, type ModelMessage, type ModelResult, type ModelToolCall } from './assistant-model.js';
import { NO_WHEN, type WhenArg } from './when.js';

/** 날짜 표현 (#458) */
const relative = (days: number): WhenArg => ({ ...NO_WHEN, kind: 'relativeDays', days });

/**
 * (#450) 가짜 모델 (`ASSISTANT_FAKE=1`, 로컬과 e2e. 운영에서는 쓰지 않는다, D-271). 마지막 사용자 글의 키워드로 도구를 고른다.
 * - "느려" → 시간 초과(504), "고장" → 쓸 수 없음(503)
 * - "잡아", "넣어" → draft_event (내일 19:00, "OO이랑/랑/하고" 의 OO 를 참여자로). "회식" 과 "영화" 가 같이 있으면 일정 2개 (#474)
 * - "빈 시간", "되는" → find_free_time (오늘부터 7일, "투표" 면 poll)
 * - "뭐 있" → list_events (이번 주), "생일", "기념일" → find_anniversary
 * - "고쳐", "바꿔" → 고치기 안내, "지워" → 지우기 안내, "안녕", "고마워" → 인사
 * - 그 밖(날씨 등)은 도구 없이 글로 답한다 → 서버 가드가 거절로 바꾼다
 */
export class FakeAssistantModel implements AssistantModel {
  readonly kind = 'fake' as const;

  complete(messages: ModelMessage[]): Promise<ModelResult> {
    const text = [...messages].reverse().find((message) => message.role === 'user')?.content ?? '';
    if (text.includes('느려')) return Promise.reject(new AssistantModelError('timeout'));
    if (text.includes('고장')) return Promise.reject(new AssistantModelError('unavailable', 500));
    const call = this.pick(text);
    return Promise.resolve({
      toolCalls: call ? [call] : [],
      text: call ? null : '가짜 모델의 자유 답 (화면에 나가면 안 된다)',
      finishReason: call ? 'tool_calls' : 'stop',
      usage: { promptTokens: 0, cachedTokens: 0, completionTokens: 0 },
      model: 'fake',
    });
  }

  private pick(text: string): ModelToolCall | null {
    const call = (name: string, args: Record<string, unknown>): ModelToolCall => ({ name, arguments: JSON.stringify(args) });
    const person = /(\S+?)(?:이랑|랑|하고)(?=\s|$)/.exec(text)?.[1] ?? null;
    if (text.includes('고쳐') || text.includes('바꿔')) return call('report_unsupported', { action: 'edit_event', keyword: null });
    if (text.includes('지워')) return call('report_unsupported', { action: 'delete_event', keyword: null });
    if (text.includes('잡아') || text.includes('넣어')) {
      const event = (title: string, date: WhenArg, startTime: string, endTime: string, participants: string[]) => ({
        title,
        date,
        startTime,
        endDate: NO_WHEN,
        endTime,
        allDay: false,
        place: null,
        participants,
        everyone: false,
        includeMe: true,
      });
      // (#474) "회식" 과 "영화" 가 같이 있으면 일정 2개 (내일 19:00 회식, 토요일 14:00 영화)
      if (text.includes('회식') && text.includes('영화')) {
        return call('draft_event', {
          events: [event('회식', relative(1), '19:00', '21:00', []), event('영화', { ...NO_WHEN, kind: 'weekday', weekday: '토', which: 'nearest' }, '14:00', '16:00', [])],
        });
      }
      return call('draft_event', { events: [event('약속', relative(1), '19:00', '20:00', person ? [person] : [])] });
    }
    if (text.includes('빈 시간') || text.includes('되는')) {
      return call('find_free_time', {
        from: relative(0),
        to: relative(6),
        days: 'all',
        dayStart: null,
        dayEnd: null,
        minMinutes: null,
        participants: person ? [person] : [],
        everyone: !person,
        includeMe: true,
        next: text.includes('투표') ? 'poll' : 'show',
        purpose: null,
      });
    }
    if (text.includes('뭐 있')) return call('list_events', { from: { ...NO_WHEN, kind: 'week', which: 'this' }, to: NO_WHEN, member: person });
    if (text.includes('생일') || text.includes('기념일')) return call('find_anniversary', { keyword: null, from: NO_WHEN, to: NO_WHEN });
    if (text.includes('안녕') || text.includes('고마워')) return call('greet', {});
    return null;
  }
}
