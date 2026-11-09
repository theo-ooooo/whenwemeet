import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

export const ANNIVERSARY_SELECT = {
  id: true,
  groupId: true,
  name: true,
  date: true,
  creatorId: true,
  createdAt: true,
  creator: { select: { nickname: true, profileImageUrl: true } },
} as const;

export interface AnniversaryRow {
  id: string;
  groupId: string;
  name: string;
  date: Date;
  creatorId: string | null;
  createdAt: Date;
  creator: { nickname: string; profileImageUrl: string | null } | null;
}

export interface AnniversaryCreateInput {
  groupId: string;
  name: string;
  date: Date;
  creatorId: string;
}

export interface AnniversaryUpdateInput {
  name?: string;
  date?: Date;
}

@Injectable()
export class AnniversariesRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** date 오름차순, 같은 날은 만든 순 */
  listByGroup(groupId: string): Promise<AnniversaryRow[]> {
    return this.prisma.anniversary.findMany({
      where: { groupId },
      orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
      select: ANNIVERSARY_SELECT,
    });
  }

  /** 다른 팀 자원을 가리키는 ID 는 null */
  findIdInGroup(groupId: string, anniversaryId: string): Promise<{ id: string } | null> {
    return this.prisma.anniversary.findFirst({ where: { id: anniversaryId, groupId }, select: { id: true } });
  }

  create(data: AnniversaryCreateInput): Promise<AnniversaryRow> {
    return this.prisma.anniversary.create({ data, select: ANNIVERSARY_SELECT });
  }

  update(anniversaryId: string, data: AnniversaryUpdateInput): Promise<AnniversaryRow> {
    return this.prisma.anniversary.update({ where: { id: anniversaryId }, data, select: ANNIVERSARY_SELECT });
  }

  async delete(anniversaryId: string): Promise<void> {
    await this.prisma.anniversary.delete({ where: { id: anniversaryId } });
  }
}
