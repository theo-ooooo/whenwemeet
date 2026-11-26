// (#190) 참석 여부와 반응의 순수 규칙. Prisma 를 import 하지 않는다 (단위 테스트 대상)
import { ApiException } from '../common/errors.js';
import type { Member } from '../common/member.js';

export const RSVP_STATUSES = ['GOING', 'NOT_GOING', 'MAYBE'] as const;
export type RsvpStatus = (typeof RSVP_STATUSES)[number];

export const REACTION_KINDS = ['LIKE', 'EXCITED', 'ACK'] as const;
export type ReactionKind = (typeof REACTION_KINDS)[number];

/** 목록, 단건 공통 집계. pending = 참여자 중 아직 응답하지 않은 사람 수 */
export interface RsvpSummary {
  going: number;
  notGoing: number;
  maybe: number;
  pending: number;
  mine: RsvpStatus | null;
}

export interface ReactionSummary {
  LIKE: number;
  EXCITED: number;
  ACK: number;
  mine: ReactionKind | null;
}

/** 단건 GET 의 사람별 응답. 참여자 가입순 */
export interface RsvpMember {
  member: Member;
  status: RsvpStatus | null;
  respondedAt: Date | null;
  /** 응답한 뒤 그 회차 시각이 바뀌었는지 (D-226) */
  stale: boolean;
}

export interface ReactionMember {
  member: Member;
  reaction: ReactionKind;
}

/** 저장된 응답 한 줄 (회차 하나) */
export interface RsvpRecord {
  userId: number;
  status: RsvpStatus;
  seenStartsAt: Date;
  seenEndsAt: Date;
  updatedAt: Date;
}

export interface ReactionRecord {
  userId: number;
  kind: ReactionKind;
  createdAt: Date;
}

/** 같은 사람이 같은 회차를 이 시간 안에 다시 바꾸면 새 소식 한 줄을 고친다 (D-227) */
export const RSVP_NEWS_MERGE_MS = 2 * 60 * 1000;

export const NOT_PARTICIPANT_MESSAGE = '이 일정의 참여자만 응답할 수 있어요';

/** 본문 `status`. undefined(빠짐)도 형식 오류. null 은 응답 취소 */
export function parseRsvpStatus(raw: unknown): RsvpStatus | null {
  if (raw === null) return null;
  if (
    typeof raw === 'string' &&
    (RSVP_STATUSES as readonly string[]).includes(raw)
  )
    return raw as RsvpStatus;
  const message = `status 는 ${RSVP_STATUSES.join(', ')} 또는 null 이어야 해요`;
  throw new ApiException('VALIDATION_FAILED', message, [
    { field: 'status', message },
  ]);
}

/** 본문 `reaction`. null 은 반응 취소 */
export function parseReactionKind(raw: unknown): ReactionKind | null {
  if (raw === null) return null;
  if (
    typeof raw === 'string' &&
    (REACTION_KINDS as readonly string[]).includes(raw)
  )
    return raw as ReactionKind;
  const message = `reaction 은 ${REACTION_KINDS.join(', ')} 또는 null 이어야 해요`;
  throw new ApiException('VALIDATION_FAILED', message, [
    { field: 'reaction', message },
  ]);
}

/**
 * 참여자 집계. participantIds 는 그 회차의 지금 참여자 (모두면 지금 팀원 전원).
 * 참여자가 아닌 사람의 행은 세지 않는다 (참여자 변경과 나가기에서 지우지만 그 사이 경합에 대비)
 */
export function summarizeRsvp(
  participantIds: readonly number[],
  rows: readonly Pick<RsvpRecord, 'userId' | 'status'>[],
  meId: number,
): RsvpSummary {
  const ids = new Set(participantIds);
  const summary: RsvpSummary = {
    going: 0,
    notGoing: 0,
    maybe: 0,
    pending: 0,
    mine: null,
  };
  let answered = 0;
  for (const row of rows) {
    if (!ids.has(row.userId)) continue;
    answered += 1;
    if (row.status === 'GOING') summary.going += 1;
    else if (row.status === 'NOT_GOING') summary.notGoing += 1;
    else summary.maybe += 1;
    if (row.userId === meId) summary.mine = row.status;
  }
  summary.pending = ids.size - answered;
  return summary;
}

/** 반응 집계. 반응은 팀원 누구나라 memberIds 는 지금 팀원 */
export function summarizeReactions(
  memberIds: readonly number[],
  rows: readonly Pick<ReactionRecord, 'userId' | 'kind'>[],
  meId: number,
): ReactionSummary {
  const ids = new Set(memberIds);
  const summary: ReactionSummary = { LIKE: 0, EXCITED: 0, ACK: 0, mine: null };
  for (const row of rows) {
    if (!ids.has(row.userId)) continue;
    summary[row.kind] += 1;
    if (row.userId === meId) summary.mine = row.kind;
  }
  return summary;
}

/** 응답할 때 본 시각과 지금 회차 시각이 다르면 true (D-226). 같은 순간이면 같다 */
export function isStale(
  row: Pick<RsvpRecord, 'seenStartsAt' | 'seenEndsAt'>,
  startsAt: Date,
  endsAt: Date,
): boolean {
  return (
    row.seenStartsAt.getTime() !== startsAt.getTime() ||
    row.seenEndsAt.getTime() !== endsAt.getTime()
  );
}

/** 단건의 사람별 응답. members 는 참여자 (가입순) */
export function rsvpMembers(
  members: readonly Member[],
  rows: readonly RsvpRecord[],
  startsAt: Date,
  endsAt: Date,
): RsvpMember[] {
  const byUser = new Map(rows.map((row) => [row.userId, row]));
  return members.map((member) => {
    const row = member.userId === null ? undefined : byUser.get(member.userId);
    return row
      ? {
          member,
          status: row.status,
          respondedAt: row.updatedAt,
          stale: isStale(row, startsAt, endsAt),
        }
      : { member, status: null, respondedAt: null, stale: false };
  });
}

/** 단건의 사람별 반응. 지금 팀원만, 가입순 */
export function reactionMembers(
  members: readonly Member[],
  rows: readonly ReactionRecord[],
): ReactionMember[] {
  const byUser = new Map(rows.map((row) => [row.userId, row.kind]));
  const out: ReactionMember[] = [];
  for (const member of members) {
    const kind = member.userId === null ? undefined : byUser.get(member.userId);
    if (kind) out.push({ member, reaction: kind });
  }
  return out;
}

/** (eventId, 회차) 키 */
export const occurrenceKey = (eventId: number, occurrence: string): string =>
  `${eventId}:${occurrence}`;

/** 새 소식 payload (D-227). occurrence 는 반복 회차만, 한 번짜리는 null (일정 기록의 occurrence 와 같은 뜻) */
export interface RsvpActivityPayload {
  eventId: number;
  eventCode: string;
  occurrence: string | null;
  title: string;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  status: RsvpStatus;
}

/** 2분 합치기 대상인지: 같은 일정, 같은 회차의 EVENT_RSVP 기록 */
export function isSameRsvpTarget(
  payload: unknown,
  eventId: number,
  occurrence: string | null,
): boolean {
  if (!payload || typeof payload !== 'object') return false;
  const p = payload as Partial<RsvpActivityPayload>;
  return p.eventId === eventId && (p.occurrence ?? null) === occurrence;
}
