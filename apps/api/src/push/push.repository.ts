import { Injectable } from '@nestjs/common';
import { type ExceptionRule, kstDate, type SeriesRule, seriesCandidateWindow, type Repeat } from '../events/recurrence.js';
import { Prisma } from '../generated/prisma/client.js';
import { Db, PrismaService } from '../prisma/prisma.service.js';
import { coalesce, COALESCE_WINDOW_MS, coalesceKey, type ChangeAction } from './coalesce.js';
import type { AnniversaryKind, AnniversaryLike } from './anniversary-items.js';
import type { ChangeLogSnapshot, Platform, PushKindName, PushPayload } from './push-copy.js';
import type { EventReminder } from './remind-at.js';
import { type AnniversaryReminderFlags, flagsFromRows, REMINDER_ROWS_SELECT } from '../anniversaries/anniversary-reminders.js';
import { type PreferenceKind, preferenceOn } from '../notification-preferences/notification-preferences.js';
import { NotificationPreferencesRepository } from '../notification-preferences/notification-preferences.repository.js';
import { birthdayAnniversary, birthdayTitle } from '../anniversaries/birthdays.js';

/** 사용자당 기기 상한 (D-83) */
export const MAX_DEVICES_PER_USER = 10;
/** 임대 행 이름 (마이그레이션이 넣는다) */
export const PUSH_LEASE = 'push';
/** (#277) 주간 알림을 예약한 월요일을 적는 행 (D-203). 임대는 PUSH_LEASE 가 잡는다 */
export const WEEKLY_MARKER = 'weekly';

/** 내 정보 > 알림 (설계 7-1) */
export interface NotificationSettings {
  reminder: boolean;
  change: boolean;
  anniversary: boolean;
  join: boolean;
  /** (#277) 주간 요약. 기본 켬 */
  weekly: boolean;
  /** (#277) 다 같이 비는 시간 (조용한 팀 깨우기). 기본 끔 (D-204) */
  weeklyNudge: boolean;
  /** (#189) 약속 투표. 기본 켬 */
  poll: boolean;
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

/** (#305) 팀원 생일 알림 재료. 생일을 보이는 TEAM 팀 멤버십 하나에 한 행 */
export interface BirthdayPlanRow extends AnniversaryReminderFlags {
  userId: number;
  groupId: number;
  groupName: string;
  groupCode: string;
  /** 그 팀 표시 이름 ?? 닉네임 */
  name: string;
  /** 'MM-DD' */
  birthday: string;
}

/** (#277) 주간 알림 판정용 팀 */
export interface WeeklyGroup {
  name: string;
  publicCode: string;
  type: 'PERSONAL' | 'TEAM';
  createdAt: Date;
  /** 지금 팀원 */
  memberIds: number[];
}

/** (#277) 회차 수와 요약 문구용 일정 (제목, 시각만) */
export interface WeeklyEventRow {
  title: string;
  startsAt: Date;
  endsAt: Date;
  allDay: boolean;
}

export interface WeeklySeriesRow extends WeeklyEventRow, SeriesRule {
  repeat: Repeat;
  exceptions: ExceptionRule[];
}

/** (#277) 깨우기 빈 시간의 바쁜 구간 (#248 참여자 규칙용, 제목은 읽지 않는다 D-14) */
export interface WeeklyBusyRow {
  startsAt: Date;
  endsAt: Date;
  allMembers: boolean;
  participantIds: number[];
}

export interface WeeklyBusySeries extends WeeklyBusyRow, SeriesRule {
  exceptions: ExceptionRule[];
}

/** 펼칠 차례가 된 예약 */
export interface DueNotification {
  id: number;
  kind: PushKindName;
  /** (#277) WEEKLY 는 여기서 그 주 월요일을 읽는다 */
  dedupeKey: string;
  groupId: number;
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

/** (#189) 마감 알림을 예약할 투표 */
export interface DuePollDeadline {
  id: number;
  groupId: number;
  groupName: string;
  groupCode: string;
  pollCode: string;
  title: string;
  deadline: Date;
  creatorId: number | null;
}

/** (#189) 투표 알림 받는 사람 판정용 */
export interface PollTargets {
  status: 'OPEN' | 'CLOSED';
  allMembers: boolean;
  creatorId: number | null;
  participantIds: number[];
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

/** (#369) 설정 API 키 ↔ 알림 종류 (NotificationPreference.kind, D-249) */
const SETTING_KIND: Record<keyof NotificationSettings, PreferenceKind> = {
  reminder: 'REMINDER',
  change: 'CHANGE',
  anniversary: 'ANNIVERSARY',
  join: 'JOIN',
  weekly: 'WEEKLY',
  weeklyNudge: 'WEEKLY_NUDGE',
  poll: 'POLL',
};

/** 받는 사람을 거르는 알림 종류. 푸시 종류 이름과 같고 WEEKLY 의 NUDGE 만 WEEKLY_NUDGE 를 따로 넘긴다 (D-204) */
export type SettingKind = PreferenceKind;

const BUSY_SELECT = { allMembers: true, participants: { select: { userId: true } } } as const;
const idsOf = (rows: { userId: number }[]): number[] => rows.map((row) => row.userId).sort((a, b) => a - b);

const ACTIVE_REMINDERS: EventReminder[] = ['AT_START', 'MIN_10', 'HOUR_1', 'DAY_1', 'DAY_OF_0900', 'DAY_BEFORE_0900'];

function toSettings(values: Record<PreferenceKind, boolean>): NotificationSettings {
  return Object.fromEntries(Object.entries(SETTING_KIND).map(([key, kind]) => [key, values[kind]])) as unknown as NotificationSettings;
}

const asPayload = (value: Prisma.JsonValue | null): PushPayload | null => (value === null ? null : (value as unknown as PushPayload));
const toJson = (payload: PushPayload): Prisma.InputJsonValue => payload as unknown as Prisma.InputJsonValue;

/** 푸시 알림 저장소 (#188). 기기, 설정, 임대, 예약, 발송 기록 */
@Injectable()
export class PushRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly preferences: NotificationPreferencesRepository,
  ) {}

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
    const values = await this.preferences.find(userId);
    return values && toSettings(values);
  }

  async updateSettings(userId: number, patch: Partial<NotificationSettings>): Promise<NotificationSettings> {
    const values: Partial<Record<PreferenceKind, boolean>> = {};
    for (const [key, kind] of Object.entries(SETTING_KIND) as [keyof NotificationSettings, PreferenceKind][]) {
      if (patch[key] !== undefined) values[kind] = patch[key];
    }
    return toSettings(await this.preferences.set(userId, values));
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

  /** (#277) 주간 알림을 예약한 월요일 'YYYY-MM-DD'. 행이 없으면 null (D-203) */
  async getWeeklyDoneOn(): Promise<string | null> {
    const row = await this.prisma.schedulerLease.findUnique({ where: { name: WEEKLY_MARKER }, select: { dailyDoneOn: true } });
    return row?.dailyDoneOn ? dbToDate(row.dailyDoneOn) : null;
  }

  /** (#277) 'push' 임대를 가진 틱 안에서만 부른다. 행이 없으면 만든다 */
  async setWeeklyDoneOn(date: string): Promise<void> {
    await this.prisma.schedulerLease.upsert({
      where: { name: WEEKLY_MARKER },
      create: { name: WEEKLY_MARKER, leaseUntil: new Date(0), dailyDoneOn: dateToDb(date) },
      update: { dailyDoneOn: dateToDb(date) },
      select: { name: true },
    });
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
      where: { reminders: { some: {} } },
      select: {
        id: true,
        groupId: true,
        name: true,
        date: true,
        kind: true,
        reminders: REMINDER_ROWS_SELECT,
        updatedAt: true,
        group: { select: { name: true, publicCode: true } },
      },
      orderBy: { id: 'asc' },
    });
    return rows.map(({ group, date, reminders, ...row }) => ({
      ...row,
      ...flagsFromRows(reminders),
      groupName: group.name,
      groupCode: group.publicCode,
      date: dbToDate(date),
    }));
  }

  /**
   * (#305) 생일 알림 재료: 생일이 있고 알림 시점이 하나라도 켜진 사용자의, 생일을 보이는 TEAM 팀 멤버십.
   * 개인 팀은 받을 사람(나 말고 다른 팀원)이 없어 읽지 않는다
   */
  async listBirthdays(): Promise<BirthdayPlanRow[]> {
    const rows = await this.prisma.membership.findMany({
      where: {
        showBirthday: true,
        group: { type: 'TEAM' },
        user: { birthday: { not: null }, birthdayReminders: { some: {} } },
      },
      select: {
        userId: true,
        groupId: true,
        displayName: true,
        group: { select: { name: true, publicCode: true } },
        user: { select: { nickname: true, birthday: true, birthdayReminders: REMINDER_ROWS_SELECT } },
      },
      orderBy: { id: 'asc' },
    });
    return rows.map(({ group, user, ...row }) => ({
      userId: row.userId,
      groupId: row.groupId,
      groupName: group.name,
      groupCode: group.publicCode,
      name: row.displayName ?? user.nickname,
      birthday: user.birthday!,
      ...flagsFromRows(user.birthdayReminders),
    }));
  }

  /** (#305) 펼칠 때 다시 본다: 그 팀에 생일을 보이는 멤버면 지금 생일 'MM-DD', 나갔거나 껐거나 지웠으면 null */
  async findShownBirthday(groupId: number, userId: number): Promise<string | null> {
    const row = await this.prisma.membership.findFirst({ where: { groupId, userId, showBirthday: true }, select: { user: { select: { birthday: true } } } });
    return row?.user.birthday ?? null;
  }

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

  /** 마감이 지났는데 아직 마감 알림을 예약하지 않은 진행 중 투표, 마감 순 */
  async listDuePollDeadlines(now: Date, limit: number): Promise<DuePollDeadline[]> {
    const rows = await this.prisma.poll.findMany({
      where: { status: 'OPEN', deadline: { lte: now }, deadlineNotifiedAt: null },
      orderBy: [{ deadline: 'asc' }, { id: 'asc' }],
      take: limit,
      select: { id: true, groupId: true, publicCode: true, title: true, deadline: true, creatorId: true, group: { select: { name: true, publicCode: true } } },
    });
    return rows.map((row) => ({
      id: row.id,
      groupId: row.groupId,
      groupName: row.group.name,
      groupCode: row.group.publicCode,
      pollCode: row.publicCode,
      title: row.title,
      deadline: row.deadline as Date,
      creatorId: row.creatorId,
    }));
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

  /** 투표 알림을 펼칠 때 받을 사람을 고르는 값. 투표가 지워졌으면 null */
  async findPollTargets(pollId: number): Promise<PollTargets | null> {
    const row = await this.prisma.poll.findUnique({
      where: { id: pollId },
      select: { status: true, allMembers: true, creatorId: true, participants: { select: { userId: true } } },
    });
    if (!row) return null;
    return { status: row.status, allMembers: row.allMembers, creatorId: row.creatorId, participantIds: idsOf(row.participants) };
  }

  /**
   * (#189) userIds 중(null 이면 팀원 전원) 지금 팀원 × 기기, 약속 투표 알림(POLL)과 팀 알림이 켜진 것. excludeUserId 는 뺀다.
   * joinedBy 를 주면 그 시각까지 들어와 있던 팀원만 (지난 일을 알리는 "정함", D-180)
   */
  async listPollRecipients(groupId: number, userIds: number[] | null, excludeUserId: number | null, joinedBy: Date | null): Promise<Recipient[]> {
    if (userIds !== null && userIds.length === 0) return [];
    const rows = await this.prisma.membership.findMany({
      where: {
        groupId,
        notify: true,
        user: preferenceOn('POLL'),
        ...(excludeUserId === null ? {} : { userId: { not: excludeUserId } }),
        ...(userIds === null ? {} : { AND: [{ userId: { in: userIds } }] }),
        ...(joinedBy === null ? {} : { joinedAt: { lte: joinedBy } }),
      },
      select: { userId: true, user: { select: { pushDevices: { select: { token: true, platform: true } } } } },
    });
    return rows.flatMap((row) => row.user.pushDevices.map((device) => ({ userId: row.userId, token: device.token, platform: device.platform })));
  }

  // ---------- (#277) 주간 요약과 깨우기 (설계 5-9, D-203 ~ D-205) ----------

  /** 주간 알림을 켠(요약 또는 깨우기) 팀원 중 팀 알림을 켜고 기기가 있는 사람이 1명 이상인 팀 */
  async listWeeklyGroupIds(): Promise<number[]> {
    const rows = await this.prisma.group.findMany({
      where: {
        memberships: {
          some: { notify: true, user: { OR: [preferenceOn('WEEKLY'), preferenceOn('WEEKLY_NUDGE')], pushDevices: { some: {} } } },
        },
      },
      select: { id: true },
      orderBy: { id: 'asc' },
    });
    return rows.map((row) => row.id);
  }

  /** 팀이 지워졌으면 null */
  async findWeeklyGroup(groupId: number): Promise<WeeklyGroup | null> {
    const row = await this.prisma.group.findUnique({
      where: { id: groupId },
      select: { name: true, publicCode: true, type: true, createdAt: true, memberships: { select: { userId: true } } },
    });
    if (!row) return null;
    const { memberships, ...group } = row;
    return { ...group, memberIds: idsOf(memberships) };
  }

  /** 팀 일정 중 [from, to) 에 회차가 있을 수 있는 것. 한 번짜리는 겹치는 것만, 반복은 원본 + 예외 (펼치기는 호출자) */
  async listWeeklyEvents(groupId: number, from: Date, to: Date): Promise<{ once: WeeklyEventRow[]; series: WeeklySeriesRow[] }> {
    const window = seriesCandidateWindow(from, to);
    const select = { title: true, startsAt: true, endsAt: true, allDay: true } as const;
    const [once, series] = await Promise.all([
      this.prisma.event.findMany({ where: { groupId, repeat: null, startsAt: { lt: to }, endsAt: { gt: from } }, select, orderBy: { startsAt: 'asc' } }),
      this.prisma.event.findMany({
        where: {
          groupId,
          repeat: { not: null },
          startsAt: { lt: window.startsBefore },
          OR: [{ repeatUntil: null }, { repeatUntil: { gte: dateToDb(window.untilOnOrAfter) } }],
        },
        select: {
          ...select,
          repeat: true,
          repeatUntil: true,
          repeatAnchor: true,
          exceptions: { select: { occurrence: true, cancelled: true, title: true, startsAt: true, endsAt: true, allDay: true } },
        },
        orderBy: { id: 'asc' },
      }),
    ]);
    return {
      once,
      series: series.map((row) => ({
        ...row,
        repeat: row.repeat as Repeat,
        repeatUntil: row.repeatUntil === null ? null : dbToDate(row.repeatUntil),
        repeatAnchor: row.repeatAnchor === null ? null : dbToDate(row.repeatAnchor),
        exceptions: row.exceptions.map((exception) => ({ ...exception, occurrence: dbToDate(exception.occurrence) })),
      })),
    };
  }

  /** since 뒤 팀의 일정 추가 기록(EventLog CREATED) 수 */
  async countCreatedLogsSince(groupId: number, since: Date): Promise<number> {
    return this.prisma.eventLog.count({ where: { groupId, action: 'CREATED', createdAt: { gt: since } } });
  }

  /** 팀의 마지막 일정 생성 시각. 일정이 없으면 null */
  async lastEventCreatedAt(groupId: number): Promise<Date | null> {
    const row = await this.prisma.event.aggregate({ where: { groupId }, _max: { createdAt: true } });
    return row._max.createdAt;
  }

  /** since 이후 예약으로 실제로 펼친 깨우기(DISPATCHED, variant NUDGE)가 있는지 (D-205) */
  async hasNudgeSince(groupId: number, since: Date): Promise<boolean> {
    const row = await this.prisma.pushNotification.findFirst({
      where: { groupId, kind: 'WEEKLY', status: 'DISPATCHED', scheduledAt: { gte: since }, payload: { path: '$.variant', equals: 'NUDGE' } },
      select: { id: true },
    });
    return row !== null;
  }

  /** 팀의 기념일 (알림 시점 설정과 무관, #277). (#305) 이 팀에 보이는 멤버 생일을 "지민 생일" 매년 기념일로 뒤에 붙인다 */
  async listGroupAnniversaries(groupId: number): Promise<(AnniversaryLike & { name: string })[]> {
    const [rows, birthdays] = await Promise.all([
      this.prisma.anniversary.findMany({ where: { groupId }, select: { name: true, date: true, kind: true }, orderBy: { id: 'asc' } }),
      this.prisma.membership.findMany({
        where: { groupId, showBirthday: true, user: { birthday: { not: null } } },
        select: { displayName: true, user: { select: { nickname: true, birthday: true } } },
        orderBy: { joinedAt: 'asc' },
      }),
    ]);
    return [
      ...rows.map((row) => ({ ...row, date: dbToDate(row.date) })),
      ...birthdays.map((row) => ({ ...birthdayAnniversary(row.user.birthday!), name: birthdayTitle(row.displayName ?? row.user.nickname) })),
    ];
  }

  /**
   * 멤버들이 속한 모든 팀(개인 팀 포함, D-14)의 종일이 아닌 바쁜 구간 (빈 시간 찾기와 같은 범위).
   * 반복은 원본 + 예외 (예외가 종일로 바꿀 수 있어 종일 제외는 펼친 뒤 호출자가)
   */
  async listWeeklyBusy(memberIds: number[], from: Date, to: Date): Promise<{ once: WeeklyBusyRow[]; series: WeeklyBusySeries[] }> {
    if (memberIds.length === 0) return { once: [], series: [] };
    const groups = await this.prisma.membership.findMany({ where: { userId: { in: memberIds } }, select: { groupId: true }, distinct: ['groupId'] });
    const groupIds = groups.map((row) => row.groupId);
    const window = seriesCandidateWindow(from, to);
    const [once, series] = await Promise.all([
      this.prisma.event.findMany({
        where: { groupId: { in: groupIds }, repeat: null, allDay: false, startsAt: { lt: to }, endsAt: { gt: from } },
        select: { startsAt: true, endsAt: true, ...BUSY_SELECT },
        orderBy: { startsAt: 'asc' },
      }),
      this.prisma.event.findMany({
        where: {
          groupId: { in: groupIds },
          repeat: { not: null },
          startsAt: { lt: window.startsBefore },
          OR: [{ repeatUntil: null }, { repeatUntil: { gte: dateToDb(window.untilOnOrAfter) } }],
        },
        select: {
          startsAt: true,
          endsAt: true,
          allDay: true,
          repeat: true,
          repeatUntil: true,
          repeatAnchor: true,
          exceptions: { select: { occurrence: true, cancelled: true, startsAt: true, endsAt: true, allDay: true } },
          ...BUSY_SELECT,
        },
      }),
    ]);
    return {
      once: once.map(({ participants, ...row }) => ({ ...row, participantIds: idsOf(participants) })),
      series: series.map(({ participants, ...row }) => ({
        ...row,
        participantIds: idsOf(participants),
        repeat: row.repeat as Repeat,
        repeatUntil: row.repeatUntil === null ? null : dbToDate(row.repeatUntil),
        repeatAnchor: row.repeatAnchor === null ? null : dbToDate(row.repeatAnchor),
        exceptions: row.exceptions.map((exception) => ({ ...exception, occurrence: dbToDate(exception.occurrence) })),
      })),
    };
  }

  /** (#277) PENDING 인 것만 CANCELLED (주간 알림을 보내지 않기로 판정) */
  async markCancelled(ids: number[]): Promise<number> {
    if (ids.length === 0) return 0;
    const { count } = await this.prisma.pushNotification.updateMany({ where: { id: { in: ids }, status: 'PENDING' }, data: { status: 'CANCELLED' } });
    return count;
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
    return rows.map((row) => ({ ...row, occurrence: row.occurrence === null ? null : dbToDate(row.occurrence), payload: asPayload(row.payload) }));
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
   * (#297) joinedBy 를 주면 그 시각까지 들어와 있던 팀원만 (joinedAt <= joinedBy). 지난 일을 알리는 CHANGE, JOIN 용 (D-180).
   * (#277) setting 은 푸시 종류와 같은 이름의 알림 종류 대신 볼 설정 (WEEKLY NUDGE 는 WEEKLY_NUDGE, D-204). (#369) 행이 없으면 기본값 (D-249)
   */
  async listRecipients(
    groupId: number,
    kind: PushKindName,
    excludeUserId: number | null,
    eventId: number | null = null,
    joinedBy: Date | null = null,
    setting: SettingKind = kind,
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
        user: preferenceOn(setting),
        ...(excludeUserId === null ? {} : { userId: { not: excludeUserId } }),
        ...(participantIds === null ? {} : { AND: [{ userId: { in: participantIds } }] }),
        ...(joinedBy === null ? {} : { joinedAt: { lte: joinedBy } }),
      },
      select: { userId: true, user: { select: { pushDevices: { select: { token: true, platform: true } } } } },
    });
    return rows.flatMap((row) => row.user.pushDevices.map((device) => ({ userId: row.userId, token: device.token, platform: device.platform })));
  }

  /**
   * (#190) 일정 알림에서 그 회차에 불참으로 답한 사람을 뺀다 (Q3, D-228). 한 번짜리는 회차 = 시작 KST 날짜.
   * 미정, 응답 안 함은 그대로 받는다. 일정이 없으면 그대로 돌려준다 (받는 사람 계산이 이미 0명)
   */
  async withoutNotGoing(recipients: Recipient[], eventId: number, occurrence: string | null): Promise<Recipient[]> {
    if (recipients.length === 0) return recipients;
    let date = occurrence;
    if (date === null) {
      const event = await this.prisma.event.findUnique({ where: { id: eventId }, select: { startsAt: true } });
      if (!event) return recipients;
      date = kstDate(event.startsAt);
    }
    const rows = await this.prisma.eventRsvp.findMany({
      where: { eventId, occurrence: dateToDb(date), status: 'NOT_GOING', userId: { in: [...new Set(recipients.map((r) => r.userId))] } },
      select: { userId: true },
    });
    if (rows.length === 0) return recipients;
    const out = new Set(rows.map((row) => row.userId));
    return recipients.filter((recipient) => !out.has(recipient.userId));
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
