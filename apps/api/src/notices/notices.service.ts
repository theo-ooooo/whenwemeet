import { Injectable } from '@nestjs/common';
import { AdminAccess } from '../admin/admin-access.js';
import { AdminActionsRepository } from '../admin/admin-actions.repository.js';
import { ApiException } from '../common/errors.js';
import type { PageQuery } from '../common/page-query.js';
import { UsersRepository } from '../users/users.repository.js';
import type { CreateNoticeDto, UpdateNoticeDto } from './dto/notice.dto.js';
import { type NoticeRow, NoticesRepository, type NoticeWrite } from './notices.repository.js';

/** (#515) 공개 목록 한 줄. 본문은 상세에서만. unread 는 로그인했을 때만 의미가 있고 익명은 늘 false (D-285) */
export interface NoticeListItem {
  id: number;
  title: string;
  kind: NoticeRow['kind'];
  pinned: boolean;
  publishedAt: Date;
  unread: boolean;
}

/** (#515) 상세, 관리자 목록 한 줄. publishedAt null = 초안 */
export type NoticeDetail = NoticeRow;

const NOT_FOUND_MESSAGE = '공지를 찾을 수 없어요';

/** seenAt 보다 늦게 게시됐으면 새 공지. 본 적이 없으면(null) 게시된 공지는 모두 새 공지 */
export function isUnread(publishedAt: Date, seenAt: Date | null): boolean {
  return seenAt === null || publishedAt.getTime() > seenAt.getTime();
}

/** (#515) 공지 (api.md 2.16, D-285). 읽기는 누구나, 초안과 쓰기는 관리자만 */
@Injectable()
export class NoticesService {
  constructor(
    private readonly notices: NoticesRepository,
    private readonly users: UsersRepository,
    private readonly access: AdminAccess,
    private readonly actions: AdminActionsRepository,
  ) {}

  /** GET /notices. 게시된 공지만, 고정 먼저 게시 시각 내림차순. viewerId 가 있으면 unread 계산 */
  async listPublished(viewerId: number | null, page: PageQuery): Promise<{ items: NoticeListItem[]; nextCursor: number | null }> {
    const [result, seenAt] = await Promise.all([
      this.notices.listPublished(page),
      viewerId === null ? Promise.resolve(null) : this.users.findNoticesSeenAt(viewerId),
    ]);
    const items = result.items.flatMap((row) => {
      if (row.publishedAt === null) return [];
      return [{ id: row.id, title: row.title, kind: row.kind, pinned: row.pinned, publishedAt: row.publishedAt, unread: viewerId !== null && isUnread(row.publishedAt, seenAt) }];
    });
    return { items, nextCursor: result.nextCursor };
  }

  /** GET /notices/:id. 초안은 관리자만, 아니면 없는 것과 같이 404 */
  async get(viewerId: number | null, id: number): Promise<NoticeDetail> {
    const row = await this.notices.findById(id);
    if (!row) throw new ApiException('NOT_FOUND', NOT_FOUND_MESSAGE);
    if (row.publishedAt === null && !(await this.access.isAdmin(viewerId))) throw new ApiException('NOT_FOUND', NOT_FOUND_MESSAGE);
    return row;
  }

  /** POST /notices/seen. 공지 목록을 본 시각 = now */
  async markSeen(userId: number, now = new Date()): Promise<{ noticesSeenAt: Date }> {
    return { noticesSeenAt: await this.users.markNoticesSeen(userId, now) };
  }

  /** GET /me 의 hasUnreadNotice. 본 시각보다 늦게 게시된 공지가 있는지 */
  async hasUnread(userId: number): Promise<boolean> {
    return this.notices.existsPublishedAfter(await this.users.findNoticesSeenAt(userId));
  }

  /** GET /admin/notices. 초안 포함, 최근 만든 것 먼저 */
  listAll(page: PageQuery): Promise<{ items: NoticeDetail[]; nextCursor: number | null }> {
    return this.notices.listAll(page);
  }

  /** POST /admin/notices. published 면 지금 게시, 아니면 초안 */
  async create(adminId: number, dto: CreateNoticeDto, now = new Date()): Promise<NoticeDetail> {
    const row = await this.notices.create({
      title: dto.title,
      body: dto.body,
      kind: dto.kind,
      pinned: dto.pinned ?? false,
      publishedAt: dto.published ? now : null,
      createdById: adminId,
    });
    await this.actions.record({ adminId, action: 'notice_create', targetType: 'notice', targetId: row.id });
    return row;
  }

  /** PATCH /admin/notices/:id. published true 는 초안일 때만 지금 게시(이미 게시면 시각 유지), false 는 게시 취소 */
  async update(adminId: number, id: number, dto: UpdateNoticeDto, now = new Date()): Promise<NoticeDetail> {
    const current = await this.notices.findById(id);
    if (!current) throw new ApiException('NOT_FOUND', NOT_FOUND_MESSAGE);
    const data: NoticeWrite = {};
    if (dto.title !== undefined) data.title = dto.title;
    if (dto.body !== undefined) data.body = dto.body;
    if (dto.kind !== undefined) data.kind = dto.kind;
    if (dto.pinned !== undefined) data.pinned = dto.pinned;
    if (dto.published !== undefined) data.publishedAt = dto.published ? (current.publishedAt ?? now) : null;
    const row = await this.notices.update(id, data);
    if (!row) throw new ApiException('NOT_FOUND', NOT_FOUND_MESSAGE);
    await this.actions.record({ adminId, action: 'notice_update', targetType: 'notice', targetId: id });
    return row;
  }

  /** DELETE /admin/notices/:id */
  async remove(adminId: number, id: number): Promise<{ ok: true }> {
    if (!(await this.notices.remove(id))) throw new ApiException('NOT_FOUND', NOT_FOUND_MESSAGE);
    await this.actions.record({ adminId, action: 'notice_delete', targetType: 'notice', targetId: id });
    return { ok: true };
  }
}
