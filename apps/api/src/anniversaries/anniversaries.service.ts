import { Injectable } from '@nestjs/common';
import { ApiException } from '../common/errors.js';
import { Member, MemberResolver } from '../common/member.js';
import { MembershipService } from '../groups/membership.service.js';
import { AnniversariesRepository, AnniversaryRow } from './anniversaries.repository.js';
import type { CreateAnniversaryDto, UpdateAnniversaryDto } from './dto/anniversary.dto.js';

export interface AnniversaryView {
  id: string;
  groupId: string;
  name: string;
  /** `YYYY-MM-DD` (KST 달력 날짜, 결정기록 D-17) */
  date: string;
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

  async list(userId: string, groupId: string): Promise<AnniversaryView[]> {
    await this.memberships.assertMember(userId, groupId);
    const rows = await this.anniversaries.listByGroup(groupId);
    const resolver = await this.memberships.resolverFor(groupId);
    return rows.map((row) => toAnniversaryView(row, resolver));
  }

  async create(userId: string, groupId: string, dto: CreateAnniversaryDto): Promise<AnniversaryView> {
    await this.memberships.assertMember(userId, groupId);
    const row = await this.anniversaries.create({ groupId, name: dto.name, date: dateStringToDb(dto.date), creatorId: userId });
    const resolver = await this.memberships.resolverFor(groupId);
    return toAnniversaryView(row, resolver);
  }

  async update(userId: string, groupId: string, anniversaryId: string, dto: UpdateAnniversaryDto): Promise<AnniversaryView> {
    await this.memberships.assertMember(userId, groupId);
    await this.assertInGroup(groupId, anniversaryId);
    const row = await this.anniversaries.update(anniversaryId, {
      ...(dto.name !== undefined ? { name: dto.name } : {}),
      ...(dto.date !== undefined ? { date: dateStringToDb(dto.date) } : {}),
    });
    const resolver = await this.memberships.resolverFor(groupId);
    return toAnniversaryView(row, resolver);
  }

  async remove(userId: string, groupId: string, anniversaryId: string): Promise<{ ok: true }> {
    await this.memberships.assertMember(userId, groupId);
    await this.assertInGroup(groupId, anniversaryId);
    await this.anniversaries.delete(anniversaryId);
    return { ok: true };
  }

  /** 다른 팀 자원을 가리키는 ID 도 NOT_FOUND */
  private async assertInGroup(groupId: string, anniversaryId: string): Promise<void> {
    const row = await this.anniversaries.findIdInGroup(groupId, anniversaryId);
    if (!row) throw new ApiException('NOT_FOUND', '기념일을 찾을 수 없어요');
  }
}
