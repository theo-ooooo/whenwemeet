import { Injectable } from '@nestjs/common';
import { ApiException } from '../common/errors.js';
import type { NoticeReadVia } from '../generated/prisma/enums.js';
import { NOTICE_READ_VIAS } from './dto/notice.dto.js';
import { type DeliveryCounts, type NoticePushRow, type NoticeReaderRow, NoticeReadsRepository, type ReaderQuery } from './notice-reads.repository.js';
import { NoticesRepository } from './notices.repository.js';

const NOT_FOUND_MESSAGE = '공지를 찾을 수 없어요';
const VIA_MESSAGE = 'via 는 list, detail, push, popup, banner 중 하나여야 해요';

/** `?via=` 원문. 없거나 빈 값이면 null, 그 밖 값은 400 */
export function parseReadVia(raw: unknown): NoticeReadVia | null {
  if (raw === undefined || raw === '') return null;
  if (typeof raw === 'string' && (NOTICE_READ_VIAS as readonly string[]).includes(raw)) return raw as NoticeReadVia;
  throw new ApiException('VALIDATION_FAILED', VIA_MESSAGE, [{ field: 'via', message: VIA_MESSAGE }]);
}

/** `?unread=` 원문. 1, true 면 안 읽은 사람(푸시 대상 중), 없거나 0, false 면 읽은 사람 */
export function parseUnreadFlag(raw: unknown): boolean {
  if (raw === undefined || raw === '' || raw === '0' || raw === 'false') return false;
  if (raw === '1' || raw === 'true') return true;
  throw new ApiException('VALIDATION_FAILED', 'unread 는 1 또는 0 이어야 해요', [{ field: 'unread', message: 'unread 는 1 또는 0 이어야 해요' }]);
}

/** 읽은 비율의 기준. push = 푸시 대상 사용자 중, users = 전체 사용자 중 (푸시를 보내지 않은 공지) */
export interface ReadRateBasis {
  of: 'push' | 'users';
  read: number;
  total: number;
}

/** GET /admin/notices/:id/stats (api.md 2.16, D-293) */
export interface NoticeStats {
  noticeId: number;
  publishedAt: Date | null;
  pushedAt: Date | null;
  /** 푸시를 보내지 않았으면 null. status 는 예약 상태(PENDING 이면 아직 펼치기 전) */
  push: (DeliveryCounts & { status: NoticePushRow['status']; dispatchedAt: Date | null }) | null;
  reads: { total: number; byVia: Record<NoticeReadVia, number>; pushOpened: number };
  /** 0~1. 기준 수가 0 이면 null */
  readRate: number | null;
  readRateBasis: ReadRateBasis;
}

/** 경로별 수를 다섯 경로 모두 채운다 */
export function fillByVia(partial: Partial<Record<NoticeReadVia, number>>): Record<NoticeReadVia, number> {
  return Object.fromEntries(NOTICE_READ_VIAS.map((v) => [v, partial[v] ?? 0])) as Record<NoticeReadVia, number>;
}

/** 읽은 비율. 기준이 0 이면 null */
export function readRateOf(basis: ReadRateBasis): number | null {
  return basis.total > 0 ? Math.min(1, basis.read / basis.total) : null;
}

/** (#544) 공지 읽음 기록, 관리자 공지 결과 (D-293) */
@Injectable()
export class NoticeReadsService {
  constructor(
    private readonly reads: NoticeReadsRepository,
    private readonly notices: NoticesRepository,
  ) {}

  /**
   * POST /notices/:id/read. 로그인한 사용자가 게시된 공지 상세를 열었다. 처음 한 번만 남고 경로도 처음 것이다(다시 불러도 그대로, 멱등).
   * first 는 이번에 처음 기록했는지. 없거나 초안이면 404
   */
  async markRead(userId: number, noticeId: number, via: NoticeReadVia): Promise<{ firstReadAt: Date; via: NoticeReadVia; first: boolean }> {
    const row = await this.reads.recordFirstRead(userId, noticeId, via);
    if (!row) throw new ApiException('NOT_FOUND', NOT_FOUND_MESSAGE);
    return { firstReadAt: row.firstReadAt, via: row.via, first: row.created };
  }

  /** 관리자 공지 목록 줄마다 readCount (읽은 사람 수, "읽음 N") 를 붙인다 */
  async withReadCounts<T extends { id: number }>(page: { items: T[]; nextCursor: number | null }): Promise<{ items: (T & { readCount: number })[]; nextCursor: number | null }> {
    const counts = await this.reads.countByNotice(page.items.map((n) => n.id));
    return { items: page.items.map((n) => ({ ...n, readCount: counts.get(n.id) ?? 0 })), nextCursor: page.nextCursor };
  }

  /** GET /admin/notices/:id/stats. 초안도 된다(읽음 0). 없으면 404 */
  async stats(noticeId: number): Promise<NoticeStats> {
    const notice = await this.notices.findById(noticeId);
    if (!notice) throw new ApiException('NOT_FOUND', NOT_FOUND_MESSAGE);
    const [push, byViaPartial] = await Promise.all([this.reads.findPush(noticeId), this.reads.countByVia(noticeId)]);
    const byVia = fillByVia(byViaPartial);
    const total = NOTICE_READ_VIAS.reduce((sum, v) => sum + byVia[v], 0);
    let pushStats: NoticeStats['push'] = null;
    let basis: ReadRateBasis;
    if (push) {
      const [counts, readAmongTargets] = await Promise.all([this.reads.deliveryCounts(push.id), this.reads.countReadAmongTargets(noticeId, push.id)]);
      pushStats = { ...counts, status: push.status, dispatchedAt: push.dispatchedAt };
      basis = { of: 'push', read: readAmongTargets, total: counts.targetUsers };
    } else {
      basis = { of: 'users', read: total, total: await this.reads.countUsers() };
    }
    return {
      noticeId,
      publishedAt: notice.publishedAt,
      pushedAt: notice.pushedAt,
      push: pushStats,
      reads: { total, byVia, pushOpened: byVia.push },
      readRate: readRateOf(basis),
      readRateBasis: basis,
    };
  }

  /**
   * GET /admin/notices/:id/readers. unread 가 false 면 읽은 사람(읽은 시각 내림차순), true 면 푸시 대상 중 안 읽은 사람(사용자 id 내림차순, via 는 무시).
   * 푸시를 보내지 않은 공지의 안 읽은 사람은 빈 목록(전체 사용자를 늘어놓지 않는다). 없는 공지는 404
   */
  async readers(noticeId: number, query: ReaderQuery & { unread: boolean }): Promise<{ items: NoticeReaderRow[]; nextCursor: number | null }> {
    const notice = await this.notices.findById(noticeId);
    if (!notice) throw new ApiException('NOT_FOUND', NOT_FOUND_MESSAGE);
    if (!query.unread) return this.reads.listReaders(noticeId, query);
    const push = await this.reads.findPush(noticeId);
    if (!push) return { items: [], nextCursor: null };
    return this.reads.listUnreadTargets(noticeId, push.id, query);
  }
}
