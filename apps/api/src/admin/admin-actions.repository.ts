import { Injectable } from '@nestjs/common';
import type { AdminActionType, AdminTargetType } from '../generated/prisma/enums.js';
import { PrismaService } from '../prisma/prisma.service.js';

/** (#515) 관리자 조치 기록 한 줄 (D-286). admin 은 탈퇴했으면 null */
export interface AdminActionRow {
  id: number;
  action: AdminActionType;
  targetType: AdminTargetType;
  targetId: number;
  reason: string | null;
  createdAt: Date;
  admin: { id: number; nickname: string } | null;
}

export interface AdminActionInput {
  adminId: number;
  action: AdminActionType;
  targetType: AdminTargetType;
  targetId: number;
  reason?: string | null;
}

const ACTION_SELECT = {
  id: true,
  action: true,
  targetType: true,
  targetId: true,
  reason: true,
  createdAt: true,
  admin: { select: { id: true, nickname: true } },
} as const;

/** (#515) 관리자 조치 기록 저장소. 쓰기는 조치가 성공한 뒤 한 줄, 읽기는 최근 것 먼저 */
@Injectable()
export class AdminActionsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async record(input: AdminActionInput): Promise<void> {
    await this.prisma.adminAction.create({ data: { ...input, reason: input.reason ?? null } });
  }

  /** id 내림차순. cursor 는 앞 페이지 마지막 id */
  async list({ limit, cursor }: { limit: number; cursor: number | null }): Promise<{ items: AdminActionRow[]; nextCursor: number | null }> {
    const rows = await this.prisma.adminAction.findMany({
      where: cursor !== null ? { id: { lt: cursor } } : {},
      orderBy: { id: 'desc' },
      take: limit + 1,
      select: ACTION_SELECT,
    });
    const items = rows.slice(0, limit);
    return { items, nextCursor: rows.length > limit ? items[items.length - 1].id : null };
  }
}
