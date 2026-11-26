import { Injectable } from '@nestjs/common';
import { FileUrlBuilder } from '../files/file-url.builder.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { PushNotificationsRepository } from '../push/push-notifications.repository.js';
import {
  captureFollowingTx,
  saveDeletionTx,
} from '../event-deletions/event-deletions.repository.js';
import {
  deleteAllResponsesTx,
  moveResponsesFromTx,
  pruneRsvpsTx,
} from '../event-responses/event-responses.repository.js';
import { placeColumns } from './place.js';
import { addDays, kstDate } from './recurrence.js';
import {
  dateToDb,
  dbToDate,
  EVENT_SELECT,
  type EventRow,
  participantSetOf,
  toEventRow,
} from './event-rows.js';
import {
  assertParticipantsTx,
  type EventCreateInput,
  type EventUpdateInput,
  type ExceptionFields,
  LOG_REF_SELECT,
  type LogSnapshot,
  RULE_SELECT,
  sameOccurrenceDates,
  type ScopeLog,
  scopeLog,
  type SeriesRef,
  toCreateData,
  toUpdateData,
} from './event-write-data.js';

/** 반복 일정의 "이 일정만", "이후 모두" 수정과 나누기. events.repository 에서 옮김 (#504) */
@Injectable()
export class EventSeriesRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly urls: FileUrlBuilder,
    private readonly push: PushNotificationsRepository,
  ) {}

  /**
   * "이 일정만" 수정: 예외 upsert (fields 가 null 이면 원본과 같아져 예외 행 삭제) + UPDATED THIS 로그.
   * reminderSetAt 은 그 회차의 시각, 종일, 알림이 바뀌었을 때만 (#188, D-86). null 이면 그대로 둔다
   */
  async saveExceptionWithLogTx(
    event: SeriesRef,
    occurrence: string,
    fields: ExceptionFields | null,
    log: ScopeLog,
    snapshot: LogSnapshot,
    reminderSetAt: Date | null = null,
  ): Promise<void> {
    const where = {
      eventId_occurrence: {
        eventId: event.id,
        occurrence: dateToDb(occurrence),
      },
    };
    const setAt = reminderSetAt ? { reminderSetAt } : {};
    // (#199) 장소는 열 세 개로. null 이면 모두 null(원본 장소), 이 회차만 지우면 placeText ''
    const data =
      fields &&
      (({ place, ...rest }) => ({ ...rest, ...placeColumns(place) }))(fields);
    await this.prisma.$transaction(async (tx) => {
      if (data) {
        await tx.eventException.upsert({
          where,
          create: {
            eventId: event.id,
            occurrence: dateToDb(occurrence),
            ...data,
            ...setAt,
          },
          update: { cancelled: false, ...data, ...setAt },
        });
      } else {
        await tx.eventException.deleteMany({
          where: { eventId: event.id, occurrence: dateToDb(occurrence) },
        });
      }
      const created = await tx.eventLog.create({
        data: scopeLog(event.groupId, event.id, 'UPDATED', log, snapshot),
        select: LOG_REF_SELECT,
      });
      await this.push.recordChangeTx(tx, created, false, new Date());
    });
  }

  /** 첫 회차 "이후 모두" 수정: 원본의 예외 전부 삭제 (D-67) + 원본 수정 + UPDATED FOLLOWING 로그 (스냅샷은 수정된 첫 회차) */
  updateSeriesFromStartTx(
    event: SeriesRef,
    data: EventUpdateInput,
    log: ScopeLog,
  ): Promise<EventRow> {
    return this.prisma.$transaction(async (tx) => {
      await assertParticipantsTx(tx, event.groupId, data.participants);
      const before = await tx.event.findUniqueOrThrow({
        where: { id: event.id },
        select: RULE_SELECT,
      });
      await tx.eventException.deleteMany({ where: { eventId: event.id } });
      const updated = await tx.event.update({
        where: { id: event.id },
        data: toUpdateData(data),
        select: EVENT_SELECT,
      });
      // (#190) 회차 날짜가 바뀌면(시작 날짜, 주기, 기준 날짜) 맞는 회차가 없어 응답을 지운다. 같으면 남기고 종료일 뒤 것만 정리 (D-225)
      if (!sameOccurrenceDates(before, updated))
        await deleteAllResponsesTx(tx, event.id);
      else if (updated.repeatUntil)
        await moveResponsesFromTx(
          tx,
          event.id,
          addDays(dbToDate(updated.repeatUntil), 1),
          null,
        );
      if (data.participants)
        await pruneRsvpsTx(tx, event.id, data.participants);
      const snapshot = { ...updated, participants: participantSetOf(updated) };
      const created = await tx.eventLog.create({
        data: scopeLog(updated.groupId, updated.id, 'UPDATED', log, snapshot),
        select: LOG_REF_SELECT,
      });
      await this.push.recordChangeTx(tx, created, false, new Date());
      return toEventRow(updated, this.urls);
    });
  }

  /**
   * (#343) 그 뒤 회차 "이후 모두" 에서 색만 바꿨을 때: splitSeriesTx 와 같이 나누되 로그, 새 소식, 푸시를 만들지 않는다 (D-215).
   * 호출자는 그 회차부터 예외가 없을 때만 부른다 (나눠도 펼친 일정은 색 말고 같다)
   */
  splitSeriesQuietTx(
    event: SeriesRef,
    occurrence: string,
    next: EventCreateInput,
  ): Promise<EventRow> {
    return this.prisma.$transaction(async (tx) => {
      await assertParticipantsTx(tx, next.groupId, next.participants);
      await tx.event.update({
        where: { id: event.id },
        data: { repeatUntil: dateToDb(addDays(occurrence, -1)) },
      });
      await tx.eventException.deleteMany({
        where: { eventId: event.id, occurrence: { gte: dateToDb(occurrence) } },
      });
      const created = await tx.event.create({
        data: toCreateData(next),
        select: EVENT_SELECT,
      });
      // (#190) 색만 바꾼 나눔은 회차 날짜가 같아 응답을 새 원본으로 옮긴다 (D-225)
      await moveResponsesFromTx(tx, event.id, occurrence, created.id);
      return toEventRow(created, this.urls);
    });
  }

  /**
   * 그 뒤 회차 "이후 모두" (D-66, D-67): 원본 `repeatUntil = occurrence - 1일`, occurrence 이후(그날 포함) 예외 삭제.
   * next 가 있으면 새 원본을 만들고 UPDATED FOLLOWING 로그(eventId = 새 원본, 스냅샷 = 새 원본 첫 회차) 를 남겨 새 원본을 돌려준다.
   * next 가 없으면 삭제로 보고 DELETED FOLLOWING 로그(eventId = 원본, 스냅샷 = 그 회차) 만 남기고 되돌리기 보관 번호를 돌려준다 (#375)
   */
  splitSeriesTx(
    event: SeriesRef,
    occurrence: string,
    log: ScopeLog,
    next: EventCreateInput,
  ): Promise<EventRow>;
  splitSeriesTx(
    event: SeriesRef,
    occurrence: string,
    log: ScopeLog,
    next: null,
    snapshot: LogSnapshot,
  ): Promise<number>;
  splitSeriesTx(
    event: SeriesRef,
    occurrence: string,
    log: ScopeLog,
    next: EventCreateInput | null,
    snapshot?: LogSnapshot,
  ): Promise<EventRow | number> {
    return this.prisma.$transaction(async (tx) => {
      if (next) await assertParticipantsTx(tx, next.groupId, next.participants);
      // (#375) 삭제면 당기기 전 종료일, 그 회차 이후 예외, 응답을 되돌리기 보관에 (D-251)
      const kept = next
        ? null
        : await captureFollowingTx(tx, event.id, occurrence);
      const before = await tx.event.findUniqueOrThrow({
        where: { id: event.id },
        select: RULE_SELECT,
      });
      await tx.event.update({
        where: { id: event.id },
        data: { repeatUntil: dateToDb(addDays(occurrence, -1)) },
      });
      await tx.eventException.deleteMany({
        where: { eventId: event.id, occurrence: { gte: dateToDb(occurrence) } },
      });
      if (!next) {
        // (#190) 지운 회차들의 응답, 반응도 지운다
        await moveResponsesFromTx(tx, event.id, occurrence, null);
        const deleted = await tx.eventLog.create({
          data: scopeLog(
            event.groupId,
            event.id,
            'DELETED',
            log,
            snapshot as LogSnapshot,
          ),
          select: LOG_REF_SELECT,
        });
        kept!.push = await this.push.recordChangeTx(
          tx,
          deleted,
          false,
          new Date(),
        );
        return saveDeletionTx(tx, {
          groupId: event.groupId,
          eventId: event.id,
          kind: 'FOLLOWING',
          occurrence,
          actorId: log.actorId,
          eventLogId: deleted.id,
          snapshot: kept!,
        });
      }
      const created = await tx.event.create({
        data: toCreateData(next),
        select: EVENT_SELECT,
      });
      // (#190) 나눈 회차 이후 응답은 새 원본으로 옮긴다. 시작 날짜나 주기가 바뀌어 회차 날짜가 달라지면 지운다 (D-225)
      const keepsDates =
        kstDate(created.startsAt) === occurrence &&
        created.repeat === before.repeat;
      await moveResponsesFromTx(
        tx,
        event.id,
        occurrence,
        keepsDates ? created.id : null,
      );
      if (keepsDates)
        await pruneRsvpsTx(tx, created.id, participantSetOf(created));
      const firstSnapshot = {
        ...created,
        participants: participantSetOf(created),
      };
      const updated = await tx.eventLog.create({
        data: scopeLog(
          created.groupId,
          created.id,
          'UPDATED',
          log,
          firstSnapshot,
        ),
        select: LOG_REF_SELECT,
      });
      await this.push.recordChangeTx(tx, updated, false, new Date());
      return toEventRow(created, this.urls);
    });
  }
}
