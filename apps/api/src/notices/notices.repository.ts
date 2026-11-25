import { Injectable } from '@nestjs/common';
import type { NoticeKind } from '../generated/prisma/enums.js';
import { PrismaService } from '../prisma/prisma.service.js';

/** (#515) 공지 저장소 (D-285) */

const NOTICE_SELECT = {
  id: true,
  title: true,
  body: true,
  kind: true,
  pinned: true,
  publishedAt: true,
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
  createdAt: Date;
  updatedAt: Date;
}

export interface NoticeWrite {
  title?: string;
  body?: string;
  kind?: NoticeKind;
  pinned?: boolean;
  publishedAt?: Date | null;
}

/** 페이지 결과. nextCursor 는 이 페이지 마지막 id (다음 요청의 cursor), 더 없으면 null */
export interface NoticePage {
  items: NoticeRow[];
  nextCursor: number | null;
}

@Injectable()
export class NoticesRepository {
  constructor(private readonly prisma: PrismaService) {}

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

  create(data: Required<Pick<NoticeWrite, 'title' | 'body' | 'kind'>> & NoticeWrite & { createdById: number }): Promise<NoticeRow> {
    return this.prisma.notice.create({ data, select: NOTICE_SELECT });
  }

  /** 없으면 null */
  async update(id: number, data: NoticeWrite): Promise<NoticeRow | null> {
    const { count } = await this.prisma.notice.updateMany({ where: { id }, data });
    if (count === 0) return null;
    return this.findById(id);
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
