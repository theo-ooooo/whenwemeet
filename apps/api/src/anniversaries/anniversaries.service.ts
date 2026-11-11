import { Injectable } from '@nestjs/common';
import { AnniversaryKind } from '../generated/prisma/enums.js';
import { ApiException } from '../common/errors.js';
import { Member, MemberResolver } from '../common/member.js';
import { type ActivityActor, snapshotName } from '../group-activities/activity.js';
import { MembershipService } from '../groups/membership.service.js';
import { AnniversariesRepository, AnniversaryRow } from './anniversaries.repository.js';
import {
  type AnniversaryReminder,
  DEFAULT_ANNIVERSARY_REMINDERS,
  fromReminderFlags,
  toReminderFlags,
} from './anniversary-reminders.js';
import type { CreateAnniversaryDto, UpdateAnniversaryDto } from './dto/anniversary.dto.js';

export interface AnniversaryView {
  id: number;
  groupId: number;
  name: string;
  /** `YYYY-MM-DD` (KST 달력 날짜, 결정기록 D-17) */
  date: string;
  /** 자동 표시 종류 (#105, D-62) */
  kind: AnniversaryKind;
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

export function toAnniversaryView(row: AnniversaryRow, resolver: MemberResolver): AnniversaryView {
  return {
    id: row.id,
    groupId: row.groupId,
    name: row.name,
    date: dbToDateString(row.date),
    kind: row.kind,
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
  async create(userId: number, groupId: number, dto: CreateAnniversaryDto): Promise<AnniversaryView> {
    const actor = await this.actorOf(userId, groupId);
    const row = await this.anniversaries.createWithActivityTx({
      groupId,
      name: dto.name,
      date: dateStringToDb(dto.date),
      kind: dto.kind ?? AnniversaryKind.COUNT_UP,
      ...toReminderFlags(dto.reminders ?? DEFAULT_ANNIVERSARY_REMINDERS),
      creatorId: userId,
    }, actor);
    const resolver = await this.memberships.resolverFor(groupId);
    return toAnniversaryView(row, resolver);
  }

  async update(userId: number, groupId: number, anniversaryId: number, dto: UpdateAnniversaryDto): Promise<AnniversaryView> {
    const actor = await this.actorOf(userId, groupId);
    await this.assertInGroup(groupId, anniversaryId);
    const row = await this.anniversaries.updateWithActivityTx(anniversaryId, {
      ...(dto.name !== undefined ? { name: dto.name } : {}),
      ...(dto.date !== undefined ? { date: dateStringToDb(dto.date) } : {}),
      ...(dto.kind !== undefined ? { kind: dto.kind } : {}),
      ...(dto.reminders !== undefined ? toReminderFlags(dto.reminders) : {}),
    }, actor);
    const resolver = await this.memberships.resolverFor(groupId);
    return toAnniversaryView(row, resolver);
  }

  async remove(userId: number, groupId: number, anniversaryId: number): Promise<{ ok: true }> {
    const actor = await this.actorOf(userId, groupId);
    await this.assertInGroup(groupId, anniversaryId);
    await this.anniversaries.deleteWithActivityTx(anniversaryId, actor);
    return { ok: true };
  }

  /** 멤버십 확인 + 새 소식 기록용 이름 스냅샷 (팀 표시 이름 ?? 닉네임, D-152) */
  private async actorOf(userId: number, groupId: number): Promise<ActivityActor> {
    const me = await this.memberships.assertMember(userId, groupId);
    return { id: userId, name: snapshotName(me.displayName, me.user.nickname) };
  }

  /** 다른 팀 자원을 가리키는 ID 도 NOT_FOUND */
  private async assertInGroup(groupId: number, anniversaryId: number): Promise<void> {
    const row = await this.anniversaries.findIdInGroup(groupId, anniversaryId);
    if (!row) throw new ApiException('NOT_FOUND', '기념일을 찾을 수 없어요');
  }
}
