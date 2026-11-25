import { Injectable } from '@nestjs/common';
import { AdminAccess } from '../admin/admin-access.js';
import { AdminActionsRepository } from '../admin/admin-actions.repository.js';
import { ApiException } from '../common/errors.js';
import type { PageQuery } from '../common/page-query.js';
import { PushScheduler } from '../push/push.scheduler.js';
import { UsersRepository } from '../users/users.repository.js';
import type { CreateNoticeDto, UpdateNoticeDto } from './dto/notice.dto.js';
import { NoticeAlreadyPushedError, type NoticeAttentionRow, type NoticeRow, NoticesRepository, type NoticeWrite } from './notices.repository.js';

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
/** (#528) 초안에 push: true (D-287) */
const DRAFT_PUSH_MESSAGE = '초안은 푸시로 보낼 수 없어요. 게시할 때 보내 주세요';
const draftPush = () => new ApiException('VALIDATION_FAILED', DRAFT_PUSH_MESSAGE, [{ field: 'push', message: DRAFT_PUSH_MESSAGE }]);

/** (#538) 팝업 미리 보기 상한 (첫 문단을 이 길이에서 자르고 … 를 붙인다, D-291) */
export const POPUP_PREVIEW_MAX = 200;

/** (#538) 앱, 웹을 열 때 한 번 띄우는 공지 (D-291). preview 는 본문 첫 문단 */
export interface NoticePopup {
  id: number;
  title: string;
  kind: NoticeRow['kind'];
  publishedAt: Date;
  preview: string;
}

/** (#538) 달력 위 "새 공지: 제목" 띠 (D-291) */
export interface NoticeBanner {
  id: number;
  title: string;
  kind: NoticeRow['kind'];
  publishedAt: Date;
}

/** (#538) GET /notices/attention */
export interface NoticeAttention {
  popup: NoticePopup | null;
  banner: NoticeBanner | null;
}

/**
 * (#538) 본문 → 팝업 미리 보기. 빈 줄로 나눈 첫 문단(웹 lib/notice.ts noticeParagraphs 와 같은 규칙),
 * 문단 안 줄바꿈은 그대로 두고 POPUP_PREVIEW_MAX 자를 넘으면 자르고 … 를 붙인다
 */
export function noticePreview(body: string, max = POPUP_PREVIEW_MAX): string {
  const first =
    body
      .replace(/\r\n?/g, '\n')
      .split(/\n(?:[ \t]*\n)+/)
      .map((p) => p.replace(/^\n+|\n+$/g, '').trim())
      .find((p) => p !== '') ?? '';
  const chars = Array.from(first);
  return chars.length > max ? `${chars.slice(0, max).join('').trimEnd()}…` : first;
}

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
    private readonly scheduler: PushScheduler,
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

  /**
   * (#538) GET /notices/attention. popup = 닫지 않은 게시된 팝업 공지 중 가장 최근 것,
   * banner = 공지 목록을 본 시각(noticesSeenAt)보다 늦게 게시된 공지 중 가장 최근 것 (D-291)
   */
  async attention(userId: number): Promise<NoticeAttention> {
    const [popup, seenAt] = await Promise.all([this.notices.findPopupFor(userId), this.users.findNoticesSeenAt(userId)]);
    const latest = await this.notices.findLatestPublishedAfter(seenAt);
    return {
      popup: popup ? { ...brief(popup), preview: noticePreview(popup.body) } : null,
      banner: latest ? brief(latest) : null,
    };
  }

  /** (#538) POST /notices/:id/dismiss. 멱등. 없거나 초안이면 404 (D-291) */
  async dismiss(userId: number, id: number): Promise<{ ok: true }> {
    if (!(await this.notices.dismiss(userId, id))) throw new ApiException('NOT_FOUND', NOT_FOUND_MESSAGE);
    return { ok: true };
  }

  /** GET /admin/notices. 초안 포함, 최근 만든 것 먼저 */
  listAll(page: PageQuery): Promise<{ items: NoticeDetail[]; nextCursor: number | null }> {
    return this.notices.listAll(page);
  }

  /**
   * POST /admin/notices. published 면 지금 게시, 아니면 초안.
   * (#528) push: true 면 게시와 같이 전체 푸시를 예약한다(초안이면 400). 보내기는 푸시 틱이 나눠서 한다 (D-287)
   */
  async create(adminId: number, dto: CreateNoticeDto, now = new Date()): Promise<NoticeDetail> {
    if (dto.push && !dto.published) throw draftPush();
    const row = await this.notices.create(
      {
        title: dto.title,
        body: dto.body,
        kind: dto.kind,
        pinned: dto.pinned ?? false,
        popup: dto.popup ?? false,
        publishedAt: dto.published ? now : null,
        createdById: adminId,
      },
      dto.push ? now : null,
    );
    await this.actions.record({ adminId, action: 'notice_create', targetType: 'notice', targetId: row.id });
    if (dto.push) await this.afterPush(adminId, row.id);
    return row;
  }

  /**
   * PATCH /admin/notices/:id. published true 는 초안일 때만 지금 게시(이미 게시면 시각 유지), false 는 게시 취소.
   * (#528) push: true 는 고친 결과가 게시 상태일 때만(아니면 400), 이미 보낸 공지면 409 NOTICE_ALREADY_PUSHED 이고 아무것도 바꾸지 않는다.
   * push 가 false 이거나 없으면 보내지 않는다 (게시 취소 뒤 다시 게시해도 다시 보내지 않는다, D-287)
   */
  async update(adminId: number, id: number, dto: UpdateNoticeDto, now = new Date()): Promise<NoticeDetail> {
    const current = await this.notices.findById(id);
    if (!current) throw new ApiException('NOT_FOUND', NOT_FOUND_MESSAGE);
    const data: NoticeWrite = {};
    if (dto.title !== undefined) data.title = dto.title;
    if (dto.body !== undefined) data.body = dto.body;
    if (dto.kind !== undefined) data.kind = dto.kind;
    if (dto.pinned !== undefined) data.pinned = dto.pinned;
    if (dto.popup !== undefined) data.popup = dto.popup;
    if (dto.published !== undefined) data.publishedAt = dto.published ? (current.publishedAt ?? now) : null;
    const push = dto.push === true;
    if (push) {
      const willBePublished = data.publishedAt !== undefined ? data.publishedAt !== null : current.publishedAt !== null;
      if (!willBePublished) throw draftPush();
      if (current.pushedAt !== null) throw new ApiException('NOTICE_ALREADY_PUSHED');
    }
    let row: NoticeRow | null;
    try {
      row = await this.notices.update(id, data, push ? now : null);
    } catch (error) {
      if (error instanceof NoticeAlreadyPushedError) throw new ApiException('NOTICE_ALREADY_PUSHED');
      throw error;
    }
    if (!row) throw new ApiException('NOT_FOUND', NOT_FOUND_MESSAGE);
    await this.actions.record({ adminId, action: 'notice_update', targetType: 'notice', targetId: id });
    if (push) await this.afterPush(adminId, id);
    return row;
  }

  /** (#528) 푸시를 예약한 뒤: 조치 기록 notice_push, 틱을 바로 한 번 깨운다(합류와 같이, D-91). PUSH_ENABLED 가 꺼져 있으면 예약만 남는다 */
  private async afterPush(adminId: number, noticeId: number): Promise<void> {
    await this.actions.record({ adminId, action: 'notice_push', targetType: 'notice', targetId: noticeId });
    this.scheduler.kick();
  }

  /** DELETE /admin/notices/:id */
  async remove(adminId: number, id: number): Promise<{ ok: true }> {
    if (!(await this.notices.remove(id))) throw new ApiException('NOT_FOUND', NOT_FOUND_MESSAGE);
    await this.actions.record({ adminId, action: 'notice_delete', targetType: 'notice', targetId: id });
    return { ok: true };
  }
}

function brief(row: NoticeAttentionRow): NoticeBanner {
  return { id: row.id, title: row.title, kind: row.kind, publishedAt: row.publishedAt };
}
