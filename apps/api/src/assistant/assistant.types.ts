import type { Member } from '../common/member.js';
import type { ModelClarifyField, ModelUnsupportedAction } from './tools.js';

/** (#450) 응답 모양 (설계 AI-비서.md 2장, api.md 2.15). 시각은 ISO UTC 글자 */

/** participant, change 는 서버가 정한다 (change: 고칠 일정은 찾았는데 바꿀 값이 없음, #511) */
export type ClarifyField = ModelClarifyField | 'participant' | 'change';
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
  /** (#566) "음력 3월 15일" 처럼 음력으로 말한 날짜면 true (D-298). 아니면 생략 */
  lunarInput?: true;
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

/**
 * (#511) 고치기, 지우기 대상 일정 (D-283). 반복이면 그 회차(occurrence)이고 웹은 scope=this 로만 고치고 지운다.
 * 시각, 제목, 장소는 지금 값 (반복 회차는 예외 반영)
 */
export interface EventTarget {
  id: number;
  publicCode: string;
  occurrence: string | null;
  repeat: boolean;
  title: string;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  place: { text: string } | null;
  members: Member[];
}

/** (#511) 고친 뒤 값. 웹이 PATCH 본문으로 보낸다 */
export interface EventAfter {
  title: string;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  place: { text: string } | null;
}

export interface EventEditDraft {
  target: EventTarget;
  after: EventAfter;
}

/** (#511) 후보 하나. 고치기는 after 가 있고, 지우기는 null. 웹이 누른 후보로 확인 카드를 만든다 (서버 요청 없음) */
export interface EventChoiceOption {
  target: EventTarget;
  after: EventAfter | null;
}

export type AssistantCard =
  | { type: 'eventDraft'; draft: EventDraftCard }
  | { type: 'freeSlots'; query: FreeQuery; slots: { startsAt: string; endsAt: string }[]; total: number; pollTitle: string | null }
  | { type: 'pollDraft'; draft: PollDraft; members: Member[] }
  | { type: 'eventEditDraft'; draft: EventEditDraft }
  | { type: 'eventDeleteDraft'; target: EventTarget }
  | { type: 'eventChoice'; action: 'edit' | 'delete'; options: EventChoiceOption[]; more: number }
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
