import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { PushNotificationsRepository } from '../push/push-notifications.repository.js';
import {
  captureEventTx,
  captureOccurrenceTx,
  finishRestoreTx,
  lockDeletionTx,
  restoreDeletionTx,
  saveDeletionTx,
} from '../event-deletions/event-deletions.repository.js';
import { deleteOccurrenceResponsesTx } from '../event-responses/event-responses.repository.js';
import { placeColumns } from './place.js';
import { dateToDb } from './event-rows.js';
import {
  type EventSnapshot,
  LOG_REF_SELECT,
  type LogSnapshot,
  type ScopeLog,
  scopeLog,
  type SeriesRef,
  snapshotLog,
} from './event-write-data.js';

/** 일정 삭제 (한 번짜리, "이 일정만", 첫 회차 "이후 모두") 와 삭제 되돌리기. events.repository 에서 옮김 (#504) */
@Injectable()
export class EventRemovalsRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly push: PushNotificationsRepository,
  ) {}

  /**
   * 삭제 전 스냅샷으로 DELETED 로그를 남기고 삭제. 로그의 eventId 는 FK SetNull 로 null 이 된다.
   * (#375) 지우기 전 행을 되돌리기 보관에 남기고 그 번호를 돌려준다 (D-251)
   */
  async deleteWithLogTx(
    event: EventSnapshot,
    actorId: number,
  ): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      const snapshot = await captureEventTx(tx, event.id);
      const log = await tx.eventLog.create({
        data: snapshotLog(event, actorId, 'DELETED'),
        select: LOG_REF_SELECT,
      });
      snapshot.push = await this.push.recordChangeTx(tx, log, true, new Date());
      await tx.event.delete({ where: { id: event.id } });
      return saveDeletionTx(tx, {
        groupId: event.groupId,
        eventId: event.id,
        kind: 'EVENT',
        occurrence: null,
        actorId,
        eventLogId: log.id,
        snapshot,
      });
    });
  }

  /** "이 일정만" 삭제: 예외 upsert `cancelled = true` + DELETED THIS 로그. (#375) 되돌리기 보관 번호를 돌려준다 */
  async cancelOccurrenceWithLogTx(
    event: SeriesRef,
    occurrence: string,
    log: ScopeLog,
    snapshot: LogSnapshot,
  ): Promise<number> {
    const cleared = {
      cancelled: true,
      title: null,
      startsAt: null,
      endsAt: null,
      allDay: null,
      memo: null,
      reminder: null,
      reminderSetAt: null,
      ...placeColumns(null),
    };
    return this.prisma.$transaction(async (tx) => {
      const kept = await captureOccurrenceTx(tx, event.id, occurrence);
      await tx.eventException.upsert({
        where: {
          eventId_occurrence: {
            eventId: event.id,
            occurrence: dateToDb(occurrence),
          },
        },
        create: {
          eventId: event.id,
          occurrence: dateToDb(occurrence),
          ...cleared,
        },
        update: cleared,
      });
      // (#190) 없어진 회차의 응답, 반응도 지운다
      await deleteOccurrenceResponsesTx(tx, event.id, occurrence);
      const created = await tx.eventLog.create({
        data: scopeLog(event.groupId, event.id, 'DELETED', log, snapshot),
        select: LOG_REF_SELECT,
      });
      kept.push = await this.push.recordChangeTx(
        tx,
        created,
        false,
        new Date(),
      );
      return saveDeletionTx(tx, {
        groupId: event.groupId,
        eventId: event.id,
        kind: 'OCCURRENCE',
        occurrence,
        actorId: log.actorId,
        eventLogId: created.id,
        snapshot: kept,
      });
    });
  }

  /** 첫 회차 "이후 모두" 삭제: DELETED FOLLOWING 로그 후 원본 삭제 (예외는 cascade, 로그 eventId 는 SetNull). (#375) 되돌리기 보관 번호를 돌려준다 */
  async deleteSeriesWithLogTx(
    event: SeriesRef,
    log: ScopeLog,
    snapshot: LogSnapshot,
  ): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      const kept = await captureEventTx(tx, event.id);
      const created = await tx.eventLog.create({
        data: scopeLog(event.groupId, event.id, 'DELETED', log, snapshot),
        select: LOG_REF_SELECT,
      });
      kept.push = await this.push.recordChangeTx(tx, created, true, new Date());
      await tx.event.delete({ where: { id: event.id } });
      return saveDeletionTx(tx, {
        groupId: event.groupId,
        eventId: event.id,
        kind: 'EVENT',
        occurrence: null,
        actorId: log.actorId,
        eventLogId: created.id,
        snapshot: kept,
      });
    });
  }

  /**
   * (#375) 삭제 되돌리기 (D-251). 보관 행을 잠그고, 지금 상태가 삭제가 남긴 그대로면 되돌린 뒤
   * 팀원 변경 알림 묶음을 거꾸로 하고 DELETED 로그(새 소식)와 보관 행을 지운다
   */
  restoreDeletionTx(
    groupId: number,
    deletionId: number,
    now: Date,
  ): Promise<
    'NOT_FOUND' | 'CONFLICT' | { eventId: number; occurrence: string | null }
  > {
    return this.prisma.$transaction(async (tx) => {
      const deletion = await lockDeletionTx(tx, groupId, deletionId, now);
      if (!deletion) return 'NOT_FOUND';
      const outcome = await restoreDeletionTx(tx, deletion, now);
      if (outcome === 'CONFLICT') return 'CONFLICT';
      if (deletion.snapshot.push && deletion.eventLogId !== null)
        await this.push.revertChangeTx(
          tx,
          deletion.snapshot.push,
          deletion.eventLogId,
          now,
        );
      await finishRestoreTx(tx, deletion);
      return { eventId: deletion.eventId, occurrence: deletion.occurrence };
    });
  }
}
