import { Injectable } from '@nestjs/common';
import { ApiException } from '../common/errors.js';
import { Member, MemberResolver } from '../common/member.js';
import { Db, MembershipService } from '../groups/membership.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { CreateAnniversaryDto, UpdateAnniversaryDto } from './dto/anniversary.dto.js';

const ANNIVERSARY_SELECT = {
  id: true,
  groupId: true,
  name: true,
  date: true,
  creatorId: true,
  createdAt: true,
  creator: { select: { nickname: true, profileImageUrl: true } },
} as const;

type AnniversaryRow = {
  id: string;
  groupId: string;
  name: string;
  date: Date;
  creatorId: string | null;
  createdAt: Date;
  creator: { nickname: string; profileImageUrl: string | null } | null;
};

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
    private readonly prisma: PrismaService,
    private readonly memberships: MembershipService,
  ) {}

  async list(userId: string, groupId: string): Promise<AnniversaryView[]> {
    await this.memberships.assertMember(userId, groupId);
    const rows = await this.prisma.anniversary.findMany({
      where: { groupId },
      orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
      select: ANNIVERSARY_SELECT,
    });
    const resolver = await this.memberships.resolverFor(groupId);
    return rows.map((row) => toAnniversaryView(row, resolver));
  }

  async create(userId: string, groupId: string, dto: CreateAnniversaryDto): Promise<AnniversaryView> {
    await this.memberships.assertMember(userId, groupId);
    const row = await this.prisma.anniversary.create({
      data: { groupId, name: dto.name, date: dateStringToDb(dto.date), creatorId: userId },
      select: ANNIVERSARY_SELECT,
    });
    const resolver = await this.memberships.resolverFor(groupId);
    return toAnniversaryView(row, resolver);
  }

  async update(userId: string, groupId: string, anniversaryId: string, dto: UpdateAnniversaryDto): Promise<AnniversaryView> {
    await this.memberships.assertMember(userId, groupId);
    await this.findInGroup(this.prisma, groupId, anniversaryId);
    const row = await this.prisma.anniversary.update({
      where: { id: anniversaryId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.date !== undefined ? { date: dateStringToDb(dto.date) } : {}),
      },
      select: ANNIVERSARY_SELECT,
    });
    const resolver = await this.memberships.resolverFor(groupId);
    return toAnniversaryView(row, resolver);
  }

  async remove(userId: string, groupId: string, anniversaryId: string): Promise<{ ok: true }> {
    await this.memberships.assertMember(userId, groupId);
    await this.findInGroup(this.prisma, groupId, anniversaryId);
    await this.prisma.anniversary.delete({ where: { id: anniversaryId } });
    return { ok: true };
  }

  private async findInGroup(db: Db, groupId: string, anniversaryId: string): Promise<{ id: string }> {
    const row = await db.anniversary.findFirst({ where: { id: anniversaryId, groupId }, select: { id: true } });
    if (!row) throw new ApiException('NOT_FOUND', '기념일을 찾을 수 없어요');
    return row;
  }
}
