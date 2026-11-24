import type { Member, MemberResolver } from '../common/member.js';
import type { EventReminder } from '../push/remind-at.js';
import {
  type ReactionMember,
  type ReactionSummary,
  type RsvpMember,
  type RsvpSummary,
  occurrenceKey,
} from '../event-responses/responses.js';
import type { EventRow } from './event-rows.js';
import { type ParticipantSet, type ParticipantsView, toParticipantsView } from './participants.js';
import type { MatchedField } from './event-search.js';
import { type PlaceView, toPlaceView } from './place.js';
import { kstDate, type Occurrence, type Repeat } from './recurrence.js';

/** 일정 응답 모양 (한 번짜리, 반복 회차, 검색 결과, 응답 집계 묶기). EventsService 에서 옮김 (#496) */

export interface EventView {
  id: number;
  groupId: number;
  /** (#311) 주소용 공개 코드 (`/events/<코드>`) */
  publicCode: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  allDay: boolean;
  memo: string | null;
  creator: Member;
  createdAt: Date;
  updatedAt: Date;
  /** (#187) 반복 주기. 한 번짜리는 null */
  repeat: Repeat | null;
  /** (#187) 반복 종료일 'YYYY-MM-DD'. 계속이면 null */
  repeatUntil: string | null;
  /** (#187) 회차 날짜 (KST, 원래 날짜). 한 번짜리는 null */
  occurrence: string | null;
  /** (#187) 반복이면 첫 회차 시작 */
  seriesStartsAt: Date | null;
  /** (#228) 반복 기준 날짜 'YYYY-MM-DD'. null 이면 seriesStartsAt 의 KST 날짜 (D-71) */
  repeatAnchor: string | null;
  /** (#188) 그 회차의 실제 알림 (예외 반영) */
  reminder: EventReminder;
  /** (#248) 참여자 (D-134). 반복 회차는 원본 값 */
  participants: ParticipantsView;
  /** (#343) 일정 색 (팔레트 키). null 이면 자동 = 참여자 색. 반복 회차는 원본 값 (D-215) */
  color: string | null;
  /** (#199) 장소. 없으면 null. 반복 회차는 예외 반영 (D-242) */
  place: PlaceView | null;
}

/** (#190) 응답 집계를 붙인 일정 (목록, 단건, 생성, 수정 응답) */
export interface EventWithResponses extends EventView {
  rsvp: RsvpSummary;
  reactions: ReactionSummary;
}

/** 단건 GET 응답. 웹이 "이후 모두" 확인 문구를 띄울지 정한다 (D-67). (#190) 사람별 응답은 단건에만 */
export interface EventDetailView extends EventWithResponses {
  hasLaterExceptions: boolean;
  rsvpMembers: RsvpMember[];
  reactionMembers: ReactionMember[];
}

/** (#190) 응답, 반응의 대상 회차 하나 */
export interface ResponseTarget {
  view: EventView;
  /** 'YYYY-MM-DD'. 한 번짜리는 시작 KST 날짜 */
  occurrence: string;
  /** 그 회차의 지금 참여자 (모두면 지금 팀원 전원), 가입순 */
  participants: Member[];
  /** 지금 팀원, 가입순 */
  members: Member[];
}

/** (#190) 응답이 붙는 회차 날짜. 한 번짜리는 시작 KST 날짜 (D-224) */
export function responseOccurrence(view: Pick<EventView, 'occurrence' | 'startsAt'>): string {
  return view.occurrence ?? kstDate(view.startsAt);
}

/** (#190) 사람 목록의 userId (탈퇴자 null 은 빼고) */
export const idsOf = (members: readonly Member[]): number[] => members.flatMap((member) => (member.userId === null ? [] : [member.userId]));

/** (#199) 검색 결과 한 줄 (api.md 2.3 일정 검색) */
export interface SearchItem {
  event: EventView;
  group: { id: number; name: string; publicCode: string };
  matched: MatchedField[];
  /** 끝이 지금보다 뒤면 true */
  upcoming: boolean;
}

export interface SearchResult {
  items: SearchItem[];
  /** limit 를 넘는 결과가 더 있으면 true. 페이지 넘김 대신 "검색어를 더 구체적으로" (D-245) */
  hasMore: boolean;
}

/** 한 번짜리 일정, 또는 반복 원본의 첫 회차(예외 없음)로 본 응답 */
export function toEventView(row: EventRow, resolver: MemberResolver): EventView {
  return {
    id: row.id,
    groupId: row.groupId,
    publicCode: row.publicCode,
    title: row.title,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    allDay: row.allDay,
    memo: row.memo,
    creator: resolver.resolve(row.creatorId, row.creator),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    repeat: row.repeat ?? null,
    repeatUntil: row.repeatUntil ?? null,
    occurrence: row.repeat ? kstDate(row.startsAt) : null,
    seriesStartsAt: row.repeat ? row.startsAt : null,
    repeatAnchor: row.repeat ? row.repeatAnchor : null,
    reminder: row.reminder,
    participants: toParticipantsView(row, resolver),
    color: row.color,
    place: toPlaceView(row.place),
  };
}

/** (#248) 저장된 참여자 */
export function participantsOf(row: Pick<EventRow, 'allMembers' | 'participantIds'>): ParticipantSet {
  return { allMembers: row.allMembers, ids: row.allMembers ? [] : row.participantIds };
}

/** 반복 원본의 회차 하나로 본 응답. 예외로 바꾼 제목/메모가 있으면 그 값 */
export function toOccurrenceView(row: EventRow, occurrence: Occurrence, resolver: MemberResolver): EventView {
  return {
    ...toEventView(row, resolver),
    title: occurrence.title ?? row.title,
    startsAt: occurrence.startsAt,
    endsAt: occurrence.endsAt,
    allDay: occurrence.allDay,
    memo: occurrence.memo ?? row.memo,
    occurrence: occurrence.occurrence,
    reminder: occurrence.reminder ?? row.reminder,
    place: toPlaceView(occurrence.place ?? row.place),
  };
}

/** startsAt 오름차순, 같으면 id, 그다음 회차 날짜 */
export function sortViews(views: EventView[]): EventView[] {
  return views.sort(
    (a, b) => a.startsAt.getTime() - b.startsAt.getTime() || a.id - b.id || (a.occurrence ?? '').localeCompare(b.occurrence ?? ''),
  );
}

/** (#190) 목록 집계용: (eventId, 회차) 키로 묶는다 */
export function groupBy<T extends { eventId: number; occurrence: string }>(rows: readonly T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const key = occurrenceKey(row.eventId, row.occurrence);
    const list = map.get(key);
    if (list) list.push(row);
    else map.set(key, [row]);
  }
  return map;
}
