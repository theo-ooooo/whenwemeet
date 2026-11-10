import { Injectable } from '@nestjs/common';
import { toUserRowOrNull, USER_PUBLIC_SELECT, type UserPublicRecord, type UserRow } from '../common/member.js';
import { PrismaService } from '../prisma/prisma.service.js';

export const ANNIVERSARY_SELECT = {
  id: true,
  groupId: true,
  name: true,
  date: true,
  creatorId: true,
  createdAt: true,
  creator: USER_PUBLIC_SELECT,
} as const;

export interface AnniversaryRow {
  id: number;
  groupId: number;
  name: string;
  date: Date;
  creatorId: number | null;
  createdAt: Date;
  creator: UserRow | null;
}

type AnniversaryRecord = Omit<AnniversaryRow, 'creator'> & { creator: UserPublicRecord | null };

function toAnniversaryRow(record: AnniversaryRecord): AnniversaryRow {
  return { ...record, creator: toUserRowOrNull(record.creator) };
}

export interface AnniversaryCreateInput {
  groupId: number;
  name: string;
  date: Date;
  creatorId: number;
}

export interface AnniversaryUpdateInput {
  name?: string;
  date?: Date;
}

@Injectable()
export class AnniversariesRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** date 오름차순, 같은 날은 만든 순 */
  async listByGroup(groupId: number): Promise<AnniversaryRow[]> {
    const rows = await this.prisma.anniversary.findMany({
      where: { groupId },
      orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
      select: ANNIVERSARY_SELECT,
    });
    return rows.map(toAnniversaryRow);
  }

  /** 다른 팀 자원을 가리키는 ID 는 null */
  findIdInGroup(groupId: number, anniversaryId: number): Promise<{ id: number } | null> {
    return this.prisma.anniversary.findFirst({ where: { id: anniversaryId, groupId }, select: { id: true } });
  }

  async create(data: AnniversaryCreateInput): Promise<AnniversaryRow> {
    return toAnniversaryRow(await this.prisma.anniversary.create({ data, select: ANNIVERSARY_SELECT }));
  }

  async update(anniversaryId: number, data: AnniversaryUpdateInput): Promise<AnniversaryRow> {
    return toAnniversaryRow(await this.prisma.anniversary.update({ where: { id: anniversaryId }, data, select: ANNIVERSARY_SELECT }));
  }

  async delete(anniversaryId: number): Promise<void> {
    await this.prisma.anniversary.delete({ where: { id: anniversaryId } });
  }
}
