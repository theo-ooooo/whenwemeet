import type { Member } from '../common/member.js';
import type { ModelClarifyField, ModelUnsupportedAction } from './tools.js';

/** (#450) 응답 모양 (설계 AI-비서.md 2장, api.md 2.15). 시각은 ISO UTC 글자 */

export type ClarifyField = ModelClarifyField | 'participant';
/** team_only 는 서버가 정한다 (개인 팀 투표) */
export type UnsupportedAction = ModelUnsupportedAction | 'team_only';
export type DaysFilter = 'all' | 'weekend' | 'weekday';

export interface EventDraftCard {
  title: string;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  place: { text: string } | null;
  participants: number[];
  members: Member[];
}

export interface FreeQuery {
  from: string;
  to: string;
  dayStart: string;
  dayEnd: string;
  minMinutes: number;
  days: DaysFilter;
  participants: number[];
}

export interface PollDraft {
  title: string;
  options: { startsAt: string; endsAt: string; allDay: false }[];
  participants: number[];
}

export interface AssistantEvent {
  id: number;
  publicCode: string;
  title: string;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  occurrence: string | null;
  members: Member[];
}

export interface AssistantDay {
  name: string;
  date: string;
  kind: 'ANNIVERSARY' | 'BIRTHDAY';
  dday: number;
}

export type AssistantCard =
  | { type: 'eventDraft'; draft: EventDraftCard }
  | { type: 'freeSlots'; query: FreeQuery; slots: { startsAt: string; endsAt: string }[]; total: number; pollTitle: string | null }
  | { type: 'pollDraft'; draft: PollDraft; members: Member[] }
  | { type: 'eventList'; from: string; to: string; events: AssistantEvent[]; more: number; days: AssistantDay[] }
  | { type: 'clarify'; field: ClarifyField; choices: Member[] }
  | { type: 'unsupported'; action: UnsupportedAction; link: { label: string; href: string } | null }
  | { type: 'refusal' };

export interface AssistantReply {
  reply: string;
  cards: AssistantCard[];
  historyText: string;
  usage: { used: number; limit: number };
}

/** 문구 틀이 만든 답 (usage 는 서비스가 붙인다) */
export type ComposedReply = Omit<AssistantReply, 'usage'>;
