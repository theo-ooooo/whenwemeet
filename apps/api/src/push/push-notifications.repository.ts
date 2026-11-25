import { Injectable } from '@nestjs/common';
import { Db, PrismaService } from '../prisma/prisma.service.js';
import { coalesce, COALESCE_WINDOW_MS, coalesceKey, type ChangeAction } from './coalesce.js';
import type { PushPayload } from './push-copy.js';
import { dateToDb, toJson } from './push-db.js';
import type { DuePollDeadline } from './push-planning.repository.js';

/** 예약할 알림 한 건 (REMINDER, ANNIVERSARY) */
export interface PlannedNotification {
  kind: 'REMINDER' | 'ANNIVERSARY';
  dedupeKey: string;
  groupId: number;
  scheduledAt: Date;
  eventId?: number;
  /** 'YYYY-MM-DD'. 반복 회차만 */
  occurrence?: string | null;
  anniversaryId?: number;
  /** (#305) 생일 알림의 생일인 사람. 받는 사람에서 뺀다 (D-232) */
  actorId?: number;
  payload: PushPayload;
}

/** (#277) 주간 알림 예약. 문구는 펼칠 때 만든다 */
export interface PlannedWeekly {
  kind: 'WEEKLY';
  dedupeKey: string;
  groupId: number;
  scheduledAt: Date;
}

/** (#189) 투표 알림 단계. dedupeKey 머리 PO, PC, PD */
export type PollPushStage = 'OPEN' | 'CLOSED' | 'DEADLINE';
const POLL_KEY_PREFIX: Record<PollPushStage, string> = { OPEN: 'PO', CLOSED: 'PC', DEADLINE: 'PD' };

export function pollDedupeKey(stage: PollPushStage, pollId: number): string {
  return `${POLL_KEY_PREFIX[stage]}:${pollId}`;
}

/** dedupeKey → 단계와 투표 번호. 모양이 틀리면 null */
export function parsePollDedupeKey(key: string): { stage: PollPushStage; pollId: number } | null {
  const match = /^(PO|PC|PD):([1-9]\d*)$/.exec(key);
  if (!match) return null;
  const stage = (Object.keys(POLL_KEY_PREFIX) as PollPushStage[]).find((name) => POLL_KEY_PREFIX[name] === match[1]) as PollPushStage;
  return { stage, pollId: Number(match[2]) };
}

/** (#528) 공지 푸시 dedupeKey. 공지 하나에 한 건 (D-287) */
export const noticeDedupeKey = (noticeId: number) => `N:${noticeId}`;

/** dedupeKey → 공지 번호. 모양이 틀리면 null */
export function parseNoticeDedupeKey(key: string): number | null {
  const match = /^N:([1-9]\d*)$/.exec(key);
  return match ? Number(match[1]) : null;
}

/** 일정 쓰기 저장소들의 `...WithLogTx` 가 막 만든 로그 */
/** (#375) 삭제 하나가 팀원 변경 알림 묶음에 한 일. 되돌리면 거꾸로 한다 (revertChangeTx, D-251) */
export type ChangeRevert =
  | { type: 'create'; notificationId: number }
  | { type: 'cancel'; notificationId: number }
  /** 앞 묶음의 동작과 보일 로그 */
  | { type: 'update'; notificationId: number; changeAction: ChangeAction; eventLogId: number };

export interface CreatedLog {
  id: number;
  groupId: number;
  eventId: number | null;
  actorId: number | null;
  action: ChangeAction;
}

/** 알림 예약을 만들고 고치는 저장소 (#188, #485). 계산한 예약, 팀원 변경 묶기, 합류, 가져오기, 투표, 청소 */
@Injectable()
export class PushNotificationsRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ---------- 예약 저장 (설계 5-3, 5-5) ----------

  /** dedupeKey 가 이미 있으면 건너뛴다 (D-89). 새로 만든 수 */
  async createNotifications(rows: (PlannedNotification | PlannedWeekly)[]): Promise<number> {
    if (rows.length === 0) return 0;
    const { count } = await this.prisma.pushNotification.createMany({
      data: rows.map((row) => ({
        kind: row.kind,
        dedupeKey: row.dedupeKey,
        groupId: row.groupId,
        scheduledAt: row.scheduledAt,
        ...(row.kind === 'WEEKLY'
          ? {}
          : {
              eventId: row.eventId ?? null,
              occurrence: row.occurrence ? dateToDb(row.occurrence) : null,
              anniversaryId: row.anniversaryId ?? null,
              actorId: row.actorId ?? null,
              payload: toJson(row.payload),
            }),
      })),
      skipDuplicates: true,
    });
    return count;
  }

  // ---------- 팀원 변경 묶기, 합류 (설계 5-4, D-90, D-91). 호출자의 트랜잭션 안에서 ----------

  /**
   * EventLog 를 쓴 트랜잭션 안에서 부른다. 변경한 사람이 없거나(탈퇴) PERSONAL 팀이면 아무것도 하지 않는다.
   * 대기 중인 같은 묶음(변경한 사람, 일정)을 잠그고 coalesce 표대로 합친다
   */
  async recordChangeTx(tx: Db, log: CreatedLog, removesEvent: boolean, now: Date): Promise<ChangeRevert | null> {
    if (log.actorId === null || log.eventId === null) return null;
    const group = await tx.group.findUnique({ where: { id: log.groupId }, select: { type: true } });
    if (!group || group.type === 'PERSONAL') return null;

    const key = coalesceKey(log.actorId, log.eventId);
    const locked = await tx.$queryRaw<{ id: number }[]>`
      SELECT id FROM PushNotification WHERE coalesceKey = ${key} AND status = 'PENDING' ORDER BY id DESC LIMIT 1 FOR UPDATE`;
    const current = locked[0]
      ? await tx.pushNotification.findUnique({
          where: { id: Number(locked[0].id) },
          select: { id: true, scheduledAt: true, changeAction: true, eventLogId: true },
        })
      : null;
    // 첫 변경부터 2분이 지난 묶음은 이미 보낼 차례라 새 묶음을 연다
    const pending =
      current && current.scheduledAt.getTime() > now.getTime() && current.changeAction && current.eventLogId !== null
        ? { changeAction: current.changeAction, eventLogId: current.eventLogId }
        : null;

    const result = coalesce(pending, { id: log.id, action: log.action }, removesEvent);
    if (result.type === 'create') {
      const created = await tx.pushNotification.create({
        data: {
          kind: 'CHANGE',
          dedupeKey: `C:${log.id}`,
          groupId: log.groupId,
          scheduledAt: new Date(now.getTime() + COALESCE_WINDOW_MS),
          coalesceKey: key,
          changeAction: log.action,
          eventLogId: log.id,
          eventId: log.eventId,
          actorId: log.actorId,
        },
        select: { id: true },
      });
      return { type: 'create', notificationId: created.id };
    }
    if (result.type === 'cancel') {
      await tx.pushNotification.update({ where: { id: current!.id }, data: { status: 'CANCELLED' }, select: { id: true } });
      return { type: 'cancel', notificationId: current!.id };
    }
    if (result.type === 'update') {
      await tx.pushNotification.update({
        where: { id: current!.id },
        data: { changeAction: result.changeAction, eventLogId: result.eventLogId },
        select: { id: true },
      });
      return { type: 'update', notificationId: current!.id, changeAction: pending!.changeAction, eventLogId: pending!.eventLogId };
    }
    return null;
  }

  /**
   * (#375) 삭제를 되돌린 트랜잭션 안에서: 그 삭제가 묶음에 한 일을 거꾸로 한다 (D-251). 아직 보내지 않은 것만.
   * create → 그 알림 취소, update → 앞 동작과 로그로, cancel(추가 후 삭제로 둘 다 취소) → 2분 창 안이면 다시 대기.
   * 삭제 뒤 같은 묶음에 다른 변경이 합쳐졌으면(보일 로그가 삭제 로그가 아님) 그대로 둔다. 이미 보낸 알림은 거둘 수 없다
   */
  async revertChangeTx(tx: Db, revert: ChangeRevert, deletedLogId: number, now: Date): Promise<void> {
    const where = { id: revert.notificationId };
    if (revert.type === 'create') {
      await tx.pushNotification.updateMany({ where: { ...where, status: 'PENDING', eventLogId: deletedLogId }, data: { status: 'CANCELLED' } });
    } else if (revert.type === 'update') {
      await tx.pushNotification.updateMany({
        where: { ...where, status: 'PENDING', eventLogId: deletedLogId },
        data: { changeAction: revert.changeAction, eventLogId: revert.eventLogId },
      });
    } else {
      await tx.pushNotification.updateMany({ where: { ...where, status: 'CANCELLED', scheduledAt: { gt: now } }, data: { status: 'PENDING' } });
    }
  }

  /** 새 멤버십이 생긴 트랜잭션 안에서. 합류는 한 번만 (dedupeKey J:{membershipId}) */
  async scheduleJoinTx(tx: Db, membership: { id: number; groupId: number; userId: number }, now: Date): Promise<void> {
    await tx.pushNotification.create({
      data: { kind: 'JOIN', dedupeKey: `J:${membership.id}`, groupId: membership.groupId, scheduledAt: now, actorId: membership.userId },
      select: { id: true },
    });
  }

  /**
   * (#279) 일정 가져오기를 마친 트랜잭션 안에서. 팀원 변경 알림 1건을 문구를 미리 만든 채로 바로 예약한다 (D-166).
   * PERSONAL 팀이면 받을 사람이 없어 만들지 않는다. dedupeKey I:{importId}
   */
  async scheduleImportTx(tx: Db, input: { importId: number; groupId: number; actorId: number; payload: PushPayload }, now: Date): Promise<void> {
    const group = await tx.group.findUnique({ where: { id: input.groupId }, select: { type: true } });
    if (!group || group.type === 'PERSONAL') return;
    await tx.pushNotification.create({
      data: {
        kind: 'CHANGE',
        dedupeKey: `I:${input.importId}`,
        groupId: input.groupId,
        scheduledAt: now,
        actorId: input.actorId,
        payload: toJson(input.payload),
      },
      select: { id: true },
    });
  }

  // ---------- (#189) 약속 투표 (설계 약속-투표.md 6장, D-241) ----------

  /**
   * 투표를 열거나 정한 트랜잭션 안에서. 문구를 미리 만든 채로 바로 예약한다 (가져오기 D-166 과 같은 방식).
   * dedupeKey PO:{pollId} (열림), PC:{pollId} (정함). 받는 사람은 펼칠 때 투표 대상에서 고른다
   */
  async schedulePollTx(tx: Db, input: { pollId: number; groupId: number; actorId: number; stage: 'OPEN' | 'CLOSED'; payload: PushPayload }, now: Date): Promise<void> {
    await tx.pushNotification.create({
      data: {
        kind: 'POLL',
        dedupeKey: pollDedupeKey(input.stage, input.pollId),
        groupId: input.groupId,
        scheduledAt: now,
        actorId: input.actorId,
        payload: toJson(input.payload),
      },
      select: { id: true },
    });
  }

  /**
   * 마감 표시(deadlineNotifiedAt)를 한 번만 하고 그때만 알림을 예약한다 (dedupeKey PD:{pollId}, 예약 시각 = 마감).
   * 마감에서 10분 넘게 지나 집었으면 펼칠 때 SKIPPED 가 된다 (D-88). 연 사람이 탈퇴했으면 표시만. 예약했으면 true
   */
  async schedulePollDeadline(poll: DuePollDeadline, payload: PushPayload, now: Date): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.poll.updateMany({ where: { id: poll.id, status: 'OPEN', deadlineNotifiedAt: null }, data: { deadlineNotifiedAt: now } });
      if (count !== 1 || poll.creatorId === null) return false;
      const created = await tx.pushNotification.createMany({
        data: [{ kind: 'POLL', dedupeKey: pollDedupeKey('DEADLINE', poll.id), groupId: poll.groupId, scheduledAt: poll.deadline, payload: toJson(payload) }],
        skipDuplicates: true,
      });
      return created.count === 1;
    });
  }

  // ---------- (#528) 공지 (D-287) ----------

  /**
   * 공지에 pushedAt 을 적은 트랜잭션 안에서. 전체 대상이라 팀이 없다(groupId null). 예약 시각 = 지금이고
   * 문구와 받는 사람은 펼칠 때 정한다(그 사이 고친 제목, 본문이 나간다). 같은 공지의 두 번째 예약은 dedupeKey 가 막는다
   */
  async scheduleNoticeTx(tx: Db, noticeId: number, now: Date): Promise<void> {
    await tx.pushNotification.createMany({
      data: [{ kind: 'NOTICE', dedupeKey: noticeDedupeKey(noticeId), groupId: null, scheduledAt: now }],
      skipDuplicates: true,
    });
  }

  // ---------- 청소 (설계 5-8, D-99) ----------

  /** 만든 지 오래된 알림 삭제 (발송 기록은 Cascade) */
  async deleteNotificationsCreatedBefore(before: Date): Promise<number> {
    const { count } = await this.prisma.pushNotification.deleteMany({ where: { createdAt: { lt: before } } });
    return count;
  }
}
