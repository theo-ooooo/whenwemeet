import { Injectable } from '@nestjs/common';
import type {
  GroupType,
  ReportReason,
  ReportStatus,
  ReportTargetType,
} from '../generated/prisma/enums.js';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * (#536) 관리자 신고 탭 저장소 (D-289). 신고를 대상(종류, 번호)별로 묶어 읽고, 대상의 접수 중 신고를 한꺼번에 닫는다.
 * 대상은 FK 가 없어 지워졌을 수 있다(미리 보기 null)
 */

/** 묶음 목록의 대상 요약. 지워진 대상은 null */
export interface ReportTargetSummary {
  /** 팀 이름, 일정 제목, 사용자 닉네임 */
  title: string;
  /** 팀이나 일정이 숨김 상태인지. 사용자는 늘 false */
  hidden: boolean;
  /** 일정이면 그 팀 (팀 이름, 종류) */
  group: { id: number; name: string; type: GroupType } | null;
}

/** GET /admin/reports 한 줄 = 대상 하나 */
export interface AdminReportGroup {
  targetType: ReportTargetType;
  targetId: number;
  target: ReportTargetSummary | null;
  /** 필터에 맞는 신고 수 */
  count: number;
  /** 지금 접수 중인 신고 수 (필터와 관계없이) */
  openCount: number;
  /** 사유별 수, 많은 것 먼저 (필터에 맞는 신고만) */
  reasons: { reason: ReportReason; count: number }[];
  /** 접수 중이 하나라도 있으면 open, 아니면 가장 최근 신고의 상태 */
  status: ReportStatus;
  firstReportedAt: Date;
  lastReportedAt: Date;
  /** 묶음 안 가장 최근 신고 번호. 다음 페이지 cursor 로 쓴다 */
  latestReportId: number;
}

/** 대상 상세의 신고 한 건 */
export interface AdminReportRow {
  id: number;
  reason: ReportReason;
  detail: string | null;
  status: ReportStatus;
  createdAt: Date;
  reporter: { id: number; nickname: string } | null;
  resolvedBy: { id: number; nickname: string } | null;
  resolvedAt: Date | null;
  resolution: string | null;
}

export interface ReportListQuery {
  status: ReportStatus | null;
  targetType: ReportTargetType | null;
  limit: number;
  cursor: number | null;
}

export interface CloseReportsInput {
  targetType: ReportTargetType;
  targetId: number;
  status: Exclude<ReportStatus, 'open'>;
  adminId: number;
  resolution: string | null;
  at: Date;
}

/** 대상 상세에 싣는 신고 수 상한 (최근 것부터) */
export const REPORT_DETAIL_LIMIT = 100;

const REPORT_ROW_SELECT = {
  id: true,
  reason: true,
  detail: true,
  status: true,
  createdAt: true,
  reporter: { select: { id: true, nickname: true } },
  resolvedBy: { select: { id: true, nickname: true } },
  resolvedAt: true,
  resolution: true,
} as const;

type TargetKey = { targetType: ReportTargetType; targetId: number };
const keyOf = (t: TargetKey) => `${t.targetType}:${t.targetId}`;

@Injectable()
export class AdminReportsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 대상별 묶음. 가장 최근 신고가 늦은 대상 먼저(묶음의 최대 신고 번호 내림차순), cursor 는 앞 페이지 마지막 묶음의 latestReportId.
   * 쿼리: 묶음 1 + 사유별 1 + 접수 중 수 1 + 최근 신고 상태 1 + 대상 종류별 이름(있는 종류만)
   */
  async listGroups(
    query: ReportListQuery,
  ): Promise<{ items: AdminReportGroup[]; nextCursor: number | null }> {
    const where = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.targetType ? { targetType: query.targetType } : {}),
    };
    const groups = await this.prisma.report.groupBy({
      by: ['targetType', 'targetId'],
      where,
      _count: { _all: true },
      _min: { createdAt: true },
      _max: { createdAt: true, id: true },
      ...(query.cursor !== null
        ? { having: { id: { _max: { lt: query.cursor } } } }
        : {}),
      orderBy: { _max: { id: 'desc' } },
      take: query.limit + 1,
    });
    const page = groups.slice(0, query.limit);
    if (page.length === 0) return { items: [], nextCursor: null };
    const targets = page.map((g) => ({
      targetType: g.targetType,
      targetId: g.targetId,
    }));
    const anyTarget = { OR: targets };
    const [reasonRows, openRows, latestRows, summaries] = await Promise.all([
      this.prisma.report.groupBy({
        by: ['targetType', 'targetId', 'reason'],
        where: { ...where, ...anyTarget },
        _count: { _all: true },
      }),
      this.prisma.report.groupBy({
        by: ['targetType', 'targetId'],
        where: { status: 'open', ...anyTarget },
        _count: { _all: true },
      }),
      this.prisma.report.findMany({
        where: { id: { in: page.map((g) => g._max.id!) } },
        select: { id: true, status: true },
      }),
      this.summaries(targets),
    ]);
    const openOf = new Map(openRows.map((r) => [keyOf(r), r._count._all]));
    const statusOf = new Map(latestRows.map((r) => [r.id, r.status]));
    const items = page.map((g): AdminReportGroup => {
      const key = keyOf(g);
      const openCount = openOf.get(key) ?? 0;
      const latestReportId = g._max.id!;
      return {
        targetType: g.targetType,
        targetId: g.targetId,
        target: summaries.get(key) ?? null,
        count: g._count._all,
        openCount,
        reasons: reasonRows
          .filter((r) => keyOf(r) === key)
          .map((r) => ({ reason: r.reason, count: r._count._all }))
          .sort(
            (a, b) => b.count - a.count || a.reason.localeCompare(b.reason),
          ),
        status:
          openCount > 0 ? 'open' : (statusOf.get(latestReportId) ?? 'open'),
        firstReportedAt: g._min.createdAt!,
        lastReportedAt: g._max.createdAt!,
        latestReportId,
      };
    });
    return {
      items,
      nextCursor: groups.length > query.limit ? latestReportId(items) : null,
    };
  }

  /** 신고 한 건의 대상. 없으면 null */
  findTargetOf(reportId: number): Promise<TargetKey | null> {
    return this.prisma.report.findUnique({
      where: { id: reportId },
      select: { targetType: true, targetId: true },
    });
  }

  /** 대상의 신고 (최근 것부터 100건) */
  listOfTarget(target: TargetKey): Promise<AdminReportRow[]> {
    return this.prisma.report.findMany({
      where: target,
      orderBy: { id: 'desc' },
      take: REPORT_DETAIL_LIMIT,
      select: REPORT_ROW_SELECT,
    });
  }

  /** 대상의 접수 중 신고를 모두 닫는다(처리 완료 또는 기각). 닫은 수 */
  async closeOpen(input: CloseReportsInput): Promise<number> {
    const { count } = await this.prisma.report.updateMany({
      where: {
        targetType: input.targetType,
        targetId: input.targetId,
        status: 'open',
      },
      data: {
        status: input.status,
        resolvedById: input.adminId,
        resolvedAt: input.at,
        resolution: input.resolution,
      },
    });
    return count;
  }

  /** 접수 중 신고가 있는 대상 수 (탭 배지) */
  async countOpenTargets(): Promise<number> {
    const rows = await this.prisma.report.groupBy({
      by: ['targetType', 'targetId'],
      where: { status: 'open' },
    });
    return rows.length;
  }

  /** 대상 종류별로 이름을 한 번씩 읽는다. 지워진 대상은 맵에 없다 */
  private async summaries(
    targets: TargetKey[],
  ): Promise<Map<string, ReportTargetSummary>> {
    const ids = (type: ReportTargetType) =>
      targets.filter((t) => t.targetType === type).map((t) => t.targetId);
    const [groupIds, eventIds, userIds] = [
      ids('group'),
      ids('event'),
      ids('user'),
    ];
    const [groups, events, users] = await Promise.all([
      groupIds.length
        ? this.prisma.group.findMany({
            where: { id: { in: groupIds } },
            select: { id: true, name: true, type: true, hiddenAt: true },
          })
        : [],
      eventIds.length
        ? this.prisma.event.findMany({
            where: { id: { in: eventIds } },
            select: {
              id: true,
              title: true,
              hiddenAt: true,
              group: { select: { id: true, name: true, type: true } },
            },
          })
        : [],
      userIds.length
        ? this.prisma.user.findMany({
            where: { id: { in: userIds } },
            select: { id: true, nickname: true },
          })
        : [],
    ]);
    const out = new Map<string, ReportTargetSummary>();
    for (const g of groups)
      out.set(`group:${g.id}`, {
        title: g.name,
        hidden: g.hiddenAt !== null,
        group: null,
      });
    for (const e of events)
      out.set(`event:${e.id}`, {
        title: e.title,
        hidden: e.hiddenAt !== null,
        group: e.group,
      });
    for (const u of users)
      out.set(`user:${u.id}`, {
        title: u.nickname,
        hidden: false,
        group: null,
      });
    return out;
  }
}

function latestReportId(items: AdminReportGroup[]): number {
  return items[items.length - 1].latestReportId;
}
