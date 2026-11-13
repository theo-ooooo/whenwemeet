import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { toUserRowOrNull, USER_PUBLIC_SELECT } from '../common/member.js';
import { generatePublicCode } from '../common/public-code.js';
import { assertParticipantsTx, type EventCreateInput, EventsRepository, type EventRow } from '../events/events.repository.js';
import type { ParticipantSet } from '../events/participants.js';
import { FileUrlBuilder } from '../files/file-url.builder.js';
import type { ActivityActor } from '../group-activities/activity.js';
import { GroupActivitiesRepository } from '../group-activities/group-activities.repository.js';
import { Db, PrismaService } from '../prisma/prisma.service.js';
import type { PushPayload } from '../push/push-copy.js';
import { PushRepository } from '../push/push.repository.js';
import type { OptionInput, PollRow } from './poll-rules.js';

const POLL_SELECT = {
  id: true,
  groupId: true,
  publicCode: true,
  title: true,
  status: true,
  deadline: true,
  allMembers: true,
  creatorId: true,
  eventId: true,
  decidedOptionId: true,
  createdAt: true,
  closedAt: true,
  group: { select: { publicCode: true } },
  creator: USER_PUBLIC_SELECT,
  event: { select: { publicCode: true } },
  participants: { select: { userId: true }, orderBy: { userId: 'asc' } },
  options: {
    select: { id: true, startsAt: true, endsAt: true, allDay: true, votes: { select: { userId: true }, orderBy: { userId: 'asc' } } },
    orderBy: [{ startsAt: 'asc' }, { endsAt: 'asc' }],
  },
} as const satisfies Prisma.PollSelect;

type PollRecord = Prisma.PollGetPayload<{ select: typeof POLL_SELECT }>;

export interface PollCreateInput {
  groupId: number;
  title: string;
  deadline: Date | null;
  participants: ParticipantSet;
  options: OptionInput[];
  actor: ActivityActor;
}

/** 정하기 트랜잭션에 넘기는 값. 알림 문구는 일정 코드가 생긴 뒤 만든다 */
export interface PollConfirmInput {
  poll: Pick<PollRow, 'id' | 'groupId' | 'publicCode' | 'title'>;
  option: { id: number; startsAt: Date; endsAt: Date; allDay: boolean };
  event: EventCreateInput;
  actor: ActivityActor;
  push: (eventCode: string) => PushPayload;
  now: Date;
}

class LimitReached extends Error {}

/**
 * (#189) 약속 투표 저장소 (설계 약속-투표.md). 만들기와 정하기는 새 소식 기록, 알림 예약과 한 트랜잭션.
 * 정하기는 일정 생성(EventsRepository.createWithLogInTx)과 같은 트랜잭션에서 OPEN → CLOSED 조건부로 하나만 성공한다
 */
@Injectable()
export class PollsRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly urls: FileUrlBuilder,
    private readonly events: EventsRepository,
    private readonly activities: GroupActivitiesRepository,
    private readonly push: PushRepository,
  ) {}

  /** 진행 중 투표 전부 (상한 10개라 페이지 없음) */
  async listOpen(groupId: number): Promise<PollRow[]> {
    const rows = await this.prisma.poll.findMany({ where: { groupId, status: 'OPEN' }, orderBy: { id: 'desc' }, select: POLL_SELECT });
    return rows.map((row) => this.toRow(row));
  }

  /** since 이후 닫힌 투표, 최근 닫힌 순 */
  async listClosedSince(groupId: number, since: Date): Promise<PollRow[]> {
    const rows = await this.prisma.poll.findMany({
      where: { groupId, status: 'CLOSED', closedAt: { gte: since } },
      orderBy: [{ closedAt: 'desc' }, { id: 'desc' }],
      select: POLL_SELECT,
    });
    return rows.map((row) => this.toRow(row));
  }

  async findByCode(code: string): Promise<PollRow | null> {
    const row = await this.prisma.poll.findUnique({ where: { publicCode: code }, select: POLL_SELECT });
    return row && this.toRow(row);
  }

  /** 다른 팀 투표를 가리키는 번호는 null (D-31) */
  async findInGroup(groupId: number, pollId: number): Promise<PollRow | null> {
    const row = await this.prisma.poll.findFirst({ where: { id: pollId, groupId }, select: POLL_SELECT });
    return row && this.toRow(row);
  }

  /**
   * 만들기. 팀 행을 잠그고(FOR UPDATE) 진행 중 수를 센 뒤 만든다. 이미 limit 개면 null.
   * 대상이 지금 멤버인지(일정 참여자 D-133 규칙), POLL_CREATED 기록, 열림 알림 예약을 같은 트랜잭션에서
   */
  async createWithinLimitTx(input: PollCreateInput, limit: number, push: (pollCode: string) => PushPayload, now: Date): Promise<PollRow | null> {
    try {
      const id = await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM \`Group\` WHERE id = ${input.groupId} FOR UPDATE`;
        if ((await tx.poll.count({ where: { groupId: input.groupId, status: 'OPEN' } })) >= limit) throw new LimitReached();
        await assertParticipantsTx(tx, input.groupId, input.participants);
        const publicCode = generatePublicCode();
        const created = await tx.poll.create({
          data: {
            groupId: input.groupId,
            publicCode,
            title: input.title,
            deadline: input.deadline,
            allMembers: input.participants.allMembers,
            creatorId: input.actor.id,
            participants: { create: input.participants.allMembers ? [] : input.participants.ids.map((userId) => ({ userId })) },
            options: { create: input.options.map(({ startsAt, endsAt, allDay }) => ({ startsAt, endsAt, allDay })) },
          },
          select: { id: true },
        });
        await this.activities.recordTx(tx, { groupId: input.groupId, type: 'POLL_CREATED', actor: input.actor, payload: { pollId: created.id, code: publicCode, title: input.title } });
        await this.push.schedulePollTx(tx, { pollId: created.id, groupId: input.groupId, actorId: input.actor.id, stage: 'OPEN', payload: push(publicCode) }, now);
        return created.id;
      });
      return (await this.findInGroup(input.groupId, id)) as PollRow;
    } catch (error) {
      if (error instanceof LimitReached) return null;
      throw error;
    }
  }

  /** 내 표 바꾸기. remove 는 지우고 add 는 넣는다 (지난 후보는 호출자가 걸렀다) */
  async replaceVotesTx(userId: number, remove: number[], add: number[]): Promise<void> {
    if (remove.length === 0 && add.length === 0) return;
    await this.prisma.$transaction(async (tx) => {
      if (remove.length > 0) await tx.pollVote.deleteMany({ where: { userId, optionId: { in: remove } } });
      if (add.length > 0) await tx.pollVote.createMany({ data: add.map((optionId) => ({ optionId, userId })), skipDuplicates: true });
    });
  }

  /**
   * 정하기 (설계 4장). OPEN → CLOSED 를 조건부로 바꾸고(동시에 누르면 하나만, 나머지 null) 같은 트랜잭션에서
   * 일정 + CREATED 로그, 투표의 eventId, POLL_CLOSED 기록, 정함 알림. 팀원 변경 알림은 만들지 않는다 (D-226)
   */
  async confirmTx(input: PollConfirmInput): Promise<EventRow | null> {
    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.poll.updateMany({
        where: { id: input.poll.id, status: 'OPEN' },
        data: { status: 'CLOSED', closedAt: input.now, decidedOptionId: input.option.id },
      });
      if (count !== 1) return null;
      const { row, logId } = await this.events.createWithLogInTx(tx, input.event, input.actor.id);
      await tx.poll.update({ where: { id: input.poll.id }, data: { eventId: row.id }, select: { id: true } });
      await this.activities.recordTx(tx, {
        groupId: input.poll.groupId,
        type: 'POLL_CLOSED',
        actor: input.actor,
        payload: {
          pollId: input.poll.id,
          code: input.poll.publicCode,
          title: input.poll.title,
          eventId: row.id,
          eventCode: row.publicCode,
          eventLogId: logId,
          startsAt: input.option.startsAt.toISOString(),
          endsAt: input.option.endsAt.toISOString(),
          allDay: input.option.allDay,
        },
      });
      await this.push.schedulePollTx(
        tx,
        { pollId: input.poll.id, groupId: input.poll.groupId, actorId: input.actor.id, stage: 'CLOSED', payload: input.push(row.publicCode) },
        input.now,
      );
      return row;
    });
  }

  /** 진행 중 투표만 지운다(후보, 표, 대상 Cascade). "투표를 열었어요" 기록도 함께. 이미 닫혔거나 없으면 false */
  async deleteOpenTx(groupId: number, pollId: number): Promise<boolean> {
    return this.prisma.$transaction(async (tx: Db) => {
      const { count } = await tx.poll.deleteMany({ where: { id: pollId, groupId, status: 'OPEN' } });
      if (count !== 1) return false;
      await this.activities.deletePollCreatedTx(tx, groupId, pollId);
      return true;
    });
  }

  private toRow(record: PollRecord): PollRow {
    return {
      id: record.id,
      groupId: record.groupId,
      groupCode: record.group.publicCode,
      publicCode: record.publicCode,
      title: record.title,
      status: record.status,
      deadline: record.deadline,
      allMembers: record.allMembers,
      creatorId: record.creatorId,
      creator: toUserRowOrNull(record.creator, this.urls),
      eventId: record.eventId,
      eventCode: record.event?.publicCode ?? null,
      decidedOptionId: record.decidedOptionId,
      createdAt: record.createdAt,
      closedAt: record.closedAt,
      participantIds: record.allMembers ? [] : record.participants.map((row) => row.userId),
      options: record.options.map((option) => ({
        id: option.id,
        startsAt: option.startsAt,
        endsAt: option.endsAt,
        allDay: option.allDay,
        voterIds: option.votes.map((vote) => vote.userId),
      })),
    };
  }
}
