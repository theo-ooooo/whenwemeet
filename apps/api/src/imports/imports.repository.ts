import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { generatePublicCode } from '../common/public-code.js';
import { dateToDb } from '../events/event-rows.js';
import { assertParticipantsTx } from '../events/event-write-data.js';
import type { ParticipantSet } from '../events/participants.js';
import type { ActivityActor } from '../group-activities/activity.js';
import { GroupActivitiesRepository } from '../group-activities/group-activities.repository.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { PushPayload } from '../push/push-copy.js';
import { PushNotificationsRepository } from '../push/push-notifications.repository.js';
import type { PlannedEvent } from './import-plan.js';

/** IN 절 하나에 넣는 해시 수 */
const HASH_CHUNK = 1000;

/**
 * (#279) ICS 가져오기 (설계 `일정-가져오기.md` 4장, D-165, D-166). 일정은 EventLog 없이 넣고(새 소식, 2분 묶음 푸시를 거치지 않음)
 * 끝나면 GroupActivity 한 줄과 팀원 변경 푸시 한 건만 남긴다
 */
@Injectable()
export class ImportsRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activities: GroupActivitiesRepository,
    private readonly push: PushNotificationsRepository,
  ) {}

  async findGroup(groupId: number): Promise<{
    type: 'PERSONAL' | 'TEAM';
    name: string;
    publicCode: string;
  } | null> {
    return this.prisma.group.findUnique({
      where: { id: groupId },
      select: { type: true, name: true, publicCode: true },
    });
  }

  /** 이 팀에 이미 가져온 해시 (일정을 지웠어도 남는다, 기획 Q5) */
  async findImportedHashes(
    groupId: number,
    hashes: string[],
  ): Promise<Set<string>> {
    const found = new Set<string>();
    for (let i = 0; i < hashes.length; i += HASH_CHUNK) {
      const rows = await this.prisma.eventImportItem.findMany({
        where: { groupId, uidHash: { in: hashes.slice(i, i + HASH_CHUNK) } },
        select: { uidHash: true },
      });
      for (const row of rows) found.add(row.uidHash);
    }
    return found;
  }

  async startImport(groupId: number, userId: number): Promise<number> {
    const row = await this.prisma.eventImport.create({
      data: { groupId, userId },
      select: { id: true },
    });
    return row.id;
  }

  /**
   * 일정 한 묶음(최대 200)을 한 트랜잭션으로: 일정 + 회차 예외 + 참여자 + 가져온 키. 알림은 모두 NONE.
   * 같은 (팀, 해시) 가 이미 있으면(동시에 두 번 올림) 유일 제약으로 묶음 전체가 롤백된다. 넣은 수
   */
  async insertBatchTx(
    importId: number,
    groupId: number,
    creatorId: number,
    participants: ParticipantSet,
    events: PlannedEvent[],
  ): Promise<number> {
    if (events.length === 0) return 0;
    return this.prisma.$transaction(async (tx) => {
      await assertParticipantsTx(tx, groupId, participants);
      const reminderSetAt = new Date();
      const items: {
        importId: number;
        groupId: number;
        uidHash: string;
        eventId: number;
      }[] = [];
      for (const event of events) {
        const created = await tx.event.create({
          data: {
            groupId,
            publicCode: generatePublicCode(),
            title: event.title,
            startsAt: event.startsAt,
            endsAt: event.endsAt,
            allDay: event.allDay,
            memo: event.memo,
            creatorId,
            repeat: event.repeat,
            repeatUntil:
              event.repeatUntil === null ? null : dateToDb(event.repeatUntil),
            reminder: 'NONE',
            remindAt: null,
            reminderSetAt,
            allMembers: participants.allMembers,
            participants: {
              create: participants.allMembers
                ? []
                : participants.ids.map((userId) => ({ userId })),
            },
            exceptions: {
              create: event.exceptions.map((exception) => ({
                occurrence: dateToDb(exception.occurrence),
                cancelled: exception.cancelled,
                title: exception.title,
                startsAt: exception.startsAt,
                endsAt: exception.endsAt,
                allDay: exception.allDay,
                memo: exception.memo,
              })),
            },
          },
          select: { id: true },
        });
        items.push({
          importId,
          groupId,
          uidHash: event.uidHash,
          eventId: created.id,
        });
      }
      await tx.eventImportItem.createMany({ data: items });
      await tx.eventImport.update({
        where: { id: importId },
        data: { created: { increment: items.length } },
        select: { id: true },
      });
      return items.length;
    });
  }

  /**
   * 가져오기를 마친다: 넣은 게 있으면 새 소식 한 줄(EVENTS_IMPORTED) + 팀원 변경 푸시 한 건 (D-166).
   * done 이면 doneAt 을 채운다 (중간 실패 후 넣은 만큼 알릴 때는 비워 둔다)
   */
  async finishTx(input: {
    importId: number;
    groupId: number;
    actor: ActivityActor;
    count: number;
    push: PushPayload | null;
    done: boolean;
  }): Promise<void> {
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      if (input.done)
        await tx.eventImport.update({
          where: { id: input.importId },
          data: { doneAt: now },
          select: { id: true },
        });
      if (input.count === 0) return;
      await this.activities.recordTx(tx, {
        groupId: input.groupId,
        type: 'EVENTS_IMPORTED',
        actor: input.actor,
        payload: { count: input.count },
      });
      if (input.push)
        await this.push.scheduleImportTx(
          tx,
          {
            importId: input.importId,
            groupId: input.groupId,
            actorId: input.actor.id,
            payload: input.push,
          },
          now,
        );
    });
  }
}

/** 동시에 같은 파일을 넣어 (팀, 해시) 유일 제약에 걸렸는지 */
export function isDuplicateItemError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}
