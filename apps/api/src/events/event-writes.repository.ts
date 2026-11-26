import { Injectable } from '@nestjs/common';
import { FileUrlBuilder } from '../files/file-url.builder.js';
import { Db, PrismaService } from '../prisma/prisma.service.js';
import { type CreatedLog, PushNotificationsRepository } from '../push/push-notifications.repository.js';
import { moveOnceResponsesTx, pruneRsvpsTx } from '../event-responses/event-responses.repository.js';
import { kstDate } from './recurrence.js';
import { EVENT_SELECT, type EventRow, toEventRow } from './event-rows.js';
import { assertParticipantsTx, type EventCreateInput, type EventUpdateInput, LOG_REF_SELECT, type SeriesRef, snapshotLog, toCreateData, toUpdateData } from './event-write-data.js';

/** 일정 생성, 수정, 색 바꾸기와 로그, 팀원 변경 알림. events.repository 에서 옮김 (#504) */
@Injectable()
export class EventWritesRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly urls: FileUrlBuilder,
    private readonly push: PushNotificationsRepository,
  ) {}

  /** 일정 생성 + CREATED 로그를 한 트랜잭션으로 */
  createWithLogTx(data: EventCreateInput, actorId: number): Promise<EventRow> {
    return this.prisma.$transaction(async (tx) => {
      const { row, log } = await this.insertWithLogTx(tx, data, actorId);
      await this.push.recordChangeTx(tx, log, false, new Date());
      return row;
    });
  }

  /**
   * (#189) 호출자의 트랜잭션 안에서 일정 생성 + CREATED 로그 (참여자 검사 포함). 팀원 변경 알림은 만들지 않는다.
   * 약속 투표 정하기가 쓴다 (알림은 투표 문구 1건, D-236)
   */
  async createWithLogInTx(tx: Db, data: EventCreateInput, actorId: number): Promise<{ row: EventRow; logId: number }> {
    const { row, log } = await this.insertWithLogTx(tx, data, actorId);
    return { row, logId: log.id };
  }

  private async insertWithLogTx(tx: Db, data: EventCreateInput, actorId: number): Promise<{ row: EventRow; log: CreatedLog }> {
    await assertParticipantsTx(tx, data.groupId, data.participants);
    const created = await tx.event.create({ data: toCreateData(data), select: EVENT_SELECT });
    const log = await tx.eventLog.create({ data: snapshotLog(created, actorId, 'CREATED'), select: LOG_REF_SELECT });
    return { row: toEventRow(created, this.urls), log };
  }

  /** 일정 수정 + UPDATED 로그를 한 트랜잭션으로. 참여자를 바꾸면 그 팀 멤버인지 같이 확인한다 (#248) */
  updateWithLogTx(event: SeriesRef, data: EventUpdateInput, actorId: number): Promise<EventRow> {
    return this.prisma.$transaction(async (tx) => {
      await assertParticipantsTx(tx, event.groupId, data.participants);
      const updated = await tx.event.update({ where: { id: event.id }, data: toUpdateData(data), select: EVENT_SELECT });
      // (#190) 빠진 참여자의 응답 삭제, 한 번짜리의 회차 날짜(= 시작 날짜)를 따라 옮긴다 (반복을 켜도 첫 회차 날짜가 같다)
      if (data.participants) await pruneRsvpsTx(tx, event.id, data.participants);
      await moveOnceResponsesTx(tx, event.id, kstDate(updated.startsAt));
      const log = await tx.eventLog.create({ data: snapshotLog(updated, actorId, 'UPDATED'), select: LOG_REF_SELECT });
      await this.push.recordChangeTx(tx, log, false, new Date());
      return toEventRow(updated, this.urls);
    });
  }

  /**
   * (#343) 색만 바꾼다. 로그, 새 소식, 푸시를 만들지 않는다 (D-215). 반복 원본이면 모든 회차의 색이 바뀐다 (예외는 그대로)
   */
  async updateColor(eventId: number, color: string | null): Promise<EventRow> {
    const updated = await this.prisma.event.update({ where: { id: eventId }, data: { color }, select: EVENT_SELECT });
    return toEventRow(updated, this.urls);
  }

  /**
   * (#566) 보이는 값(색, 음력 입력 표시)만 바꾼다. 색과 같이 로그, 새 소식, 푸시를 만들지 않는다 (D-298). 반복 원본이면 모든 회차
   */
  async updateDisplay(eventId: number, data: { color?: string | null; lunarInput?: boolean }): Promise<EventRow> {
    const updated = await this.prisma.event.update({ where: { id: eventId }, data, select: EVENT_SELECT });
    return toEventRow(updated, this.urls);
  }
}
