import { Injectable } from '@nestjs/common';
import { seriesCandidateWindow, type Repeat } from '../events/recurrence.js';
import { Prisma } from '../generated/prisma/client.js';
import { Db, PrismaService } from '../prisma/prisma.service.js';
import { coalesce, COALESCE_WINDOW_MS, coalesceKey, type ChangeAction } from './coalesce.js';
import type { AnniversaryKind } from './anniversary-items.js';
import type { ChangeLogSnapshot, Platform, PushKindName, PushPayload } from './push-copy.js';
import type { EventReminder } from './remind-at.js';
import type { AnniversaryReminderFlags } from '../anniversaries/anniversary-reminders.js';

/** 사용자당 기기 상한 (D-83) */
export const MAX_DEVICES_PER_USER = 10;
/** 임대 행 이름 (마이그레이션이 넣는다) */
export const PUSH_LEASE = 'push';

/** 내 정보 > 알림 (설계 7-1) */
export interface NotificationSettings {
  reminder: boolean;
  change: boolean;
  anniversary: boolean;
  join: boolean;
}

export interface DeviceInput {
  token: string;
  platform: Platform;
  appVersion: string;
}

/** 임대를 얻었을 때 읽는 진행 위치 */
export interface LeaseState {
  cursor: Date | null;
  /** 'YYYY-MM-DD' (KST) */
  dailyDoneOn: string | null;
}

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
  payload: PushPayload;
}

export interface OnceReminderRow {
  id: number;
  /** (#311) 일정 공개 코드 */
  publicCode: string;
  groupId: number;
  groupName: string;
  /** (#311) 팀 공개 코드 */
  groupCode: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  allDay: boolean;
  reminder: EventReminder;
  remindAt: Date;
  reminderSetAt: Date;
}

export interface ReminderExceptionRow {
  occurrence: string;
  cancelled: boolean;
  title: string | null;
  startsAt: Date | null;
  endsAt: Date | null;
  allDay: boolean | null;
  reminder: EventReminder | null;
  reminderSetAt: Date | null;
}

export interface ReminderSeriesRow {
  id: number;
  /** (#311) 일정 공개 코드 */
  publicCode: string;
  groupId: number;
  groupName: string;
  /** (#311) 팀 공개 코드 */
  groupCode: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  allDay: boolean;
  reminder: EventReminder;
  reminderSetAt: Date;
  repeat: Repeat;
  repeatUntil: string | null;
  repeatAnchor: string | null;
  exceptions: ReminderExceptionRow[];
}

export interface AnniversaryPlanRow extends AnniversaryReminderFlags {
  id: number;
  groupId: number;
  groupName: string;
  /** (#311) 팀 공개 코드 */
  groupCode: string;
  name: string;
  /** 'YYYY-MM-DD' */
  date: string;
  kind: AnniversaryKind;
  updatedAt: Date;
}

/** 펼칠 차례가 된 예약 */
export interface DueNotification {
  id: number;
  kind: PushKindName;
  groupId: number;
  scheduledAt: Date;
  /** (#297) 예약을 만든 시각. CHANGE 묶음은 첫 변경, JOIN 은 합류, 가져오기는 가져오기를 마친 시각 */
  createdAt: Date;
  eventId: number | null;
  eventLogId: number | null;
  actorId: number | null;
  changeAction: ChangeAction | null;
  payload: PushPayload | null;
}

export interface Recipient {
  userId: number;
  token: string;
  platform: Platform;
}

/** 보낼 차례가 된 기기별 발송 (SENDING 으로 바꾼 뒤) */
export interface ClaimedDelivery {
  id: number;
  token: string;
  platform: Platform;
  /** 이번 시도를 더한 횟수 */
  attempts: number;
  notification: { id: number; kind: PushKindName; scheduledAt: Date; payload: PushPayload | null };
}

export interface ReceiptCandidate {
  id: number;
  ticketId: string;
  token: string;
}

/** EventsRepository 의 `...WithLogTx` 가 막 만든 로그 */
export interface CreatedLog {
  id: number;
  groupId: number;
  eventId: number | null;
  actorId: number | null;
  action: ChangeAction;
}

/**
 * `YYYY-MM-DD` ↔ `@db.Date` (events.repository 의 같은 이름 함수와 같은 규칙).
 * EventsRepository 가 이 Repository 를 주입받으므로 순환 import 를 피하려고 여기 둔다
 */
const dateToDb = (value: string): Date => new Date(`${value}T00:00:00.000Z`);
const dbToDate = (value: Date): string => value.toISOString().slice(0, 10);

const SETTINGS_SELECT = { notifyReminder: true, notifyChange: true, notifyAnniversary: true, notifyJoin: true } as const;

/** 종류별 설정 컬럼 (설계 5-6 받는 사람 표) */
const KIND_SETTING: Record<PushKindName, keyof typeof SETTINGS_SELECT> = {
  REMINDER: 'notifyReminder',
  CHANGE: 'notifyChange',
  ANNIVERSARY: 'notifyAnniversary',
  JOIN: 'notifyJoin',
};

const ACTIVE_REMINDERS: EventReminder[] = ['AT_START', 'MIN_10', 'HOUR_1', 'DAY_1', 'DAY_OF_0900', 'DAY_BEFORE_0900'];

function toSettings(row: { notifyReminder: boolean; notifyChange: boolean; notifyAnniversary: boolean; notifyJoin: boolean }): NotificationSettings {
  return { reminder: row.notifyReminder, change: row.notifyChange, anniversary: row.notifyAnniversary, join: row.notifyJoin };
}

const asPayload = (value: Prisma.JsonValue | null): PushPayload | null => (value === null ? null : (value as unknown as PushPayload));
const toJson = (payload: PushPayload): Prisma.InputJsonValue => payload as unknown as Prisma.InputJsonValue;

/** 푸시 알림 저장소 (#188). 기기, 설정, 임대, 예약, 발송 기록 */
@Injectable()
export class PushRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ---------- 기기 (설계 2-3, 7-1) ----------

  /** token 으로 upsert (다른 사용자 행이면 나로 옮긴다). 내 기기가 상한을 넘으면 lastSeenAt 가 오래된 것부터 지운다 */
  async registerDevice(userId: number, input: DeviceInput, now: Date, maxDevices = MAX_DEVICES_PER_USER): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const data = { userId, platform: input.platform, appVersion: input.appVersion, lastSeenAt: now };
      await tx.pushDevice.upsert({ where: { token: input.token }, create: { token: input.token, ...data }, update: data });
      const overflow = await tx.pushDevice.findMany({
        where: { userId },
        orderBy: [{ lastSeenAt: 'desc' }, { id: 'desc' }],
        skip: maxDevices,
        select: { id: true },
      });
      if (overflow.length > 0) await tx.pushDevice.deleteMany({ where: { id: { in: overflow.map((row) => row.id) } } });
    });
  }

  /** 내 기기 행만 지운다. 없어도 그대로 (멱등) */
  async removeDevice(userId: number, token: string): Promise<void> {
    await this.prisma.pushDevice.deleteMany({ where: { userId, token } });
  }

  /** 발송, 영수증의 DeviceNotRegistered */
  async deleteDevicesByTokens(tokens: string[]): Promise<number> {
    if (tokens.length === 0) return 0;
    const { count } = await this.prisma.pushDevice.deleteMany({ where: { token: { in: tokens } } });
    return count;
  }

  // ---------- 설정 (설계 7-1) ----------

  async getSettings(userId: number): Promise<NotificationSettings | null> {
    const row = await this.prisma.user.findUnique({ where: { id: userId }, select: SETTINGS_SELECT });
    return row && toSettings(row);
  }

  async updateSettings(userId: number, patch: Partial<NotificationSettings>): Promise<NotificationSettings> {
    const data: Partial<Record<keyof typeof SETTINGS_SELECT, boolean>> = {};
    if (patch.reminder !== undefined) data.notifyReminder = patch.reminder;
    if (patch.change !== undefined) data.notifyChange = patch.change;
    if (patch.anniversary !== undefined) data.notifyAnniversary = patch.anniversary;
    if (patch.join !== undefined) data.notifyJoin = patch.join;
    return toSettings(await this.prisma.user.update({ where: { id: userId }, data, select: SETTINGS_SELECT }));
  }

  // ---------- 임대 (설계 5-1, D-87) ----------

  /** 임대 행이 없으면 만든다 (마이그레이션이 넣지만 테스트 DB 정리 등에 대비) */
  async ensureLease(name = PUSH_LEASE): Promise<void> {
    await this.prisma.schedulerLease.createMany({ data: [{ name, leaseUntil: new Date(0) }], skipDuplicates: true });
  }

  /** 만료됐거나 내 것인 임대만 가져온다. 다른 프로세스가 가졌으면 null */
  async acquireLease(holder: string, now: Date, until: Date, name = PUSH_LEASE): Promise<LeaseState | null> {
    const { count } = await this.prisma.schedulerLease.updateMany({
      where: { name, OR: [{ leaseUntil: { lt: now } }, { holder }] },
      data: { holder, leaseUntil: until },
    });
    if (count !== 1) return null;
    const row = await this.prisma.schedulerLease.findUnique({ where: { name }, select: { cursor: true, dailyDoneOn: true } });
    if (!row) return null;
    return { cursor: row.cursor, dailyDoneOn: row.dailyDoneOn === null ? null : dbToDate(row.dailyDoneOn) };
  }

  async setCursor(holder: string, cursor: Date, name = PUSH_LEASE): Promise<void> {
    await this.prisma.schedulerLease.updateMany({ where: { name, holder }, data: { cursor } });
  }

  async setDailyDone(holder: string, date: string, name = PUSH_LEASE): Promise<void> {
    await this.prisma.schedulerLease.updateMany({ where: { name, holder }, data: { dailyDoneOn: dateToDb(date) } });
  }

  // ---------- 예약 계산 (설계 5-3, 5-5) ----------

  /** 한 번짜리 일정 중 알림 시각이 (lo, hi] 인 것 (인덱스 remindAt) */
  async listOnceReminders(lo: Date, hi: Date): Promise<OnceReminderRow[]> {
    const rows = await this.prisma.event.findMany({
      where: { repeat: null, remindAt: { gt: lo, lte: hi } },
      select: {
        id: true,
        publicCode: true,
        groupId: true,
        title: true,
        startsAt: true,
        endsAt: true,
        allDay: true,
        reminder: true,
        remindAt: true,
        reminderSetAt: true,
        group: { select: { name: true, publicCode: true } },
      },
    });
    return rows.map(({ group, remindAt, ...row }) => ({ ...row, groupName: group.name, groupCode: group.publicCode, remindAt: remindAt as Date }));
  }

  /**
   * 회차 시작이 [from, to) 에 들 수 있는 반복 원본 중 알림이 있는 것 + 예외.
   * 원본이 알림을 고른 것과, 원본은 NONE 이지만 회차 예외만 알림을 고른 것(회차 날짜 ±32일) 둘 다
   */
  async listReminderSeries(from: Date, to: Date, occurrenceFrom: string, occurrenceTo: string): Promise<ReminderSeriesRow[]> {
    const window = seriesCandidateWindow(from, to);
    const exceptionOwners = await this.prisma.eventException.findMany({
      where: {
        reminder: { in: ACTIVE_REMINDERS },
        occurrence: { gte: dateToDb(occurrenceFrom), lte: dateToDb(occurrenceTo) },
      },
      select: { eventId: true },
      distinct: ['eventId'],
    });
    const rows = await this.prisma.event.findMany({
      where: {
        repeat: { not: null },
        startsAt: { lt: window.startsBefore },
        AND: [
          { OR: [{ repeatUntil: null }, { repeatUntil: { gte: dateToDb(window.untilOnOrAfter) } }] },
          { OR: [{ reminder: { not: 'NONE' } }, { id: { in: exceptionOwners.map((row) => row.eventId) } }] },
        ],
      },
      select: {
        id: true,
        publicCode: true,
        groupId: true,
        title: true,
        startsAt: true,
        endsAt: true,
        allDay: true,
        reminder: true,
        reminderSetAt: true,
        repeat: true,
        repeatUntil: true,
        repeatAnchor: true,
        group: { select: { name: true, publicCode: true } },
        exceptions: {
          select: {
            occurrence: true,
            cancelled: true,
            title: true,
            startsAt: true,
            endsAt: true,
            allDay: true,
            reminder: true,
            reminderSetAt: true,
          },
        },
      },
    });
    return rows.map(({ group, exceptions, ...row }) => ({
      ...row,
      groupName: group.name,
      groupCode: group.publicCode,
      repeat: row.repeat as Repeat,
      repeatUntil: row.repeatUntil === null ? null : dbToDate(row.repeatUntil),
      repeatAnchor: row.repeatAnchor === null ? null : dbToDate(row.repeatAnchor),
      exceptions: exceptions.map((exception) => ({ ...exception, occurrence: dbToDate(exception.occurrence) })),
    }));
  }

  /** 모든 기념일 (그날 항목은 순수 함수로 거른다) */
  async listAnniversaries(): Promise<AnniversaryPlanRow[]> {
    const rows = await this.prisma.anniversary.findMany({
      // (#269) 알림 없음(셋 다 꺼짐) 은 읽지 않는다
      where: { OR: [{ remindDayOf: true }, { remindDayBefore: true }, { remindWeekBefore: true }] },
      select: {
        id: true,
        groupId: true,
        name: true,
        date: true,
        kind: true,
        remindDayOf: true,
        remindDayBefore: true,
        remindWeekBefore: true,
        updatedAt: true,
        group: { select: { name: true, publicCode: true } },
      },
      orderBy: { id: 'asc' },
    });
    return rows.map(({ group, date, ...row }) => ({ ...row, groupName: group.name, groupCode: group.publicCode, date: dbToDate(date) }));
  }

  /** dedupeKey 가 이미 있으면 건너뛴다 (D-89). 새로 만든 수 */
  async createNotifications(rows: PlannedNotification[]): Promise<number> {
    if (rows.length === 0) return 0;
    const { count } = await this.prisma.pushNotification.createMany({
      data: rows.map((row) => ({
        kind: row.kind,
        dedupeKey: row.dedupeKey,
        groupId: row.groupId,
        scheduledAt: row.scheduledAt,
        eventId: row.eventId ?? null,
        occurrence: row.occurrence ? dateToDb(row.occurrence) : null,
        anniversaryId: row.anniversaryId ?? null,
        payload: toJson(row.payload),
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
  async recordChangeTx(tx: Db, log: CreatedLog, removesEvent: boolean, now: Date): Promise<void> {
    if (log.actorId === null || log.eventId === null) return;
    const group = await tx.group.findUnique({ where: { id: log.groupId }, select: { type: true } });
    if (!group || group.type === 'PERSONAL') return;

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
      await tx.pushNotification.create({
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
    } else if (result.type === 'cancel') {
      await tx.pushNotification.update({ where: { id: current!.id }, data: { status: 'CANCELLED' }, select: { id: true } });
    } else if (result.type === 'update') {
      await tx.pushNotification.update({
        where: { id: current!.id },
        data: { changeAction: result.changeAction, eventLogId: result.eventLogId },
        select: { id: true },
      });
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
        groupId: true,
        scheduledAt: true,
        createdAt: true,
        eventId: true,
        eventLogId: true,
        actorId: true,
        changeAction: true,
        payload: true,
      },
    });
    return rows.map((row) => ({ ...row, payload: asPayload(row.payload) }));
  }

  /** PENDING 인 것만 SKIPPED (D-88) */
  async markSkipped(ids: number[]): Promise<number> {
    if (ids.length === 0) return 0;
    const { count } = await this.prisma.pushNotification.updateMany({ where: { id: { in: ids }, status: 'PENDING' }, data: { status: 'SKIPPED' } });
    return count;
  }

  async eventExists(eventId: number): Promise<boolean> {
    return (await this.prisma.event.findUnique({ where: { id: eventId }, select: { id: true } })) !== null;
  }

  /** 팀 이름과 (#311) 공개 코드. 팀이 지워졌으면 null */
  async findGroupRef(groupId: number): Promise<{ name: string; publicCode: string } | null> {
    return this.prisma.group.findUnique({ where: { id: groupId }, select: { name: true, publicCode: true } });
  }

  /** 변경 알림 문구용 로그 스냅샷. (#311) eventCode 는 원본이 남아 있을 때만 (지워지면 로그의 eventId 가 SetNull) */
  async findChangeLog(eventLogId: number): Promise<ChangeLogSnapshot | null> {
    const row = await this.prisma.eventLog.findUnique({
      where: { id: eventLogId },
      select: {
        eventId: true,
        title: true,
        startsAt: true,
        endsAt: true,
        allDay: true,
        repeat: true,
        scope: true,
        occurrence: true,
        event: { select: { publicCode: true } },
      },
    });
    if (!row) return null;
    const { event, ...log } = row;
    return {
      ...log,
      eventCode: event?.publicCode ?? null,
      repeat: (log.repeat as Repeat | null) ?? null,
      occurrence: log.occurrence === null ? null : dbToDate(log.occurrence),
    };
  }

  /** 그 팀의 표시 이름. 나갔으면 닉네임, 탈퇴했으면 null */
  async findPersonName(groupId: number, userId: number): Promise<string | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { nickname: true, memberships: { where: { groupId }, select: { displayName: true } } },
    });
    if (!user) return null;
    return user.memberships[0]?.displayName ?? user.nickname;
  }

  /**
   * 지금 팀원 × 기기 중 종류 설정과 팀 설정이 켜진 것. excludeUserId 는 뺀다 (설계 5-6 받는 사람).
   * (#248) REMINDER 는 펼치는 순간 그 일정의 참여자만 ("모두" 면 팀원 전원). 참여자 없음이거나 일정이 없으면 0명 (D-138).
   * (#297) joinedBy 를 주면 그 시각까지 들어와 있던 팀원만 (joinedAt <= joinedBy). 지난 일을 알리는 CHANGE, JOIN 용 (D-180)
   */
  async listRecipients(
    groupId: number,
    kind: PushKindName,
    excludeUserId: number | null,
    eventId: number | null = null,
    joinedBy: Date | null = null,
  ): Promise<Recipient[]> {
    let participantIds: number[] | null = null;
    if (kind === 'REMINDER' && eventId !== null) {
      const event = await this.prisma.event.findUnique({
        where: { id: eventId },
        select: { allMembers: true, participants: { select: { userId: true } } },
      });
      if (!event) return [];
      if (!event.allMembers) participantIds = event.participants.map((row) => row.userId);
    }
    if (participantIds !== null && participantIds.length === 0) return [];
    const rows = await this.prisma.membership.findMany({
      where: {
        groupId,
        notify: true,
        user: { [KIND_SETTING[kind]]: true } as Prisma.UserWhereInput,
        ...(excludeUserId === null ? {} : { userId: { not: excludeUserId } }),
        ...(participantIds === null ? {} : { AND: [{ userId: { in: participantIds } }] }),
        ...(joinedBy === null ? {} : { joinedAt: { lte: joinedBy } }),
      },
      select: { userId: true, user: { select: { pushDevices: { select: { token: true, platform: true } } } } },
    });
    return rows.flatMap((row) => row.user.pushDevices.map((device) => ({ userId: row.userId, token: device.token, platform: device.platform })));
  }

  /**
   * PENDING → DISPATCHED 가 1행일 때만 기기별 발송(QUEUED)을 만든다 (두 번 펼치지 않음, D-89).
   * payload 를 주면 함께 저장한다. 펼쳤으면 true
   */
  async dispatchTx(notificationId: number, now: Date, payload: PushPayload | null, recipients: Recipient[]): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.pushNotification.updateMany({
        where: { id: notificationId, status: 'PENDING' },
        data: { status: 'DISPATCHED', dispatchedAt: now, ...(payload ? { payload: toJson(payload) } : {}) },
      });
      if (count !== 1) return false;
      if (recipients.length > 0) {
        await tx.pushDelivery.createMany({
          data: recipients.map((recipient) => ({ notificationId, ...recipient })),
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
        notification: { select: { id: true, kind: true, scheduledAt: true, payload: true } },
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
      notification: { ...row.notification, payload: asPayload(row.notification.payload) },
    }));
  }

  async markSent(sent: { id: number; ticketId: string }[], now: Date): Promise<void> {
    if (sent.length === 0) return;
    await this.prisma.$transaction(
      sent.map(({ id, ticketId }) => this.prisma.pushDelivery.update({ where: { id }, data: { status: 'SENT', ticketId, sentAt: now }, select: { id: true } })),
    );
  }

  async markFailed(ids: number[], error: string): Promise<void> {
    if (ids.length === 0) return;
    await this.prisma.pushDelivery.updateMany({ where: { id: { in: ids } }, data: { status: 'FAILED', error } });
  }

  async requeue(ids: number[]): Promise<void> {
    if (ids.length === 0) return;
    await this.prisma.pushDelivery.updateMany({ where: { id: { in: ids } }, data: { status: 'QUEUED' } });
  }

  // ---------- 영수증 (설계 5-7) ----------

  /** 보낸 지 15분 ~ 23시간이고 아직 확인하지 않은 것 */
  async listReceiptCandidates(now: Date, limit: number): Promise<ReceiptCandidate[]> {
    const rows = await this.prisma.pushDelivery.findMany({
      where: {
        status: 'SENT',
        receiptCheckedAt: null,
        sentAt: { lte: new Date(now.getTime() - 15 * 60 * 1000), gte: new Date(now.getTime() - 23 * 60 * 60 * 1000) },
      },
      orderBy: { id: 'asc' },
      take: limit,
      select: { id: true, ticketId: true, token: true },
    });
    return rows.filter((row): row is ReceiptCandidate => row.ticketId !== null);
  }

  async saveReceipts(ids: number[], receipt: string, now: Date): Promise<void> {
    if (ids.length === 0) return;
    await this.prisma.pushDelivery.updateMany({ where: { id: { in: ids } }, data: { receipt, receiptCheckedAt: now } });
  }

  // ---------- 청소 (설계 5-8, D-99) ----------

  /** 만든 지 오래된 알림 삭제 (발송 기록은 Cascade) */
  async deleteNotificationsCreatedBefore(before: Date): Promise<number> {
    const { count } = await this.prisma.pushNotification.deleteMany({ where: { createdAt: { lt: before } } });
    return count;
  }
}
