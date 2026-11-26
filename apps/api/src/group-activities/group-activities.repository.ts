import { Injectable } from '@nestjs/common';
import {
  toUserRowOrNull,
  USER_PUBLIC_SELECT,
  type UserRow,
} from '../common/member.js';
import { FileUrlBuilder } from '../files/file-url.builder.js';
import { Db, PrismaService } from '../prisma/prisma.service.js';
import type {
  ActivityActor,
  ActivityPayload,
  GroupActivityType,
} from './activity.js';

/** (#515) payload.eventId 로 일정을 가리키는 활동 종류 */
const EVENT_ACTIVITY_TYPES = ['EVENT_RSVP', 'POLL_CLOSED'] as const;

export interface GroupActivityRow {
  id: number;
  type: GroupActivityType;
  actorId: number | null;
  actorName: string;
  anniversaryId: number | null;
  /** DB 의 JSON 그대로. 멤버 3종은 null */
  payload: unknown;
  createdAt: Date;
  actor: UserRow | null;
}

export interface ActivityInput {
  groupId: number;
  type: GroupActivityType;
  actor: ActivityActor;
  anniversaryId?: number | null;
  payload?: ActivityPayload | null;
}

/**
 * (#191) 팀 활동 기록 (D-150). 쓰기는 바뀐 일과 한 트랜잭션이라 각 Repository 의 `...Tx` 가 `recordTx` 를 부른다.
 * 조회 규칙(내 변경 제외, 30일, 50건)은 EventLogsRepository 와 같다
 */
@Injectable()
export class GroupActivitiesRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly urls: FileUrlBuilder,
  ) {}

  async recordTx(db: Db, input: ActivityInput): Promise<void> {
    const payload =
      input.payload && Object.keys(input.payload).length > 0
        ? input.payload
        : undefined;
    await db.groupActivity.create({
      data: {
        groupId: input.groupId,
        type: input.type,
        actorId: input.actor.id,
        actorName: input.actor.name,
        anniversaryId: input.anniversaryId ?? null,
        ...(payload ? { payload: payload as object } : {}),
      },
      select: { id: true },
    });
  }

  /** 같은 사람이 `since` 이후 남긴 기념일 삭제 기록. 최신순 (되돌리기 판정, D-153) */
  listAnniversaryDeletionsTx(
    db: Db,
    groupId: number,
    actorId: number,
    since: Date,
  ): Promise<{ id: number; payload: unknown }[]> {
    return db.groupActivity.findMany({
      where: {
        groupId,
        actorId,
        type: 'ANNIVERSARY_DELETED',
        createdAt: { gte: since },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { id: true, payload: true },
    });
  }

  /** (#190) 같은 사람이 `since` 이후 남긴 참석 여부 기록. 최신순 (2분 합치기, D-227) */
  listRsvpActivitiesTx(
    db: Db,
    groupId: number,
    actorId: number,
    since: Date,
  ): Promise<{ id: number; payload: unknown }[]> {
    return db.groupActivity.findMany({
      where: {
        groupId,
        actorId,
        type: 'EVENT_RSVP',
        createdAt: { gte: since },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { id: true, payload: true },
    });
  }

  /** (#190) 합친 기록을 새 값과 지금 시각으로 고친다 (D-227) */
  async replaceTx(
    db: Db,
    id: number,
    payload: ActivityPayload,
    createdAt: Date,
  ): Promise<void> {
    await db.groupActivity.update({
      where: { id },
      data: { payload: payload as object, createdAt },
      select: { id: true },
    });
  }

  async deleteTx(db: Db, id: number): Promise<void> {
    await db.groupActivity.delete({ where: { id } });
  }

  /** (#189) 취소한 투표의 "투표를 열었어요" 기록을 지운다 (payload.pollId 로 찾는다) */
  async deletePollCreatedTx(
    db: Db,
    groupId: number,
    pollId: number,
  ): Promise<void> {
    await db.groupActivity.deleteMany({
      where: {
        groupId,
        type: 'POLL_CREATED',
        payload: { path: '$.pollId', equals: pollId },
      },
    });
  }

  /**
   * (#189) `after` 이후 남이 정한 투표 수 (내 활동 제외, 탈퇴자 포함). 정하기는 POLL_CLOSED 와 숨겨지는 CREATED 로그를 한 번에 남겨
   * 안 읽은 수에서 하나를 빼는 데 쓴다 (D-236)
   */
  async countUnseenPollClosedByOthers(
    groupId: number,
    after: Date,
    userId: number,
  ): Promise<number> {
    return this.prisma.groupActivity.count({
      where: {
        groupId,
        type: 'POLL_CLOSED',
        createdAt: { gt: after },
        OR: [{ actorId: null }, { actorId: { not: userId } }],
        ...(await this.notHiddenEvent(groupId)),
      },
    });
  }

  /** `after` 이후, 내 활동 제외 (actorId null 인 탈퇴자 기록은 포함). (#515) 숨긴 일정의 참석, 투표 확정 기록은 세지 않는다 */
  async countUnseenByOthers(
    groupId: number,
    after: Date,
    userId: number,
  ): Promise<number> {
    return this.prisma.groupActivity.count({
      where: {
        groupId,
        createdAt: { gt: after },
        OR: [{ actorId: null }, { actorId: { not: userId } }],
        ...(await this.notHiddenEvent(groupId)),
      },
    });
  }

  /**
   * (#515) 관리자가 숨긴 일정을 가리키는 활동(EVENT_RSVP, POLL_CLOSED 의 payload.eventId)을 빼는 조건 (D-286).
   * 활동에는 일정 FK 가 없어 그 팀의 숨긴 일정 번호를 먼저 읽는다. 숨긴 일정이 없으면 조건 없음.
   * payload 가 없는 다른 종류는 JSON 비교가 NULL 이 되므로 종류로 먼저 통과시킨다
   */
  private async notHiddenEvent(groupId: number): Promise<{ AND?: object[] }> {
    const hidden = await this.prisma.event.findMany({
      where: { groupId, hiddenAt: { not: null } },
      select: { id: true },
    });
    if (hidden.length === 0) return {};
    return {
      AND: [
        {
          OR: [
            { type: { notIn: [...EVENT_ACTIVITY_TYPES] } },
            {
              NOT: {
                OR: hidden.map(({ id }) => ({
                  payload: { path: '$.eventId', equals: id },
                })),
              },
            },
          ],
        },
      ],
    };
  }

  /** `since` 이후, 내 활동 제외, 최신순 `limit` 건 */
  async listRecentByOthers(
    groupId: number,
    userId: number,
    since: Date,
    limit: number,
  ): Promise<GroupActivityRow[]> {
    const rows = await this.prisma.groupActivity.findMany({
      where: {
        groupId,
        createdAt: { gte: since },
        OR: [{ actorId: null }, { actorId: { not: userId } }],
        ...(await this.notHiddenEvent(groupId)),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit,
      select: {
        id: true,
        type: true,
        actorId: true,
        actorName: true,
        anniversaryId: true,
        payload: true,
        createdAt: true,
        actor: USER_PUBLIC_SELECT,
      },
    });
    return rows.map((row) => ({
      ...row,
      actor: toUserRowOrNull(row.actor, this.urls),
    }));
  }
}
