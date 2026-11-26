import { Injectable } from '@nestjs/common';
import {
  AnniversaryKind,
  type CalendarType,
} from '../generated/prisma/enums.js';
import { ApiException } from '../common/errors.js';
import { isLunarDate } from '../common/lunar.js';
import { isCalendarDate } from '../common/validation.js';
import { Member, MemberResolver } from '../common/member.js';
import {
  type ActivityActor,
  snapshotName,
} from '../group-activities/activity.js';
import { MembershipService } from '../groups/membership.service.js';
import {
  AnniversariesRepository,
  AnniversaryRow,
} from './anniversaries.repository.js';
import {
  type AnniversaryReminder,
  DEFAULT_ANNIVERSARY_REMINDERS,
  fromReminderFlags,
  toReminderFlags,
} from './anniversary-reminders.js';
import type {
  CreateAnniversaryDto,
  UpdateAnniversaryDto,
} from './dto/anniversary.dto.js';

export interface AnniversaryView {
  id: number;
  groupId: number;
  name: string;
  /** `YYYY-MM-DD` (KST 달력 날짜, 결정기록 D-17) */
  date: string;
  /** 자동 표시 종류 (#105, D-62) */
  kind: AnniversaryKind;
  /** (#562) 달력 종류. LUNAR 면 date 가 음력 연월일 (D-297) */
  calendar: CalendarType;
  /** (#562) 음력 윤달 */
  isLeapMonth: boolean;
  /** (#269) 알림 시점. 당일, 하루 전, 일주일 전 순, `[]` = 알림 없음 */
  reminders: AnniversaryReminder[];
  creator: Member;
  createdAt: Date;
}

/** `YYYY-MM-DD` ↔ `@db.Date`. 시각 없는 값이라 UTC 자정으로 고정해 날짜가 밀리지 않게 한다 */
export function dateStringToDb(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

export function dbToDateString(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function invalid(field: string, message: string): ApiException {
  return new ApiException('VALIDATION_FAILED', message, [{ field, message }]);
}

/**
 * (#562, D-297) 날짜, 달력 종류, 윤달의 짝 검사. 양력은 실제 날짜이고 윤달 없음, 음력은 그 해에 정말 있는 음력 날짜
 * (윤달이면 그 해에 그 윤달이 있어야 하고, 29일 달의 30일은 안 된다). 변환표 범위(음력 1000~2050년) 밖도 막는다
 */
export function assertAnniversaryDate(
  date: string,
  calendar: CalendarType,
  isLeapMonth: boolean,
): void {
  if (calendar === 'SOLAR') {
    if (!isCalendarDate(date))
      throw invalid('date', '날짜는 YYYY-MM-DD 형식의 실제 날짜여야 해요');
    if (isLeapMonth)
      throw invalid('isLeapMonth', '윤달은 음력 날짜에만 고를 수 있어요');
    return;
  }
  const [year, month, day] = date.split('-').map(Number);
  if (isLunarDate({ year, month, day, leap: isLeapMonth })) return;
  if (year < 1000 || year > 2050)
    throw invalid('date', '음력은 2050년까지만 넣을 수 있어요');
  if (isLeapMonth && !isLunarDate({ year, month, day: 1, leap: true }))
    throw invalid('isLeapMonth', '그 해에는 그 달의 윤달이 없어요');
  throw invalid('date', '그 해 음력에 없는 날짜예요');
}

export function toAnniversaryView(
  row: AnniversaryRow,
  resolver: MemberResolver,
): AnniversaryView {
  return {
    id: row.id,
    groupId: row.groupId,
    name: row.name,
    date: dbToDateString(row.date),
    kind: row.kind,
    calendar: row.calendar,
    isLeapMonth: row.isLeapMonth,
    reminders: fromReminderFlags(row),
    creator: resolver.resolve(row.creatorId, row.creator),
    createdAt: row.createdAt,
  };
}

@Injectable()
export class AnniversariesService {
  constructor(
    private readonly anniversaries: AnniversariesRepository,
    private readonly memberships: MembershipService,
  ) {}

  async list(userId: number, groupId: number): Promise<AnniversaryView[]> {
    await this.memberships.assertMember(userId, groupId);
    const rows = await this.anniversaries.listByGroup(groupId);
    const resolver = await this.memberships.resolverFor(groupId);
    return rows.map((row) => toAnniversaryView(row, resolver));
  }

  /** 추가, 수정, 삭제는 새 소식에 남는다 (#191, 기록 규칙은 Repository 의 `...WithActivityTx`) */
  async create(
    userId: number,
    groupId: number,
    dto: CreateAnniversaryDto,
  ): Promise<AnniversaryView> {
    const actor = await this.actorOf(userId, groupId);
    const calendar = dto.calendar ?? 'SOLAR';
    const isLeapMonth = dto.isLeapMonth ?? false;
    assertAnniversaryDate(dto.date, calendar, isLeapMonth);
    const row = await this.anniversaries.createWithActivityTx(
      {
        groupId,
        name: dto.name,
        date: dateStringToDb(dto.date),
        kind: dto.kind ?? AnniversaryKind.COUNT_UP,
        calendar,
        isLeapMonth,
        ...toReminderFlags(dto.reminders ?? DEFAULT_ANNIVERSARY_REMINDERS),
        creatorId: userId,
      },
      actor,
    );
    const resolver = await this.memberships.resolverFor(groupId);
    return toAnniversaryView(row, resolver);
  }

  async update(
    userId: number,
    groupId: number,
    anniversaryId: number,
    dto: UpdateAnniversaryDto,
  ): Promise<AnniversaryView> {
    const actor = await this.actorOf(userId, groupId);
    const current = await this.assertInGroup(groupId, anniversaryId);
    // (#562) 날짜, 달력 종류, 윤달 중 하나라도 오면 합친 값으로 다시 검사한다. 양력으로 바꾸면 윤달은 끈다
    const dateGiven =
      dto.date !== undefined ||
      dto.calendar !== undefined ||
      dto.isLeapMonth !== undefined;
    const calendar = dto.calendar ?? current.calendar;
    const isLeapMonth =
      calendar === 'SOLAR' && dto.isLeapMonth === undefined
        ? false
        : (dto.isLeapMonth ?? current.isLeapMonth);
    if (dateGiven)
      assertAnniversaryDate(
        dto.date ?? dbToDateString(current.date),
        calendar,
        isLeapMonth,
      );
    const row = await this.anniversaries.updateWithActivityTx(
      anniversaryId,
      {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.date !== undefined ? { date: dateStringToDb(dto.date) } : {}),
        ...(dto.kind !== undefined ? { kind: dto.kind } : {}),
        ...(dateGiven ? { calendar, isLeapMonth } : {}),
        ...(dto.reminders !== undefined ? toReminderFlags(dto.reminders) : {}),
      },
      actor,
    );
    const resolver = await this.memberships.resolverFor(groupId);
    return toAnniversaryView(row, resolver);
  }

  async remove(
    userId: number,
    groupId: number,
    anniversaryId: number,
  ): Promise<{ ok: true }> {
    const actor = await this.actorOf(userId, groupId);
    await this.assertInGroup(groupId, anniversaryId);
    await this.anniversaries.deleteWithActivityTx(anniversaryId, actor);
    return { ok: true };
  }

  /** 멤버십 확인 + 새 소식 기록용 이름 스냅샷 (팀 표시 이름 ?? 닉네임, D-152) */
  private async actorOf(
    userId: number,
    groupId: number,
  ): Promise<ActivityActor> {
    const me = await this.memberships.assertMember(userId, groupId);
    return { id: userId, name: snapshotName(me.displayName, me.user.nickname) };
  }

  /** 다른 팀 자원을 가리키는 ID 도 NOT_FOUND */
  private async assertInGroup(
    groupId: number,
    anniversaryId: number,
  ): Promise<{ date: Date; calendar: CalendarType; isLeapMonth: boolean }> {
    const row = await this.anniversaries.findIdInGroup(groupId, anniversaryId);
    if (!row) throw new ApiException('NOT_FOUND', '기념일을 찾을 수 없어요');
    return row;
  }
}
