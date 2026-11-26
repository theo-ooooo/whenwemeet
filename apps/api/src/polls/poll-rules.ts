// (#189) 약속 투표의 순수 규칙 (설계 약속-투표.md, D-234 ~ D-241). Prisma 를 import 하지 않는다 (단위 테스트 대상)
import { ApiException } from '../common/errors.js';
import type { Member, MemberResolver } from '../common/member.js';
import { KST_OFFSET_MS } from '../events/recurrence.js';
import {
  type ParticipantsView,
  toParticipantsView,
} from '../events/participants.js';

/** 후보 수 (Q7) */
export const MIN_POLL_OPTIONS = 2;
export const MAX_POLL_OPTIONS = 5;
/** 팀당 진행 중 투표 상한 */
export const OPEN_POLL_LIMIT = 10;
/** 닫힌 투표 목록은 최근 30일 */
export const CLOSED_POLL_DAYS = 30;
/** 후보 하나의 길이 상한 (일정과 같은 30일, D-15) */
export const MAX_OPTION_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface OptionInput {
  startsAt: Date;
  endsAt: Date;
  allDay: boolean;
}

export const validationFailed = (field: string, message: string) =>
  new ApiException('VALIDATION_FAILED', message, [{ field, message }]);

/** KST 00:00 인가 */
export function isKstMidnight(instant: Date): boolean {
  return (instant.getTime() + KST_OFFSET_MS) % DAY_MS === 0;
}

/**
 * 후보 검사와 정렬 (시작 순). 2~5개, 끝 > 시작, 30일 이하, 지금 이후 시작, 같은 구간 중복 없음,
 * 종일 후보는 KST 00:00 경계. 어기면 VALIDATION_FAILED (field options)
 */
export function checkOptions(
  options: readonly OptionInput[],
  now: Date,
): OptionInput[] {
  if (options.length < MIN_POLL_OPTIONS || options.length > MAX_POLL_OPTIONS) {
    throw validationFailed(
      'options',
      `후보는 ${MIN_POLL_OPTIONS}~${MAX_POLL_OPTIONS}개 골라 주세요`,
    );
  }
  const seen = new Set<string>();
  for (const option of options) {
    const length = option.endsAt.getTime() - option.startsAt.getTime();
    if (length <= 0)
      throw validationFailed(
        'options',
        '후보의 끝나는 시각은 시작보다 뒤여야 해요',
      );
    if (length > MAX_OPTION_DAYS * DAY_MS)
      throw validationFailed(
        'options',
        `후보는 최대 ${MAX_OPTION_DAYS}일까지 잡을 수 있어요`,
      );
    if (
      option.allDay &&
      !(isKstMidnight(option.startsAt) && isKstMidnight(option.endsAt))
    ) {
      throw validationFailed('options', '종일 후보는 하루 단위여야 해요');
    }
    if (option.startsAt.getTime() <= now.getTime())
      throw validationFailed(
        'options',
        '이미 지난 시간은 후보로 고를 수 없어요',
      );
    const key = `${option.startsAt.getTime()}:${option.endsAt.getTime()}`;
    if (seen.has(key))
      throw validationFailed('options', '같은 시간을 두 번 고를 수 없어요');
    seen.add(key);
  }
  return [...options].sort(
    (a, b) =>
      a.startsAt.getTime() - b.startsAt.getTime() ||
      a.endsAt.getTime() - b.endsAt.getTime(),
  );
}

/** 마감은 지금 이후. null 이면 마감 없음 */
export function checkDeadline(deadline: Date | null, now: Date): void {
  if (deadline && deadline.getTime() <= now.getTime())
    throw validationFailed('deadline', '마감은 지금 이후로 골라 주세요');
}

/** 후보가 지났는가 (시작 시각이 지나면 고를 수도 정할 수도 없다) */
export const isPastOption = (option: { startsAt: Date }, now: Date): boolean =>
  option.startsAt.getTime() <= now.getTime();

/** 마감이 지났는가 (진행 중 투표만. 읽을 때 계산, D-235) */
export const isExpired = (
  poll: { status: 'OPEN' | 'CLOSED'; deadline: Date | null },
  now: Date,
): boolean =>
  poll.status === 'OPEN' &&
  poll.deadline !== null &&
  poll.deadline.getTime() <= now.getTime();

/** 투표 대상인가. "모두" 면 지금 멤버 전원 */
export const isTarget = (
  poll: { allMembers: boolean; participantIds: readonly number[] },
  userId: number,
): boolean => poll.allMembers || poll.participantIds.includes(userId);

/**
 * PUT votes 의 결과 표. 지난 후보의 표는 그대로 둔다 (고칠 수 없는 기록).
 * - 이 투표의 후보가 아닌 id → VALIDATION_FAILED
 * - 지난 후보를 새로 켜면 POLL_OPTION_PAST (이미 켜 둔 지난 후보를 다시 보내는 것은 괜찮다)
 * 돌려주는 값: 지울 후보 id(앞으로 올 후보 중 빠진 것), 새로 넣을 후보 id
 */
export function planVotes(
  options: readonly { id: number; startsAt: Date }[],
  current: readonly number[],
  requested: readonly number[],
  now: Date,
): { remove: number[]; add: number[] } {
  const byId = new Map(options.map((option) => [option.id, option]));
  const want = new Set(requested);
  const have = new Set(current);
  for (const id of want) {
    const option = byId.get(id);
    if (!option)
      throw validationFailed('optionIds', '이 투표의 후보가 아니에요');
    if (isPastOption(option, now) && !have.has(id))
      throw new ApiException('POLL_OPTION_PAST');
  }
  const remove = [...have]
    .filter(
      (id) =>
        !want.has(id) && byId.has(id) && !isPastOption(byId.get(id)!, now),
    )
    .sort((a, b) => a - b);
  const add = [...want].filter((id) => !have.has(id)).sort((a, b) => a - b);
  return { remove, add };
}

/** 저장소가 읽어 주는 투표 한 건 */
export interface PollRow {
  id: number;
  groupId: number;
  groupCode: string;
  publicCode: string;
  title: string;
  status: 'OPEN' | 'CLOSED';
  deadline: Date | null;
  allMembers: boolean;
  creatorId: number | null;
  creator: { nickname: string; profileImageUrl: string | null } | null;
  eventId: number | null;
  eventCode: string | null;
  decidedOptionId: number | null;
  createdAt: Date;
  closedAt: Date | null;
  /** allMembers = false 일 때의 대상, 오름차순 */
  participantIds: number[];
  /** 시작 순 */
  options: {
    id: number;
    startsAt: Date;
    endsAt: Date;
    allDay: boolean;
    voterIds: number[];
  }[];
}

export interface PollOptionView {
  id: number;
  startsAt: Date;
  endsAt: Date;
  allDay: boolean;
  /** 시작이 지났다 (고를 수도 정할 수도 없다) */
  past: boolean;
  /** 가능이라고 한 사람, 가입순 */
  voters: Member[];
}

/** api.md 2.13 Poll */
export interface PollView {
  id: number;
  publicCode: string;
  groupId: number;
  groupCode: string;
  title: string;
  status: 'OPEN' | 'CLOSED';
  deadline: Date | null;
  expired: boolean;
  creator: Member;
  createdAt: Date;
  closedAt: Date | null;
  /** 정해서 생긴 일정. 지워졌으면 null */
  eventId: number | null;
  eventCode: string | null;
  decidedOptionId: number | null;
  participants: ParticipantsView;
  options: PollOptionView[];
  /** 내가 가능이라고 한 후보 */
  myVotes: number[];
  /** 내가 투표 대상인가 */
  canVote: boolean;
}

/** api.md 2.13 PollSummary (홈 "정하는 중" 카드) */
export interface PollSummaryView {
  id: number;
  publicCode: string;
  title: string;
  status: 'OPEN' | 'CLOSED';
  deadline: Date | null;
  expired: boolean;
  eventId: number | null;
  eventCode: string | null;
  /** 한 후보라도 가능이라고 한 대상 수 */
  voterCount: number;
  /** 투표 대상 수 */
  targetCount: number;
  votedByMe: boolean;
  /** 모든 후보가 지났다 ("지난 투표" 로 접는다) */
  allPast: boolean;
  createdAt: Date;
  closedAt: Date | null;
}

/** 대상 userId. "모두" 면 지금 멤버 전원 */
export function targetIds(
  row: Pick<PollRow, 'allMembers' | 'participantIds'>,
  resolver: MemberResolver,
): number[] {
  const members = resolver
    .all()
    .flatMap((member) => (member.userId === null ? [] : [member.userId]));
  if (row.allMembers) return members;
  const ids = new Set(row.participantIds);
  return members.filter((id) => ids.has(id));
}

export function toPollView(
  row: PollRow,
  resolver: MemberResolver,
  userId: number,
  now: Date,
): PollView {
  const order = resolver.all();
  const votersOf = (ids: readonly number[]) => {
    const set = new Set(ids);
    return order.filter(
      (member) => member.userId !== null && set.has(member.userId),
    );
  };
  return {
    id: row.id,
    publicCode: row.publicCode,
    groupId: row.groupId,
    groupCode: row.groupCode,
    title: row.title,
    status: row.status,
    deadline: row.deadline,
    expired: isExpired(row, now),
    creator: resolver.resolve(row.creatorId, row.creator),
    createdAt: row.createdAt,
    closedAt: row.closedAt,
    eventId: row.eventId,
    eventCode: row.eventCode,
    decidedOptionId: row.decidedOptionId,
    participants: toParticipantsView(row, resolver),
    options: row.options.map((option) => ({
      id: option.id,
      startsAt: option.startsAt,
      endsAt: option.endsAt,
      allDay: option.allDay,
      past: isPastOption(option, now),
      voters: votersOf(option.voterIds),
    })),
    myVotes: row.options
      .filter((option) => option.voterIds.includes(userId))
      .map((option) => option.id),
    canVote: isTarget(row, userId),
  };
}

export function toPollSummary(
  row: PollRow,
  resolver: MemberResolver,
  userId: number,
  now: Date,
): PollSummaryView {
  const targets = new Set(targetIds(row, resolver));
  const voters = new Set(
    row.options
      .flatMap((option) => option.voterIds)
      .filter((id) => targets.has(id)),
  );
  return {
    id: row.id,
    publicCode: row.publicCode,
    title: row.title,
    status: row.status,
    deadline: row.deadline,
    expired: isExpired(row, now),
    eventId: row.eventId,
    eventCode: row.eventCode,
    voterCount: voters.size,
    targetCount: targets.size,
    votedByMe: row.options.some((option) => option.voterIds.includes(userId)),
    allPast: row.options.every((option) => isPastOption(option, now)),
    createdAt: row.createdAt,
    closedAt: row.closedAt,
  };
}

/**
 * 진행 중 목록 순서: 아직 고를 후보가 있는 것 먼저, 그 안에서 마감 가까운 순(마감 없음은 뒤), 같으면 최근에 연 것.
 * 모든 후보가 지난 것("지난 투표")은 맨 뒤
 */
export function sortOpenSummaries(items: PollSummaryView[]): PollSummaryView[] {
  const deadlineOf = (item: PollSummaryView) =>
    item.deadline?.getTime() ?? Number.POSITIVE_INFINITY;
  return [...items].sort(
    (a, b) =>
      Number(a.allPast) - Number(b.allPast) ||
      deadlineOf(a) - deadlineOf(b) ||
      b.createdAt.getTime() - a.createdAt.getTime() ||
      b.id - a.id,
  );
}
