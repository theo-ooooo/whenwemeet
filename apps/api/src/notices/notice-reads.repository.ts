import { Injectable } from '@nestjs/common';
import {
  FILE_LOCATION_SELECT,
  FileUrlBuilder,
} from '../files/file-url.builder.js';
import type { NoticeReadVia } from '../generated/prisma/enums.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { noticeDedupeKey } from '../push/push-notifications.repository.js';

/** (#544) 공지 읽음 기록과 공지별 푸시 결과 저장소 (D-293) */

/** 처음 읽은 기록 한 줄 */
export interface NoticeReadRecord {
  firstReadAt: Date;
  via: NoticeReadVia;
}

/** 이 공지의 푸시 예약 (PushNotification N:{id}). 없으면 푸시를 보내지 않은 공지 */
export interface NoticePushRow {
  id: number;
  status: 'PENDING' | 'DISPATCHED' | 'CANCELLED' | 'SKIPPED';
  dispatchedAt: Date | null;
}

/**
 * 기기별 발송 집계. delivered + failed + pending = devices.
 * sent = Expo 가 받음(SENT), delivered = 영수증 ok, failed = 보내기 실패(FAILED) 또는 영수증 오류, pending = 아직 보내는 중이거나 영수증을 기다림
 */
export interface DeliveryCounts {
  targetUsers: number;
  devices: number;
  sent: number;
  delivered: number;
  failed: number;
  pending: number;
}

/** 읽은 사람 목록 한 줄. 안 읽은 사람 목록에서는 firstReadAt, via 가 null */
export interface NoticeReaderRow {
  id: number;
  nickname: string;
  profileImageUrl: string | null;
  firstReadAt: Date | null;
  via: NoticeReadVia | null;
}

export interface ReaderQuery {
  q: string | null;
  via: NoticeReadVia | null;
  limit: number;
  /** 앞 페이지 마지막 사용자 id */
  cursor: number | null;
}

/** COUNT, SUM 은 드라이버에 따라 bigint, 문자열(DECIMAL)로 온다 */
const num = (v: unknown): number =>
  v === null || v === undefined ? 0 : Number(v);

const READER_USER_SELECT = {
  id: true,
  nickname: true,
  avatar: { select: FILE_LOCATION_SELECT },
} as const;

@Injectable()
export class NoticeReadsRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly urls: FileUrlBuilder,
  ) {}

  /**
   * 게시된 공지면 처음 읽은 기록을 남기고(이미 있으면 그대로) 남아 있는 기록을 돌려준다. 없거나 초안이면 null.
   * created 는 이번 요청이 처음 기록했는지
   */
  async recordFirstRead(
    userId: number,
    noticeId: number,
    via: NoticeReadVia,
  ): Promise<(NoticeReadRecord & { created: boolean }) | null> {
    const notice = await this.prisma.notice.findFirst({
      where: { id: noticeId, publishedAt: { not: null } },
      select: { id: true },
    });
    if (!notice) return null;
    const { count } = await this.prisma.noticeRead.createMany({
      data: [{ userId, noticeId, via }],
      skipDuplicates: true,
    });
    const row = await this.prisma.noticeRead.findUniqueOrThrow({
      where: { userId_noticeId: { userId, noticeId } },
      select: { firstReadAt: true, via: true },
    });
    return { ...row, created: count === 1 };
  }

  /** 공지별 읽은 사람 수 (관리자 공지 목록 "읽음 N"). 기록이 없는 공지는 맵에 없다 */
  async countByNotice(noticeIds: number[]): Promise<Map<number, number>> {
    if (noticeIds.length === 0) return new Map();
    const rows = await this.prisma.noticeRead.groupBy({
      by: ['noticeId'],
      where: { noticeId: { in: noticeIds } },
      _count: { _all: true },
    });
    return new Map(rows.map((r) => [r.noticeId, r._count._all]));
  }

  /** 경로별 읽은 사람 수 */
  async countByVia(
    noticeId: number,
  ): Promise<Partial<Record<NoticeReadVia, number>>> {
    const rows = await this.prisma.noticeRead.groupBy({
      by: ['via'],
      where: { noticeId },
      _count: { _all: true },
    });
    return Object.fromEntries(rows.map((r) => [r.via, r._count._all]));
  }

  /** 이 공지의 푸시 예약. 보낸 적이 없으면 null */
  findPush(noticeId: number): Promise<NoticePushRow | null> {
    return this.prisma.pushNotification.findUnique({
      where: { dedupeKey: noticeDedupeKey(noticeId) },
      select: { id: true, status: true, dispatchedAt: true },
    });
  }

  /** 기기별 발송 집계 (한 쿼리) */
  async deliveryCounts(notificationId: number): Promise<DeliveryCounts> {
    const [row] = await this.prisma.$queryRaw<
      Record<keyof DeliveryCounts, unknown>[]
    >`
      SELECT
        COUNT(DISTINCT userId) AS targetUsers,
        COUNT(*) AS devices,
        COALESCE(SUM(status = 'SENT'), 0) AS sent,
        COALESCE(SUM(status = 'SENT' AND receipt = 'ok'), 0) AS delivered,
        COALESCE(SUM(status = 'FAILED' OR (status = 'SENT' AND receipt IS NOT NULL AND receipt <> 'ok')), 0) AS failed,
        COALESCE(SUM(status IN ('QUEUED', 'SENDING') OR (status = 'SENT' AND receipt IS NULL)), 0) AS pending
      FROM \`PushDelivery\` WHERE notificationId = ${notificationId}`;
    return {
      targetUsers: num(row.targetUsers),
      devices: num(row.devices),
      sent: num(row.sent),
      delivered: num(row.delivered),
      failed: num(row.failed),
      pending: num(row.pending),
    };
  }

  /** 푸시 대상(기기별 발송이 하나라도 있는 사람) 중 읽은 사람 수 */
  async countReadAmongTargets(
    noticeId: number,
    notificationId: number,
  ): Promise<number> {
    const [row] = await this.prisma.$queryRaw<{ n: unknown }[]>`
      SELECT COUNT(*) AS n FROM \`NoticeRead\` r
      WHERE r.noticeId = ${noticeId}
        AND EXISTS (SELECT 1 FROM \`PushDelivery\` d WHERE d.notificationId = ${notificationId} AND d.userId = r.userId)`;
    return num(row.n);
  }

  countUsers(): Promise<number> {
    return this.prisma.user.count();
  }

  /** 읽은 사람. 읽은 시각 내림차순(같으면 사용자 id 내림차순), 이름 부분 일치, 경로 필터. cursor 는 앞 페이지 마지막 사용자 id */
  async listReaders(
    noticeId: number,
    query: ReaderQuery,
  ): Promise<{ items: NoticeReaderRow[]; nextCursor: number | null }> {
    const rows = await this.prisma.noticeRead.findMany({
      where: {
        noticeId,
        ...(query.via ? { via: query.via } : {}),
        ...(query.q ? { user: { nickname: { contains: query.q } } } : {}),
      },
      orderBy: [{ firstReadAt: 'desc' }, { userId: 'desc' }],
      take: query.limit + 1,
      ...(query.cursor !== null
        ? {
            cursor: { userId_noticeId: { userId: query.cursor, noticeId } },
            skip: 1,
          }
        : {}),
      select: {
        firstReadAt: true,
        via: true,
        user: { select: READER_USER_SELECT },
      },
    });
    const items = rows.slice(0, query.limit).map((r) => ({
      id: r.user.id,
      nickname: r.user.nickname,
      profileImageUrl: this.urls.publicUrlOrNull(r.user.avatar),
      firstReadAt: r.firstReadAt,
      via: r.via,
    }));
    return {
      items,
      nextCursor: rows.length > query.limit ? items[items.length - 1].id : null,
    };
  }

  /** 푸시 대상 중 안 읽은 사람. 사용자 id 내림차순, 이름 부분 일치. cursor 는 앞 페이지 마지막 사용자 id */
  async listUnreadTargets(
    noticeId: number,
    notificationId: number,
    query: Pick<ReaderQuery, 'q' | 'limit' | 'cursor'>,
  ): Promise<{ items: NoticeReaderRow[]; nextCursor: number | null }> {
    const rows = await this.prisma.user.findMany({
      where: {
        pushDeliveries: { some: { notificationId } },
        noticeReads: { none: { noticeId } },
        ...(query.q ? { nickname: { contains: query.q } } : {}),
        ...(query.cursor !== null ? { id: { lt: query.cursor } } : {}),
      },
      orderBy: { id: 'desc' },
      take: query.limit + 1,
      select: READER_USER_SELECT,
    });
    const items = rows.slice(0, query.limit).map((u) => ({
      id: u.id,
      nickname: u.nickname,
      profileImageUrl: this.urls.publicUrlOrNull(u.avatar),
      firstReadAt: null,
      via: null,
    }));
    return {
      items,
      nextCursor: rows.length > query.limit ? items[items.length - 1].id : null,
    };
  }
}
