import { Injectable } from '@nestjs/common';
import { ApiException } from '../common/errors.js';
import { parsePublicCode } from '../common/public-code.js';
import { parseIsoDate } from '../common/validation.js';
import {
  resolveParticipants,
  parseParticipants,
} from '../events/participants.js';
import { type EventView, toEventView } from '../events/event-view.js';
import { FreeSlotsService } from '../free-slots/free-slots.service.js';
import {
  type ActivityActor,
  snapshotName,
} from '../group-activities/activity.js';
import { GroupsRepository } from '../groups/groups.repository.js';
import { MembershipService } from '../groups/membership.service.js';
import { pollClosedPayload, pollOpenedPayload } from '../push/push-copy.js';
import type {
  PollConfirmDto,
  PollInputDto,
  PollVotesDto,
} from './dto/poll.dto.js';
import {
  checkDeadline,
  checkOptions,
  CLOSED_POLL_DAYS,
  isExpired,
  isPastOption,
  isTarget,
  OPEN_POLL_LIMIT,
  planVotes,
  type PollRow,
  type PollSummaryView,
  type PollView,
  sortOpenSummaries,
  targetIds,
  toPollSummary,
  toPollView,
  validationFailed,
} from './poll-rules.js';
import { PollsRepository } from './polls.repository.js';

const DAY_MS = 24 * 60 * 60 * 1000;

const POLL_NOT_FOUND = () =>
  new ApiException('NOT_FOUND', '투표를 찾을 수 없어요');
const PERSONAL_POLL = () =>
  validationFailed('groupId', '혼자 쓰는 달력에서는 투표를 열 수 없어요');
const TOO_MANY_OPEN = () =>
  validationFailed('groupId', '진행 중인 투표가 너무 많아요');
const CLOSED = () => new ApiException('POLL_CLOSED');
const EXPIRED = () => new ApiException('POLL_CLOSED', '투표가 끝났어요');

/** 정하기 응답. 지금 그 시간에 바쁜 대상이 생겼으면 warning 'BUSY_NOW' (정하기는 그대로 진행, 설계 4장) */
export interface PollConfirmView {
  poll: PollView;
  event: EventView;
  warning: 'BUSY_NOW' | null;
}

/**
 * (#189) 약속 투표 (설계 약속-투표.md, D-234 ~ D-241). 팀원 누구나 열고 정하고 취소한다 (D-18, Q2).
 * 표는 투표 대상만, 지난 후보는 고를 수도 정할 수도 없다. 마감이 지나면 표를 받지 않지만 정하기는 된다
 */
@Injectable()
export class PollsService {
  constructor(
    private readonly polls: PollsRepository,
    private readonly memberships: MembershipService,
    private readonly groups: GroupsRepository,
    private readonly freeSlots: FreeSlotsService,
  ) {}

  /** 진행 중(기본)은 정렬 규칙대로, 닫힌 것은 최근 30일 */
  async list(
    userId: number,
    groupId: number,
    status: 'open' | 'closed' = 'open',
    now: Date = new Date(),
  ): Promise<PollSummaryView[]> {
    await this.memberships.assertMember(userId, groupId);
    const rows =
      status === 'closed'
        ? await this.polls.listClosedSince(
            groupId,
            new Date(now.getTime() - CLOSED_POLL_DAYS * DAY_MS),
          )
        : await this.polls.listOpen(groupId);
    const resolver = await this.memberships.resolverFor(groupId);
    const items = rows.map((row) => toPollSummary(row, resolver, userId, now));
    return status === 'closed' ? items : sortOpenSummaries(items);
  }

  async create(
    userId: number,
    groupId: number,
    dto: PollInputDto,
    now: Date = new Date(),
  ): Promise<PollView> {
    const me = await this.memberships.assertMember(userId, groupId);
    const group = await this.groups.findById(groupId);
    if (!group) throw POLL_NOT_FOUND();
    if (group.type === 'PERSONAL') throw PERSONAL_POLL();
    const options = checkOptions(
      dto.options.map((option, index) => ({
        startsAt: parseIsoDate(option.startsAt, `options.${index}.startsAt`),
        endsAt: parseIsoDate(option.endsAt, `options.${index}.endsAt`),
        allDay: option.allDay,
      })),
      now,
    );
    const deadline = dto.deadline
      ? parseIsoDate(dto.deadline, 'deadline')
      : null;
    checkDeadline(deadline, now);
    // 생략하면 "모두" (일정과 다르다, 설계 3장). 멤버 검사는 저장 트랜잭션 안에서 (D-133)
    // (#444) "모두" 도 지금 멤버 id 목록으로 저장한다 (D-263)
    const input = parseParticipants(dto.participants) ?? 'ALL';
    const resolver = await this.memberships.resolverFor(groupId);
    const participants = resolveParticipants(
      input,
      null,
      userId,
      true,
      resolver.userIds(),
    );
    const actor = actorOf(userId, me);

    const row = await this.polls.createWithinLimitTx(
      { groupId, title: dto.title, deadline, participants, options, actor },
      OPEN_POLL_LIMIT,
      (pollCode) =>
        pollOpenedPayload(
          {
            groupName: group.name,
            groupCode: group.publicCode,
            pollCode,
            title: dto.title,
            actorName: actor.name,
            optionCount: options.length,
            deadline,
          },
          now,
        ),
      now,
    );
    if (!row) throw TOO_MANY_OPEN();
    return toPollView(row, resolver, userId, now);
  }

  /** 공개 코드로 하나. 틀린 코드, 없는 투표, 비멤버를 가리지 않고 404 (D-206 과 같은 규칙) */
  async getByCode(
    userId: number,
    codeRaw: unknown,
    now: Date = new Date(),
  ): Promise<PollView> {
    const code = parsePublicCode(codeRaw);
    const row = code === null ? null : await this.polls.findByCode(code);
    if (!row || !(await this.memberships.isMember(userId, row.groupId)))
      throw POLL_NOT_FOUND();
    return toPollView(
      row,
      await this.memberships.resolverFor(row.groupId),
      userId,
      now,
    );
  }

  /** 내가 가능한 후보 전체로 바꾼다 (빈 배열 = 다 해제) */
  async vote(
    userId: number,
    groupId: number,
    pollId: number,
    dto: PollVotesDto,
    now: Date = new Date(),
  ): Promise<PollView> {
    await this.memberships.assertMember(userId, groupId);
    const poll = await this.findInGroup(groupId, pollId);
    if (poll.status === 'CLOSED') throw CLOSED();
    if (isExpired(poll, now)) throw EXPIRED();
    if (!isTarget(poll, userId))
      throw new ApiException('NOT_PARTICIPANT', '이 투표의 대상이 아니에요');
    const current = poll.options
      .filter((option) => option.voterIds.includes(userId))
      .map((option) => option.id);
    const { remove, add } = planVotes(
      poll.options,
      current,
      dto.optionIds,
      now,
    );
    await this.polls.replaceVotesTx(userId, remove, add);
    return this.view(groupId, pollId, userId, now);
  }

  /**
   * 후보 하나로 정한다 (설계 4장). 한 트랜잭션에서 일정 생성(제목, 후보 시각, 참여자 = 투표 대상 설정, 알림 없음) + CLOSED.
   * 정하기 직전 대상 중 누가 그 시간에 바빠졌으면 warning 'BUSY_NOW' 만 싣는다 (종일 후보는 보지 않는다)
   */
  async confirm(
    userId: number,
    groupId: number,
    pollId: number,
    dto: PollConfirmDto,
    now: Date = new Date(),
  ): Promise<PollConfirmView> {
    const me = await this.memberships.assertMember(userId, groupId);
    const poll = await this.findInGroup(groupId, pollId);
    if (poll.status === 'CLOSED') throw CLOSED();
    const option = poll.options.find(
      (candidate) => candidate.id === dto.optionId,
    );
    if (!option)
      throw validationFailed('optionId', '이 투표의 후보가 아니에요');
    if (isPastOption(option, now)) throw new ApiException('POLL_OPTION_PAST');

    const group = await this.groups.findById(groupId);
    if (!group) throw POLL_NOT_FOUND();
    const resolver = await this.memberships.resolverFor(groupId);
    const busy = option.allDay
      ? false
      : await this.freeSlots.anyBusy(
          targetIds(poll, resolver),
          option.startsAt,
          option.endsAt,
        );
    const actor = actorOf(userId, me);
    const event = await this.polls.confirmTx({
      poll,
      option,
      actor,
      now,
      event: {
        groupId,
        title: poll.title,
        startsAt: option.startsAt,
        endsAt: option.endsAt,
        allDay: option.allDay,
        memo: null,
        creatorId: userId,
        reminder: 'NONE',
        remindAt: null,
        reminderSetAt: now,
        // (#444) 대상이 "모두"(옛 투표)여도 정하는 시각 멤버 id 목록으로 (D-263)
        participants: { allMembers: false, ids: targetIds(poll, resolver) },
      },
      push: (eventCode) =>
        pollClosedPayload(
          {
            groupName: group.name,
            groupCode: group.publicCode,
            pollCode: poll.publicCode,
            title: poll.title,
            actorName: actor.name,
            eventCode,
            option,
          },
          now,
        ),
    });
    if (!event) throw CLOSED();
    return {
      poll: await this.view(groupId, pollId, userId, now),
      event: toEventView(event, resolver),
      warning: busy ? 'BUSY_NOW' : null,
    };
  }

  /** 취소. 진행 중 투표만 지운다 (기록은 남기지 않는다). 이미 정했으면 POLL_CLOSED */
  async remove(
    userId: number,
    groupId: number,
    pollId: number,
  ): Promise<{ ok: true }> {
    await this.memberships.assertMember(userId, groupId);
    const poll = await this.findInGroup(groupId, pollId);
    if (
      poll.status === 'CLOSED' ||
      !(await this.polls.deleteOpenTx(groupId, pollId))
    )
      throw CLOSED();
    return { ok: true };
  }

  private async findInGroup(groupId: number, pollId: number): Promise<PollRow> {
    const row = await this.polls.findInGroup(groupId, pollId);
    if (!row) throw POLL_NOT_FOUND();
    return row;
  }

  private async view(
    groupId: number,
    pollId: number,
    userId: number,
    now: Date,
  ): Promise<PollView> {
    const row = await this.findInGroup(groupId, pollId);
    return toPollView(
      row,
      await this.memberships.resolverFor(groupId),
      userId,
      now,
    );
  }
}

function actorOf(
  userId: number,
  me: { displayName: string | null; user: { nickname: string } },
): ActivityActor {
  return { id: userId, name: snapshotName(me.displayName, me.user.nickname) };
}
