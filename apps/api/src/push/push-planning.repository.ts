import { Injectable } from '@nestjs/common';
import { type ExceptionRule, type SeriesRule, seriesCandidateWindow, type Repeat } from '../events/recurrence.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AnniversaryKind, AnniversaryLike } from './anniversary-items.js';
import type { EventReminder } from './remind-at.js';
import { type AnniversaryReminderFlags, flagsFromRows, REMINDER_ROWS_SELECT } from '../anniversaries/anniversary-reminders.js';
import { preferenceOn } from '../notification-preferences/notification-preferences.js';
import { birthdayAnniversary, birthdayTitle } from '../anniversaries/birthdays.js';
import { dateToDb, dbToDate, idsOf } from './push-db.js';

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

const BUSY_SELECT = { allMembers: true, participants: { select: { userId: true } } } as const;

const ACTIVE_REMINDERS: EventReminder[] = ['AT_START', 'MIN_10', 'HOUR_1', 'DAY_1', 'DAY_OF_0900', 'DAY_BEFORE_0900'];

/** 예약 계산 재료를 읽는 저장소 (#188, #485). 일정 알림, 기념일과 생일, 투표 마감, (#277) 주간 요약과 깨우기 */
@Injectable()
export class PushPlanningRepository {
  constructor(private readonly prisma: PrismaService) {}

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

  // ---------- (#189) 약속 투표 (설계 약속-투표.md 6장, D-241) ----------

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
}
