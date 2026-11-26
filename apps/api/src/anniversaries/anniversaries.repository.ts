import { Injectable } from '@nestjs/common';
import type {
  AnniversaryKind,
  CalendarType,
} from '../generated/prisma/enums.js';
import {
  toUserRowOrNull,
  USER_PUBLIC_SELECT,
  type UserPublicRecord,
  type UserRow,
} from '../common/member.js';
import {
  type AnniversaryReminder,
  type AnniversaryReminderFlags,
  flagsFromRows,
  REMINDER_ROWS_SELECT,
  rowsFromFlags,
} from './anniversary-reminders.js';
import { FileUrlBuilder } from '../files/file-url.builder.js';
import {
  type ActivityActor,
  ANNIVERSARY_UNDO_WINDOW_MS,
  anniversaryUpdatedPayload,
  type AnniversaryValues,
  isSameAnniversary,
  pickValues,
} from '../group-activities/activity.js';
import { GroupActivitiesRepository } from '../group-activities/group-activities.repository.js';
import { PrismaService } from '../prisma/prisma.service.js';

export const ANNIVERSARY_SELECT = {
  id: true,
  groupId: true,
  name: true,
  date: true,
  kind: true,
  /** (#562) 음력 여부와 윤달 */
  calendar: true,
  isLeapMonth: true,
  /** (#369) 켜진 알림 시점 (행 → 칸 모양은 toAnniversaryRow) */
  reminders: REMINDER_ROWS_SELECT,
  creatorId: true,
  createdAt: true,
  creator: USER_PUBLIC_SELECT,
} as const;

export interface AnniversaryRow extends AnniversaryReminderFlags {
  id: number;
  groupId: number;
  name: string;
  date: Date;
  kind: AnniversaryKind;
  calendar: CalendarType;
  isLeapMonth: boolean;
  creatorId: number | null;
  createdAt: Date;
  creator: UserRow | null;
}

type AnniversaryRecord = Omit<
  AnniversaryRow,
  'creator' | keyof AnniversaryReminderFlags
> & {
  creator: UserPublicRecord | null;
  reminders: { offset: AnniversaryReminder }[];
};

function toAnniversaryRow(
  { reminders, ...record }: AnniversaryRecord,
  urls: FileUrlBuilder,
): AnniversaryRow {
  return {
    ...record,
    ...flagsFromRows(reminders),
    creator: toUserRowOrNull(record.creator, urls),
  };
}

/**
 * (#369) 알림 시점 칸 → 자식 행 쓰기. 수정에서 시점을 주면 통째로 바꾼다.
 * 기념일 updatedAt 은 전처럼 수정 요청마다 바뀐다(알림 예약의 개정 규칙이 본다): 시점만 바꿔도 부모 행을 고친다
 */
function splitReminders<T extends Partial<AnniversaryReminderFlags>>(data: T) {
  const { remindDayOf, remindDayBefore, remindWeekBefore, ...rest } = data;
  const given =
    remindDayOf !== undefined ||
    remindDayBefore !== undefined ||
    remindWeekBefore !== undefined;
  const flags = {
    remindDayOf: remindDayOf ?? false,
    remindDayBefore: remindDayBefore ?? false,
    remindWeekBefore: remindWeekBefore ?? false,
  };
  return { rest, rows: given ? rowsFromFlags(flags) : null };
}

export interface AnniversaryCreateInput extends AnniversaryReminderFlags {
  groupId: number;
  name: string;
  date: Date;
  kind: AnniversaryKind;
  calendar: CalendarType;
  isLeapMonth: boolean;
  creatorId: number;
}

export interface AnniversaryUpdateInput extends Partial<AnniversaryReminderFlags> {
  name?: string;
  date?: Date;
  kind?: AnniversaryKind;
  calendar?: CalendarType;
  isLeapMonth?: boolean;
}

@Injectable()
export class AnniversariesRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly urls: FileUrlBuilder,
    private readonly activities: GroupActivitiesRepository,
  ) {}

  /** date 오름차순, 같은 날은 만든 순 */
  async listByGroup(groupId: number): Promise<AnniversaryRow[]> {
    const rows = await this.prisma.anniversary.findMany({
      where: { groupId },
      orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
      select: ANNIVERSARY_SELECT,
    });
    return rows.map((row) => toAnniversaryRow(row, this.urls));
  }

  /** (#193) 구독 피드용: 항목 계산에 필요한 값과 마지막 개정 시각만 */
  async listForFeed(groupId: number): Promise<
    {
      id: number;
      name: string;
      date: string;
      kind: AnniversaryKind;
      calendar: CalendarType;
      isLeapMonth: boolean;
      updatedAt: Date;
    }[]
  > {
    const rows = await this.prisma.anniversary.findMany({
      where: { groupId },
      orderBy: [{ date: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        name: true,
        date: true,
        kind: true,
        calendar: true,
        isLeapMonth: true,
        updatedAt: true,
      },
    });
    return rows.map((row) => ({
      ...row,
      date: row.date.toISOString().slice(0, 10),
    }));
  }

  /** 다른 팀 자원을 가리키는 ID 는 null. (#562) 수정 검증에 쓰는 날짜, 달력 종류, 윤달도 함께 */
  findIdInGroup(
    groupId: number,
    anniversaryId: number,
  ): Promise<{
    id: number;
    date: Date;
    calendar: CalendarType;
    isLeapMonth: boolean;
  } | null> {
    return this.prisma.anniversary.findFirst({
      where: { id: anniversaryId, groupId },
      select: { id: true, date: true, calendar: true, isLeapMonth: true },
    });
  }

  /**
   * 기념일 추가 + 새 소식 기록 (#191) 한 트랜잭션.
   * 같은 사람이 60초 안에 지운 기념일을 같은 이름, 날짜, 종류로 다시 추가하면(되돌리기 토스트) 그 삭제 기록을 지우고
   * 추가 기록을 남기지 않는다 (D-153)
   */
  async createWithActivityTx(
    data: AnniversaryCreateInput,
    actor: ActivityActor,
    now: Date = new Date(),
  ): Promise<AnniversaryRow> {
    const row = await this.prisma.$transaction(async (tx) => {
      const { rest, rows } = splitReminders(data);
      const created = await tx.anniversary.create({
        data: { ...rest, reminders: { create: rows ?? [] } },
        select: ANNIVERSARY_SELECT,
      });
      const values = valuesOf(created);
      const since = new Date(now.getTime() - ANNIVERSARY_UNDO_WINDOW_MS);
      const deletions = await this.activities.listAnniversaryDeletionsTx(
        tx,
        data.groupId,
        actor.id,
        since,
      );
      const undone = deletions.find((deletion) =>
        isSameAnniversary(deletion.payload, values),
      );
      if (undone) await this.activities.deleteTx(tx, undone.id);
      else
        await this.activities.recordTx(tx, {
          groupId: data.groupId,
          type: 'ANNIVERSARY_CREATED',
          actor,
          anniversaryId: created.id,
          payload: values,
        });
      return created;
    });
    return toAnniversaryRow(row, this.urls);
  }

  /** 기념일 수정 + 이름, 날짜, 종류가 실제로 바뀐 경우만 새 소식 기록 (#191) 한 트랜잭션 */
  async updateWithActivityTx(
    anniversaryId: number,
    data: AnniversaryUpdateInput,
    actor: ActivityActor,
  ): Promise<AnniversaryRow> {
    const row = await this.prisma.$transaction(async (tx) => {
      const before = await tx.anniversary.findUniqueOrThrow({
        where: { id: anniversaryId },
        select: {
          name: true,
          date: true,
          kind: true,
          calendar: true,
          isLeapMonth: true,
        },
      });
      const { rest, rows } = splitReminders(data);
      const updated = await tx.anniversary.update({
        where: { id: anniversaryId },
        data: {
          ...rest,
          updatedAt: new Date(),
          ...(rows ? { reminders: { deleteMany: {}, create: rows } } : {}),
        },
        select: ANNIVERSARY_SELECT,
      });
      const payload = anniversaryUpdatedPayload(
        valuesOf(before),
        valuesOf(updated),
      );
      if (payload)
        await this.activities.recordTx(tx, {
          groupId: updated.groupId,
          type: 'ANNIVERSARY_UPDATED',
          actor,
          anniversaryId,
          payload,
        });
      return updated;
    });
    return toAnniversaryRow(row, this.urls);
  }

  /** 기념일 삭제 + 삭제 전 값으로 새 소식 기록 (#191) 한 트랜잭션. 기록의 anniversaryId 는 비운다 */
  async deleteWithActivityTx(
    anniversaryId: number,
    actor: ActivityActor,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const removed = await tx.anniversary.delete({
        where: { id: anniversaryId },
        select: {
          groupId: true,
          name: true,
          date: true,
          kind: true,
          calendar: true,
          isLeapMonth: true,
        },
      });
      await this.activities.recordTx(tx, {
        groupId: removed.groupId,
        type: 'ANNIVERSARY_DELETED',
        actor,
        anniversaryId: null,
        payload: valuesOf(removed),
      });
    });
  }
}

/** 새 소식 기록용 값. 날짜는 'YYYY-MM-DD' (@db.Date 는 UTC 자정). (#562) 음력이면 calendar, 윤달 키를 싣는다 */
function valuesOf(row: {
  name: string;
  date: Date;
  kind: AnniversaryKind;
  calendar: CalendarType;
  isLeapMonth: boolean;
}): AnniversaryValues {
  return pickValues({
    name: row.name,
    date: row.date.toISOString().slice(0, 10),
    kind: row.kind,
    ...(row.calendar === 'LUNAR' ? { calendar: 'LUNAR' as const } : {}),
    ...(row.calendar === 'LUNAR' && row.isLeapMonth
      ? { isLeapMonth: true as const }
      : {}),
  });
}
