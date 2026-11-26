import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import type { ChangeAction } from './coalesce.js';
import type { Platform, PushKindName, PushPayload } from './push-copy.js';
import { asPayload, dbToDate, toJson } from './push-db.js';
import type { Recipient } from './push-recipients.repository.js';

/** 펼칠 차례가 된 예약 */
export interface DueNotification {
  id: number;
  kind: PushKindName;
  /** (#277) WEEKLY 는 여기서 그 주 월요일을 읽는다 */
  dedupeKey: string;
  /** (#528) NOTICE(전체 대상)만 null */
  groupId: number | null;
  scheduledAt: Date;
  /** (#297) 예약을 만든 시각. CHANGE 묶음은 첫 변경, JOIN 은 합류, 가져오기는 가져오기를 마친 시각 */
  createdAt: Date;
  eventId: number | null;
  /** (#190) REMINDER 반복 회차 날짜 'YYYY-MM-DD'. 한 번짜리, 다른 종류는 null */
  occurrence: string | null;
  eventLogId: number | null;
  actorId: number | null;
  changeAction: ChangeAction | null;
  payload: PushPayload | null;
}

/** 보낼 차례가 된 기기별 발송 (SENDING 으로 바꾼 뒤) */
export interface ClaimedDelivery {
  id: number;
  token: string;
  platform: Platform;
  /** 이번 시도를 더한 횟수 */
  attempts: number;
  notification: {
    id: number;
    kind: PushKindName;
    scheduledAt: Date;
    payload: PushPayload | null;
  };
}

export interface ReceiptCandidate {
  id: number;
  ticketId: string;
  token: string;
}

/** 기기별 발송을 만드는 한 번의 INSERT 크기. (#528) 공지처럼 받는 기기가 많아도 문장 하나가 커지지 않게 나눈다 */
export const DELIVERY_INSERT_CHUNK = 1000;

/** 펼치기 상태 전이와 기기별 발송, 영수증 저장소 (#188, #485) */
@Injectable()
export class PushDeliveryRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ---------- 펼치기 (설계 5-6 A) ----------

  /** 예약 시각이 된 PENDING, 예약 시각 순 */
  async listDuePending(now: Date, limit: number): Promise<DueNotification[]> {
    const rows = await this.prisma.pushNotification.findMany({
      where: { status: 'PENDING', scheduledAt: { lte: now } },
      orderBy: [{ scheduledAt: 'asc' }, { id: 'asc' }],
      take: limit,
      select: {
        id: true,
        kind: true,
        dedupeKey: true,
        groupId: true,
        scheduledAt: true,
        createdAt: true,
        eventId: true,
        occurrence: true,
        eventLogId: true,
        actorId: true,
        changeAction: true,
        payload: true,
      },
    });
    return rows.map((row) => ({
      ...row,
      occurrence: row.occurrence === null ? null : dbToDate(row.occurrence),
      payload: asPayload(row.payload),
    }));
  }

  /** PENDING 인 것만 SKIPPED (D-88) */
  async markSkipped(ids: number[]): Promise<number> {
    if (ids.length === 0) return 0;
    const { count } = await this.prisma.pushNotification.updateMany({
      where: { id: { in: ids }, status: 'PENDING' },
      data: { status: 'SKIPPED' },
    });
    return count;
  }

  /** (#277) PENDING 인 것만 CANCELLED (주간 알림을 보내지 않기로 판정) */
  async markCancelled(ids: number[]): Promise<number> {
    if (ids.length === 0) return 0;
    const { count } = await this.prisma.pushNotification.updateMany({
      where: { id: { in: ids }, status: 'PENDING' },
      data: { status: 'CANCELLED' },
    });
    return count;
  }

  /**
   * PENDING → DISPATCHED 가 1행일 때만 기기별 발송(QUEUED)을 만든다 (두 번 펼치지 않음, D-89).
   * payload 를 주면 함께 저장한다. 펼쳤으면 true
   */
  async dispatchTx(
    notificationId: number,
    now: Date,
    payload: PushPayload | null,
    recipients: Recipient[],
  ): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.pushNotification.updateMany({
        where: { id: notificationId, status: 'PENDING' },
        data: {
          status: 'DISPATCHED',
          dispatchedAt: now,
          ...(payload ? { payload: toJson(payload) } : {}),
        },
      });
      if (count !== 1) return false;
      for (let i = 0; i < recipients.length; i += DELIVERY_INSERT_CHUNK) {
        await tx.pushDelivery.createMany({
          data: recipients
            .slice(i, i + DELIVERY_INSERT_CHUNK)
            .map((recipient) => ({ notificationId, ...recipient })),
          skipDuplicates: true,
        });
      }
      return true;
    });
  }

  // ---------- 발송 (설계 5-6 B) ----------

  /** QUEUED 를 최대 limit 개 SENDING 으로 바꾸고 돌려준다 (Expo 에 보내기 직전, 최대 한 번 원칙) */
  async claimQueued(limit: number): Promise<ClaimedDelivery[]> {
    const rows = await this.prisma.pushDelivery.findMany({
      where: { status: 'QUEUED' },
      orderBy: { id: 'asc' },
      take: limit,
      select: {
        id: true,
        token: true,
        platform: true,
        attempts: true,
        notification: {
          select: { id: true, kind: true, scheduledAt: true, payload: true },
        },
      },
    });
    if (rows.length === 0) return [];
    await this.prisma.pushDelivery.updateMany({
      where: { id: { in: rows.map((row) => row.id) }, status: 'QUEUED' },
      data: { status: 'SENDING', attempts: { increment: 1 } },
    });
    return rows.map((row) => ({
      ...row,
      attempts: row.attempts + 1,
      notification: {
        ...row.notification,
        payload: asPayload(row.notification.payload),
      },
    }));
  }

  async markSent(
    sent: { id: number; ticketId: string }[],
    now: Date,
  ): Promise<void> {
    if (sent.length === 0) return;
    await this.prisma.$transaction(
      sent.map(({ id, ticketId }) =>
        this.prisma.pushDelivery.update({
          where: { id },
          data: { status: 'SENT', ticketId, sentAt: now },
          select: { id: true },
        }),
      ),
    );
  }

  async markFailed(ids: number[], error: string): Promise<void> {
    if (ids.length === 0) return;
    await this.prisma.pushDelivery.updateMany({
      where: { id: { in: ids } },
      data: { status: 'FAILED', error },
    });
  }

  async requeue(ids: number[]): Promise<void> {
    if (ids.length === 0) return;
    await this.prisma.pushDelivery.updateMany({
      where: { id: { in: ids } },
      data: { status: 'QUEUED' },
    });
  }

  // ---------- 영수증 (설계 5-7) ----------

  /** 보낸 지 15분 ~ 23시간이고 아직 확인하지 않은 것 */
  async listReceiptCandidates(
    now: Date,
    limit: number,
  ): Promise<ReceiptCandidate[]> {
    const rows = await this.prisma.pushDelivery.findMany({
      where: {
        status: 'SENT',
        receiptCheckedAt: null,
        sentAt: {
          lte: new Date(now.getTime() - 15 * 60 * 1000),
          gte: new Date(now.getTime() - 23 * 60 * 60 * 1000),
        },
      },
      orderBy: { id: 'asc' },
      take: limit,
      select: { id: true, ticketId: true, token: true },
    });
    return rows.filter((row): row is ReceiptCandidate => row.ticketId !== null);
  }

  async saveReceipts(ids: number[], receipt: string, now: Date): Promise<void> {
    if (ids.length === 0) return;
    await this.prisma.pushDelivery.updateMany({
      where: { id: { in: ids } },
      data: { receipt, receiptCheckedAt: now },
    });
  }
}
