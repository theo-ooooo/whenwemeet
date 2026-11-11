import { Injectable, Logger } from '@nestjs/common';
import { EXPO_RECEIPT_CHUNK, EXPO_SEND_CHUNK, ExpoPushClient } from './expo-push.client.js';
import { changePayload, DELETED_MEMBER_NAME, joinPayload, toExpoMessage, type PushPayload } from './push-copy.js';
import { type ClaimedDelivery, type DueNotification, PushRepository } from './push.repository.js';

/** 예약 시각이 이만큼 넘게 지난 알림은 보내지 않는다 (D-88) */
export const CATCH_UP_MS = 10 * 60 * 1000;
/** 한 틱에 펼치는 예약 수 */
export const EXPAND_LIMIT = 500;
/** 한 틱에 보내는 기기별 발송 수 */
export const SEND_LIMIT = 1000;
/** 다시 보내는 시도 상한 */
export const MAX_ATTEMPTS = 3;

/** 기기 삭제 대상 Expo 오류 */
const DEVICE_GONE = 'DeviceNotRegistered';
/** 다음 틱에 다시 보내는 티켓 오류 */
const RETRY_TICKET = 'MessageRateExceeded';
/** 자격 증명 문제. error 로그 push.credentials */
const CREDENTIAL_ERRORS = new Set(['InvalidCredentials', 'MismatchSenderId']);

export interface ExpandStats {
  dispatched: number;
  skipped: number;
  deliveries: number;
}

export interface SendStats {
  sent: number;
  failed: Record<string, number>;
  requeued: number;
}

/** 토큰은 로그에 앞 12자만 (설계 10-2) */
export const tokenPrefix = (token: string) => token.slice(0, 12);

/** 펼치기와 발송, 영수증 (설계 5-6, 5-7) */
@Injectable()
export class PushDispatcher {
  private readonly logger = new Logger('Push');

  constructor(
    private readonly push: PushRepository,
    private readonly expo: ExpoPushClient,
  ) {}

  /** A. 예약 시각이 된 PENDING 을 받을 기기로 펼친다. 10분 넘게 늦은 것은 SKIPPED */
  async expandDue(now: Date): Promise<ExpandStats> {
    const stats: ExpandStats = { dispatched: 0, skipped: 0, deliveries: 0 };
    const due = await this.push.listDuePending(now, EXPAND_LIMIT);
    const late = due.filter((row) => row.scheduledAt.getTime() < now.getTime() - CATCH_UP_MS);
    stats.skipped += await this.push.markSkipped(late.map((row) => row.id));

    for (const row of due) {
      if (row.scheduledAt.getTime() < now.getTime() - CATCH_UP_MS) continue;
      const payload = await this.payloadFor(row, now);
      if (!payload) {
        stats.skipped += await this.push.markSkipped([row.id]);
        continue;
      }
      // (#248) 일정 알림은 그 일정의 참여자에게만 (D-138)
      const recipients = await this.push.listRecipients(
        row.groupId,
        row.kind,
        row.kind === 'CHANGE' || row.kind === 'JOIN' ? row.actorId : null,
        row.kind === 'REMINDER' ? row.eventId : null,
      );
      if (await this.push.dispatchTx(row.id, now, row.payload ? null : payload, recipients)) {
        stats.dispatched += 1;
        stats.deliveries += recipients.length;
      }
    }
    return stats;
  }

  /** B. QUEUED 를 SENDING 으로 바꿔 100개씩 Expo 로 (최대 한 번, D-89) */
  async sendQueued(now: Date): Promise<SendStats> {
    const stats: SendStats = { sent: 0, failed: {}, requeued: 0 };
    const claimed = await this.push.claimQueued(SEND_LIMIT);
    for (let i = 0; i < claimed.length; i += EXPO_SEND_CHUNK) {
      await this.sendChunk(claimed.slice(i, i + EXPO_SEND_CHUNK), now, stats);
    }
    return stats;
  }

  /** 보낸 지 15분 지난 티켓의 영수증 (설계 5-7). 확인한 수 */
  async checkReceipts(now: Date): Promise<number> {
    const candidates = await this.push.listReceiptCandidates(now, EXPO_RECEIPT_CHUNK);
    if (candidates.length === 0) return 0;
    const receipts = await this.expo.getReceipts(candidates.map((row) => row.ticketId));
    if (!receipts) return 0;
    const byReceipt = new Map<string, number[]>();
    const goneTokens: string[] = [];
    for (const row of candidates) {
      const receipt = receipts.get(row.ticketId) ?? 'missing';
      byReceipt.set(receipt, [...(byReceipt.get(receipt) ?? []), row.id]);
      if (receipt === DEVICE_GONE) goneTokens.push(row.token);
    }
    for (const [receipt, ids] of byReceipt) await this.push.saveReceipts(ids, receipt, now);
    await this.push.deleteDevicesByTokens(goneTokens);
    return candidates.length;
  }

  /** 펼칠 때의 문구. REMINDER, ANNIVERSARY 는 예약 때 만든 값. 대상이 사라졌으면 null (SKIPPED) */
  private async payloadFor(row: DueNotification, now: Date): Promise<PushPayload | null> {
    if (row.kind === 'REMINDER') {
      // 원본이 사라졌으면 보내지 않는다 (예약과 펼치기가 같은 틱이라 드묾)
      if (row.eventId === null || !(await this.push.eventExists(row.eventId))) return null;
      return row.payload;
    }
    if (row.kind === 'ANNIVERSARY') return row.payload;

    const groupName = await this.push.findGroupName(row.groupId);
    if (groupName === null) return null;
    const actorName = row.actorId === null ? DELETED_MEMBER_NAME : ((await this.push.findPersonName(row.groupId, row.actorId)) ?? DELETED_MEMBER_NAME);
    if (row.kind === 'JOIN') return joinPayload(row.groupId, groupName, actorName, now);

    // CHANGE: 묶음이 가리키는 로그 스냅샷 (원본이 지워졌어도 로그는 남는다)
    if (row.eventLogId === null || row.changeAction === null) return null;
    const log = await this.push.findChangeLog(row.eventLogId);
    if (!log) return null;
    return changePayload({ groupId: row.groupId, groupName, actorName, action: row.changeAction, eventId: row.eventId, log }, now);
  }

  private async sendChunk(chunk: ClaimedDelivery[], now: Date, stats: SendStats): Promise<void> {
    const sendable = chunk.filter((row) => row.notification.payload !== null);
    const broken = chunk.filter((row) => row.notification.payload === null);
    await this.fail(broken.map((row) => row.id), 'NO_PAYLOAD', stats);
    if (sendable.length === 0) return;

    const messages = sendable.map((row) =>
      toExpoMessage(row.notification.kind, row.notification.id, row.notification.payload as PushPayload, row, now),
    );
    const result = await this.expo.send(messages);
    if (result.type === 'retry') {
      await this.requeueOrExpire(sendable, now, stats);
      return;
    }
    if (result.type === 'unknown') {
      // 접수됐을 수 있어 다시 보내지 않는다 (D-89)
      this.logger.warn(`push.send ${result.reason} (${sendable.length}건)`);
      await this.fail(sendable.map((row) => row.id), 'TIMEOUT', stats);
      return;
    }
    if (result.type === 'rejected') {
      this.logger.error(`push.send 거절 ${result.code} (${sendable.length}건)`);
      await this.fail(sendable.map((row) => row.id), result.code, stats);
      return;
    }

    const sent: { id: number; ticketId: string }[] = [];
    const retry: ClaimedDelivery[] = [];
    const failed = new Map<string, number[]>();
    const goneTokens: string[] = [];
    result.tickets.forEach((ticket, index) => {
      const row = sendable[index];
      if (ticket.status === 'ok') {
        sent.push({ id: row.id, ticketId: ticket.id });
        return;
      }
      if (ticket.code === RETRY_TICKET) {
        retry.push(row);
        return;
      }
      if (ticket.code === DEVICE_GONE) goneTokens.push(row.token);
      if (CREDENTIAL_ERRORS.has(ticket.code)) this.logger.error(`push.credentials ${ticket.code} ${row.platform} ${tokenPrefix(row.token)}`);
      failed.set(ticket.code, [...(failed.get(ticket.code) ?? []), row.id]);
    });
    await this.push.markSent(sent, now);
    stats.sent += sent.length;
    for (const [code, ids] of failed) await this.fail(ids, code, stats);
    await this.push.deleteDevicesByTokens(goneTokens);
    await this.requeueOrExpire(retry, now, stats);
  }

  /** 다시 보낼 것: 시도 3번째이거나 예약 시각이 10분 넘게 지났으면 FAILED EXPIRED, 아니면 QUEUED (다음 틱) */
  private async requeueOrExpire(rows: ClaimedDelivery[], now: Date, stats: SendStats): Promise<void> {
    const expired = rows.filter((row) => row.attempts >= MAX_ATTEMPTS || row.notification.scheduledAt.getTime() < now.getTime() - CATCH_UP_MS);
    const again = rows.filter((row) => !expired.includes(row));
    await this.fail(expired.map((row) => row.id), 'EXPIRED', stats);
    await this.push.requeue(again.map((row) => row.id));
    stats.requeued += again.length;
  }

  private async fail(ids: number[], code: string, stats: SendStats): Promise<void> {
    if (ids.length === 0) return;
    await this.push.markFailed(ids, code);
    stats.failed[code] = (stats.failed[code] ?? 0) + ids.length;
  }
}
