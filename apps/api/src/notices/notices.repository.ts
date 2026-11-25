import { Injectable } from '@nestjs/common';
import type { NoticeKind } from '../generated/prisma/enums.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { PushNotificationsRepository } from '../push/push-notifications.repository.js';

/** (#515) 공지 저장소 (D-285) */

const NOTICE_SELECT = {
  id: true,
  title: true,
  body: true,
  kind: true,
  pinned: true,
  publishedAt: true,
  pushedAt: true,
  popup: true,
  createdAt: true,
  updatedAt: true,
} as const;

export interface NoticeRow {
  id: number;
  title: string;
  body: string;
  kind: NoticeKind;
  pinned: boolean;
  /** null = 초안 */
  publishedAt: Date | null;
  /** (#528) 푸시를 보낸 시각. null = 아직 안 보냄 (D-287) */
  pushedAt: Date | null;
  /** (#538) 앱, 웹을 열 때 한 번 창으로 (D-291) */
  popup: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface NoticeWrite {
  title?: string;
  body?: string;
  kind?: NoticeKind;
  pinned?: boolean;
  publishedAt?: Date | null;
  /** (#538) */
  popup?: boolean;
}

/** (#538) 팝업, 새 공지 띠에 쓰는 한 줄 (본문 포함: 팝업은 첫 문단을 미리 보인다) */
export interface NoticeAttentionRow {
  id: number;
  title: string;
  body: string;
  kind: NoticeKind;
  publishedAt: Date;
}

const ATTENTION_SELECT = { id: true, title: true, body: true, kind: true, publishedAt: true } as const;

/** 페이지 결과. nextCursor 는 이 페이지 마지막 id (다음 요청의 cursor), 더 없으면 null */
export interface NoticePage {
  items: NoticeRow[];
  nextCursor: number | null;
}

/** (#528) 푸시를 같이 예약했는데 그 사이 다른 요청이 먼저 보냈다 (트랜잭션은 되돌린다) */
export class NoticeAlreadyPushedError extends Error {}

@Injectable()
export class NoticesRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly push: PushNotificationsRepository,
  ) {}

  /**
   * 게시된 공지. 고정 먼저, 게시 시각 내림차순, 같으면 id 내림차순 (D-285).
   * cursor 는 앞 페이지 마지막 id. 정렬 값이 그 행 기준이라 Prisma cursor 로 이어 읽는다
   */
  listPublished(page: { limit: number; cursor: number | null }): Promise<NoticePage> {
    return this.page({ publishedAt: { not: null } }, [{ pinned: 'desc' }, { publishedAt: 'desc' }, { id: 'desc' }], page);
  }

  /** 관리자 목록: 초안 포함 전부, 최근 만든 것 먼저 */
  listAll(page: { limit: number; cursor: number | null }): Promise<NoticePage> {
    return this.page({}, [{ id: 'desc' }], page);
  }

  findById(id: number): Promise<NoticeRow | null> {
    return this.prisma.notice.findUnique({ where: { id }, select: NOTICE_SELECT });
  }

  /** after 보다 늦게 게시된 공지가 있는지. after 가 null 이면 게시된 공지가 하나라도 있는지 */
  async existsPublishedAfter(after: Date | null): Promise<boolean> {
    const row = await this.prisma.notice.findFirst({
      where: { publishedAt: after ? { gt: after } : { not: null } },
      select: { id: true },
    });
    return row !== null;
  }

  /**
   * (#538) 이 사용자가 닫지 않은 게시된 팝업 공지 중 가장 최근 게시된 것 (D-291). 없으면 null.
   * 팝업 공지는 손에 꼽을 만큼이라 publishedAt 인덱스와 닫은 기록 PK(userId, noticeId) 로 충분하다
   */
  async findPopupFor(userId: number): Promise<NoticeAttentionRow | null> {
    const row = await this.prisma.notice.findFirst({
      where: { popup: true, publishedAt: { not: null }, dismissals: { none: { userId } } },
      orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
      select: ATTENTION_SELECT,
    });
    return row && row.publishedAt ? { ...row, publishedAt: row.publishedAt } : null;
  }

  /** (#538) after 보다 늦게 게시된 공지 중 가장 최근 것 (새 공지 띠). after 가 null 이면 게시된 공지 중 가장 최근 것 */
  async findLatestPublishedAfter(after: Date | null): Promise<NoticeAttentionRow | null> {
    const row = await this.prisma.notice.findFirst({
      where: { publishedAt: after ? { gt: after } : { not: null } },
      orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
      select: ATTENTION_SELECT,
    });
    return row && row.publishedAt ? { ...row, publishedAt: row.publishedAt } : null;
  }

  /** (#538) 게시된 공지면 닫은 기록을 남긴다(이미 있으면 그대로). 없거나 초안이면 false */
  async dismiss(userId: number, noticeId: number): Promise<boolean> {
    const notice = await this.prisma.notice.findFirst({ where: { id: noticeId, publishedAt: { not: null } }, select: { id: true } });
    if (!notice) return false;
    await this.prisma.noticeDismissal.createMany({ data: [{ userId, noticeId }], skipDuplicates: true });
    return true;
  }

  /** (#528) pushAt 을 주면 같은 트랜잭션에서 pushedAt 을 적고 공지 푸시를 예약한다 (게시된 공지만, 서비스가 확인) */
  create(data: Required<Pick<NoticeWrite, 'title' | 'body' | 'kind'>> & NoticeWrite & { createdById: number }, pushAt: Date | null = null): Promise<NoticeRow> {
    if (pushAt === null) return this.prisma.notice.create({ data, select: NOTICE_SELECT });
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.notice.create({ data: { ...data, pushedAt: pushAt }, select: NOTICE_SELECT });
      await this.push.scheduleNoticeTx(tx, row.id, pushAt);
      return row;
    });
  }

  /**
   * 없으면 null. (#528) pushAt 을 주면 같은 트랜잭션에서 "아직 안 보냈고 게시된" 공지일 때만 pushedAt 을 적고 푸시를 예약한다.
   * 그 조건이 깨졌으면(동시에 두 번 누름) NoticeAlreadyPushedError 를 던져 고친 내용까지 되돌린다
   */
  async update(id: number, data: NoticeWrite, pushAt: Date | null = null): Promise<NoticeRow | null> {
    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.notice.updateMany({ where: { id }, data });
      if (count === 0) return null;
      if (pushAt !== null) {
        const marked = await tx.notice.updateMany({ where: { id, pushedAt: null, publishedAt: { not: null } }, data: { pushedAt: pushAt } });
        if (marked.count !== 1) throw new NoticeAlreadyPushedError();
        await this.push.scheduleNoticeTx(tx, id, pushAt);
      }
      return tx.notice.findUnique({ where: { id }, select: NOTICE_SELECT });
    });
  }

  /** 지웠으면 true */
  async remove(id: number): Promise<boolean> {
    const { count } = await this.prisma.notice.deleteMany({ where: { id } });
    return count > 0;
  }

  private async page(
    where: { publishedAt?: { not: null } },
    orderBy: ({ pinned: 'desc' } | { publishedAt: 'desc' } | { id: 'desc' })[],
    { limit, cursor }: { limit: number; cursor: number | null },
  ): Promise<NoticePage> {
    const rows = await this.prisma.notice.findMany({
      where,
      orderBy,
      take: limit + 1,
      ...(cursor !== null ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: NOTICE_SELECT,
    });
    const items = rows.slice(0, limit);
    return { items, nextCursor: rows.length > limit ? items[items.length - 1].id : null };
  }
}
