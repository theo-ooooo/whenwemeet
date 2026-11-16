import type { Member } from '../common/member.js';
import { addDays, kstDate } from '../events/recurrence.js';
import { KST_OFFSET_MS } from '../free-slots/slots.js';
import type {
  AssistantCard,
  AssistantDay,
  AssistantEvent,
  ClarifyField,
  ComposedReply,
  EventDraftCard,
  FreeQuery,
  PollDraft,
  UnsupportedAction,
} from './assistant.types.js';
import { truncate } from './normalize.js';
import { dateRanges, WEEKDAYS, kstWeekday } from './prompt.js';

/**
 * (#450) 답 문구 틀 (설계 AI-비서.md 4-3, 4-4, D-267). `reply` 는 언제나 여기서 만든다. 모델이 보낸 글자(content)는 쓰지 않는다.
 * historyText 는 웹이 다음 요청의 assistant 턴으로 그대로 돌려보내는 요약 (≤600자)
 */

export const HISTORY_MAX = 600;
export const LIST_MAX = 10;
export const SLOTS_MAX = 5;
export const DAYS_MAX = 5;

export const REFUSAL_REPLY = '볼까는 일정 만들기, 빈 시간 찾기, 투표, 일정 묻기만 도와 드려요';
export const GREET_REPLY = '무엇을 도와 드릴까요? 일정 만들기, 빈 시간 찾기, 투표, 일정 묻기를 할 수 있어요';
export const INVALID_REPLY = '잘 이해하지 못했어요. 날짜와 시간을 넣어 다시 말해 주세요';

// ---------- 날짜 글자 (KST) ----------

/** '11-21(토)' */
export const shortDate = (date: string): string => `${date.slice(5)}(${WEEKDAYS[kstWeekday(date)]})`;
/** '11월 27일 (금)' */
export const longDate = (date: string): string => `${Number(date.slice(5, 7))}월 ${Number(date.slice(8, 10))}일 (${WEEKDAYS[kstWeekday(date)]})`;
/** '11월 27일' */
const monthDay = (date: string): string => `${Number(date.slice(5, 7))}월 ${Number(date.slice(8, 10))}일`;
/** KST 'HH:mm' */
export const hm = (instant: Date): string => new Date(instant.getTime() + KST_OFFSET_MS).toISOString().slice(11, 16);

/** 'HH:mm~HH:mm'. 끝이 다음 날 자정이면 24:00 */
function timeSpan(startsAt: Date, endsAt: Date): string {
  const end = hm(endsAt) === '00:00' && kstDate(endsAt) === addDays(kstDate(startsAt), 1) ? '24:00' : hm(endsAt);
  return `${hm(startsAt)}~${end}`;
}

/** '11-21(토) 18:00~22:00' */
const slotText = (slot: { startsAt: string; endsAt: string }): string => {
  const startsAt = new Date(slot.startsAt);
  return `${shortDate(kstDate(startsAt))} ${timeSpan(startsAt, new Date(slot.endsAt))}`;
};

/** 은/는 (받침 기준) */
function topic(word: string): string {
  const last = Array.from(word).pop() ?? '';
  const code = last.charCodeAt(0);
  const final = code >= 0xac00 && code <= 0xd7a3 && (code - 0xac00) % 28 !== 0;
  return final ? '은' : '는';
}

/** 사용자 말에서 온 이름 (20자) */
const userWord = (text: string): string => truncate(text, 20);

const names = (members: readonly Member[]): string => members.map((member) => member.displayName).join(', ');

const history = (text: string): string => truncate(text, HISTORY_MAX);

function compose(reply: string, cards: AssistantCard[], historyText: string): ComposedReply {
  return { reply, cards, historyText: history(historyText) };
}

// ---------- 경우별 ----------

export const refusalReply = (): ComposedReply => compose(REFUSAL_REPLY, [{ type: 'refusal' }], '[거절]');
export const greetReply = (): ComposedReply => compose(GREET_REPLY, [], '[인사]');
export const invalidReply = (): ComposedReply => compose(INVALID_REPLY, [], '[이해 못 함]');

const CLARIFY_TEXT: Record<Exclude<ClarifyField, 'participant'>, string> = {
  date: '언제로 할까요?',
  time: '몇 시로 할까요?',
  title: '무슨 일정인가요?',
  period: '언제쯤으로 찾아볼까요?',
  which: '어떤 일정을 말하는지 알려 주세요',
};

/** (#474) 되묻는 일정 이름 머리말 "'영화'는 " (일정 여럿 중 하나를 되물을 때, D-280) */
export const subjectPrefix = (title: string): string => {
  const word = userWord(title);
  return word ? `'${word}'${topic(word)} ` : '';
};

export function clarifyReply(field: ClarifyField, extra: { name?: string; choices?: Member[]; subject?: string } = {}): ComposedReply {
  let reply: string;
  if (field === 'participant') {
    const name = userWord(extra.name ?? '');
    reply = extra.choices?.length ? `'${name}'님이 누구인가요?` : `'${name}'님을 이 팀에서 찾지 못했어요. 누구를 말하는지 알려 주세요`;
  } else {
    reply = CLARIFY_TEXT[field];
  }
  if (extra.subject) reply = `${subjectPrefix(extra.subject)}${reply}`;
  return compose(reply, [{ type: 'clarify', field, choices: extra.choices ?? [] }], `[되물음] ${reply}`);
}

const UNSUPPORTED: Record<UnsupportedAction, { reply: string; history: string }> = {
  edit_event: { reply: '일정 고치기는 아직 못 해요. 일정을 눌러 고칠 수 있어요', history: '일정 고치기는 못 함' },
  delete_event: { reply: '일정 지우기는 아직 못 해요. 일정을 눌러 지울 수 있어요', history: '일정 지우기는 못 함' },
  repeat: { reply: '반복과 알림은 일정 화면에서 넣을 수 있어요', history: '반복 넣기는 못 함' },
  reminder: { reply: '반복과 알림은 일정 화면에서 넣을 수 있어요', history: '알림 넣기는 못 함' },
  anniversary_create: { reply: '기념일은 기념일 화면에서 넣을 수 있어요', history: '기념일 만들기는 못 함' },
  todo: { reply: '할 일은 할 일 화면에서 할 수 있어요', history: '할 일은 못 함' },
  team: { reply: '팀 관리는 팀 화면에서 할 수 있어요', history: '팀 관리는 못 함' },
  other_team: { reply: '볼까는 지금 보는 팀 일정만 알아요. 팀을 바꾸고 물어봐 주세요', history: '다른 팀은 못 봄' },
  team_only: { reply: '투표는 여럿이 있는 팀에서 열 수 있어요', history: '개인 달력에서는 투표 못 함' },
  other: { reply: '그건 아직 못 해요', history: '못 하는 일' },
};

/** 못 하는 일 안내의 링크 (4-4). 고치기, 지우기는 검색어가 있으면 일정 찾기 */
export function unsupportedLink(action: UnsupportedAction, keyword: string | null): { label: string; href: string } | null {
  switch (action) {
    case 'edit_event':
    case 'delete_event':
      return keyword ? { label: '일정 찾기', href: `/search?q=${encodeURIComponent(keyword)}` } : { label: '달력 열기', href: '/calendar' };
    case 'repeat':
    case 'reminder':
      return { label: '일정 추가', href: '/events/new' };
    case 'anniversary_create':
      return { label: '기념일 열기', href: '/anniversaries' };
    case 'todo':
      return { label: '할 일 열기', href: '/todos' };
    case 'team':
      return { label: '팀 열기', href: '/team' };
    default:
      return null;
  }
}

export function unsupportedReply(action: UnsupportedAction, keyword: string | null): ComposedReply {
  const text = UNSUPPORTED[action];
  return compose(text.reply, [{ type: 'unsupported', action, link: unsupportedLink(action, keyword) }], `[안내] ${text.history}`);
}

/** '2026-11-27(금) 19:00~20:00', 종일은 '2026-11-30(일) 하루 종일' 또는 '2026-11-30(일)~2026-12-01(월) 하루 종일' */
function draftWhen(draft: EventDraftCard): string {
  const startsAt = new Date(draft.startsAt);
  const endsAt = new Date(draft.endsAt);
  const start = kstDate(startsAt);
  const day = (date: string) => `${date}(${WEEKDAYS[kstWeekday(date)]})`;
  if (draft.allDay) {
    const last = addDays(kstDate(endsAt), -1);
    return last === start ? `${day(start)} 하루 종일` : `${day(start)}~${day(last)} 하루 종일`;
  }
  const end = kstDate(endsAt);
  return end === start || hm(endsAt) === '00:00' ? `${day(start)} ${timeSpan(startsAt, endsAt)}` : `${day(start)} ${hm(startsAt)}~${day(end)} ${hm(endsAt)}`;
}

/** '[일정 초안] 회식, 2026-11-17(화) 19:00~20:00, 장소 강남, 참여자 민지' */
function draftHistory(draft: EventDraftCard): string {
  const parts = [`[일정 초안] ${draft.title}`, draftWhen(draft)];
  if (draft.place) parts.push(`장소 ${draft.place.text}`);
  if (draft.members.length > 0) parts.push(`참여자 ${names(draft.members)}`);
  return parts.join(', ');
}

export function eventDraftReply(draft: EventDraftCard): ComposedReply {
  return eventDraftsReply([draft]);
}

/**
 * (#474) 일정 초안 여러 개 (D-280). 카드는 일정마다 하나, 기록 요약은 " / " 로 잇는다.
 * 600자를 넘으면 compose 가 뒤를 자른다 (앞 일정부터 남는다)
 */
export function eventDraftsReply(drafts: readonly EventDraftCard[]): ComposedReply {
  const reply = drafts.length > 1 ? `일정 ${drafts.length}개를 이렇게 넣을까요?` : '이렇게 넣을까요?';
  return compose(
    reply,
    drafts.map((draft) => ({ type: 'eventDraft' as const, draft })),
    drafts.map(draftHistory).join(' / '),
  );
}

export interface FreeResult {
  query: FreeQuery;
  slots: { startsAt: string; endsAt: string }[];
  total: number;
  pollTitle: string | null;
  /** next = poll 이고 팀이면 투표 초안 (후보 2개 이상일 때만) */
  poll: { draft: PollDraft; members: Member[] } | null;
}

export function freeSlotsReply(result: FreeResult): ComposedReply {
  if (result.total === 0) {
    return compose('그 조건으로는 다 같이 비는 시간이 없어요. 기간이나 시간대를 넓혀 볼까요?', [], '[빈 시간] 없음');
  }
  const k = result.slots.length;
  const freeHistory = `[빈 시간] ${result.slots.map(slotText).join('; ')}`;
  const card: AssistantCard = { type: 'freeSlots', query: result.query, slots: result.slots, total: result.total, pollTitle: result.pollTitle };
  if (result.poll) {
    const { draft, members } = result.poll;
    return compose(
      `${draft.options.length}개로 투표를 열까요?`,
      [card, { type: 'pollDraft', draft, members }],
      `${freeHistory} [투표 초안] 제목 ${draft.title}, 후보 ${draft.options.length}개`,
    );
  }
  return compose(`${result.total}개 찾았어요. 가까운 순으로 ${k}개예요`, [card], freeHistory);
}

export function pollDraftReply(draft: PollDraft, members: Member[]): ComposedReply {
  return compose('이 후보로 투표를 열까요?', [{ type: 'pollDraft', draft, members }], `[투표 초안] ${draft.title}, ${draft.options.map(slotText).join('; ')}`);
}

/** {기간 말}: 이번 주, 다음 주, 이번 달, 다음 달, 오늘, 내일, 그 밖 "11월 20일 ~ 11월 30일" */
export function periodLabel(fromDate: string, toDate: string, today: string): string {
  const ranges = dateRanges(today);
  const same = (range: [string, string]) => range[0] === fromDate && range[1] === toDate;
  if (same(ranges.thisWeek)) return '이번 주';
  if (same(ranges.nextWeek)) return '다음 주';
  if (same(ranges.thisMonth)) return '이번 달';
  if (same(ranges.nextMonth)) return '다음 달';
  if (fromDate === toDate) {
    if (fromDate === today) return '오늘';
    if (fromDate === addDays(today, 1)) return '내일';
    return monthDay(fromDate);
  }
  return `${monthDay(fromDate)} ~ ${monthDay(toDate)}`;
}

export interface ListResult {
  fromDate: string;
  toDate: string;
  from: Date;
  to: Date;
  events: AssistantEvent[];
  total: number;
}

export function eventListReply(result: ListResult, today: string): ComposedReply {
  const label = periodLabel(result.fromDate, result.toDate, today);
  const shown = result.events.slice(0, LIST_MAX);
  const reply = result.total === 0 ? `${label}에는 일정이 없어요` : `${label}에 일정이 ${result.total}개 있어요`;
  const lines = shown.map((event) => {
    const startsAt = new Date(event.startsAt);
    return `${shortDate(kstDate(startsAt))} ${event.allDay ? '하루 종일' : hm(startsAt)} ${event.title}`;
  });
  const card: AssistantCard = {
    type: 'eventList',
    from: result.from.toISOString(),
    to: result.to.toISOString(),
    events: shown,
    more: Math.max(0, result.total - shown.length),
    days: [],
  };
  return compose(reply, [card], `[일정 목록 ${result.fromDate.slice(5)}~${result.toDate.slice(5)}] ${lines.join('; ')}`.trimEnd());
}

export interface AnniversaryResult {
  from: Date;
  to: Date;
  days: AssistantDay[];
}

export function anniversaryReply(result: AnniversaryResult): ComposedReply {
  const days = result.days.slice(0, DAYS_MAX);
  let reply: string;
  if (days.length === 0) reply = '찾는 기념일이 없어요';
  else if (days.length === 1) {
    const day = days[0];
    const when = day.dday === 0 ? '오늘이에요' : day.dday > 0 ? `D-${day.dday}` : `D+${-day.dday}`;
    reply = `'${day.name}'${topic(day.name)} ${longDate(day.date)}이에요. ${when}`;
  } else reply = `${days.length}개 찾았어요`;
  if (days.length === 0) return compose(reply, [], '[기념일] 없음');
  const card: AssistantCard = { type: 'eventList', from: result.from.toISOString(), to: result.to.toISOString(), events: [], more: 0, days };
  return compose(reply, [card], `[기념일] ${days.map((day) => `${day.name} ${day.date}`).join('; ')}`);
}
