import { Injectable } from '@nestjs/common';
import type { GroupType, ReportReason, ReportStatus, ReportTargetType } from '../generated/prisma/enums.js';
import { VISIBLE_EVENT_WHERE } from '../events/visible-event.js';
import { PrismaService } from '../prisma/prisma.service.js';

/** (#536) 신고 접수 결과 한 줄 (POST /reports 응답) */
export interface ReportReceipt {
  id: number;
  targetType: ReportTargetType;
  targetId: number;
  reason: ReportReason;
  status: ReportStatus;
  createdAt: Date;
}

export interface CreateReportInput {
  reporterId: number;
  targetType: ReportTargetType;
  targetId: number;
  reason: ReportReason;
  detail: string | null;
}

const RECEIPT_SELECT = { id: true, targetType: true, targetId: true, reason: true, status: true, createdAt: true } as const;

/**
 * (#536) 신고 접수 저장소 (D-289). 신고하는 사람이 대상을 볼 수 있는지 확인하는 조회와, 접수 중 중복을 막는 만들기.
 * 관리자 쪽 읽기와 처리는 admin/admin-reports.repository.ts
 */
@Injectable()
export class ReportsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** 내가 멤버인 팀이면 그 종류, 아니면 null (숨긴 팀도 멤버면 신고할 수 있다) */
  async findMemberGroupType(userId: number, groupId: number): Promise<GroupType | null> {
    const row = await this.prisma.membership.findUnique({ where: { userId_groupId: { userId, groupId } }, select: { group: { select: { type: true } } } });
    return row?.group.type ?? null;
  }

  /** 내가 멤버인 팀의 보이는 일정이면 만든 사람(탈퇴면 null), 아니면 undefined (숨긴 일정, 숨긴 팀의 일정은 없는 것과 같다) */
  async findVisibleEventCreator(userId: number, eventId: number): Promise<{ creatorId: number | null } | undefined> {
    const row = await this.prisma.event.findFirst({
      where: { id: eventId, ...VISIBLE_EVENT_WHERE, group: { hiddenAt: null, memberships: { some: { userId } } } },
      select: { creatorId: true },
    });
    return row ?? undefined;
  }

  /** 두 사람이 같은 팀에 함께 있는지 */
  async sharesGroup(userId: number, otherId: number): Promise<boolean> {
    const row = await this.prisma.membership.findFirst({ where: { userId: otherId, group: { memberships: { some: { userId } } } }, select: { id: true } });
    return row !== null;
  }

  /**
   * 신고 한 건. 같은 사람이 같은 대상을 접수 중(open)에 다시 신고하면 새로 만들지 않고 그 신고를 돌려준다(duplicate).
   * 신고한 사람의 User 행을 잠가 동시 요청 둘이 둘 다 만드는 일을 막는다
   */
  createUnlessOpen(input: CreateReportInput): Promise<{ report: ReportReceipt; duplicate: boolean }> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM \`User\` WHERE id = ${input.reporterId} FOR UPDATE`;
      const open = await tx.report.findFirst({
        where: { reporterId: input.reporterId, targetType: input.targetType, targetId: input.targetId, status: 'open' },
        orderBy: { id: 'desc' },
        select: RECEIPT_SELECT,
      });
      if (open) return { report: open, duplicate: true };
      const report = await tx.report.create({ data: input, select: RECEIPT_SELECT });
      return { report, duplicate: false };
    });
  }
}
