import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AnniversariesRepository } from '../anniversaries/anniversaries.repository.js';
import { BirthdaysRepository } from '../anniversaries/birthdays.repository.js';
import { ApiException } from '../common/errors.js';
import { deriveKey } from '../email-login/email-crypto.js';
import { EventsService } from '../events/events.service.js';
import { MembershipService } from '../groups/membership.service.js';
import { type CalendarFeedRow, CalendarFeedsRepository, type CalendarFeedSettings } from './calendar-feeds.repository.js';
import { anniversaryEvents, birthdayEvents, eventToIcs, feedWindow } from './feed-items.js';
import { FEED_TOKEN_KEY_INFO, feedToken, feedTokenHash, lookupHash, newFeedSalt, tokenMatches } from './feed-token.js';
import { buildIcs, type IcsEvent } from './ics.js';

/** 설정 화면에 주는 내 구독 주소 (api.md 2.12) */
export interface CalendarFeedView {
  httpsUrl: string;
  webcalUrl: string;
  /** 구글 캘린더 "URL로 추가" 바로가기 (컴퓨터 웹에서만 동작) */
  googleAddUrl: string;
  includeMemo: boolean;
  includeAnniversaries: boolean;
  createdAt: Date;
  lastFetchedAt: Date | null;
}

/** 공개 피드 결과. notModified 면 body 없이 304 */
export type FeedResult = { notModified: true; etag: string } | { notModified: false; etag: string; body: string };

export const FEED_TIMEZONE = 'Asia/Seoul';
export const FEED_REFRESH = 'PT1H';
export const FEED_NAME_PREFIX = '언제볼까 - ';

/** 운영 기본 API 공개 주소. `API_PUBLIC_ORIGIN` 으로 바꿀 수 있다 */
export const DEFAULT_API_PUBLIC_ORIGIN = 'https://api.whenwemeet.day';

/** 공개 피드의 모든 실패 (없는 토큰, 재발급 전 토큰, 나간 팀, 탈퇴). 사유를 나누지 않는다 (D-218) */
function feedNotFound(): ApiException {
  return new ApiException('NOT_FOUND');
}

/** If-None-Match 가 이 ETag 를 담는지 (`*`, 목록, 약한 비교 `W/`) */
export function etagMatches(header: string | undefined, etag: string): boolean {
  if (!header) return false;
  return header.split(',').some((part) => {
    const tag = part.trim().replace(/^W\//, '');
    return tag === '*' || tag === etag;
  });
}

/** 본문 해시 ETag. 날짜가 바뀌어 창이 움직이거나 일정, 이름, 설정이 바뀌면 달라진다 */
export function bodyEtag(body: string): string {
  return `"${createHash('sha256').update(body, 'utf8').digest('base64url').slice(0, 27)}"`;
}

/**
 * (#193) 외부 캘린더 구독 (설계 캘린더-내보내기.md, D-217 ~ D-220).
 * 설정 API 는 멤버만, 공개 피드는 토큰만 (로그인 없음). 피드는 요청마다 멤버십을 다시 본다
 */
@Injectable()
export class CalendarFeedService {
  private tokenKey: Buffer | null = null;

  constructor(
    private readonly feeds: CalendarFeedsRepository,
    private readonly memberships: MembershipService,
    private readonly events: EventsService,
    private readonly anniversaries: AnniversariesRepository,
    private readonly birthdays: BirthdaysRepository,
    private readonly config: ConfigService,
  ) {}

  async get(userId: number, groupId: number): Promise<CalendarFeedView | null> {
    await this.memberships.assertMember(userId, groupId);
    const row = await this.feeds.findMine(userId, groupId);
    return row && this.view(row);
  }

  async upsert(userId: number, groupId: number, settings: CalendarFeedSettings): Promise<CalendarFeedView> {
    await this.memberships.assertMember(userId, groupId);
    const row = await this.feeds.upsert(userId, groupId, settings, this.newToken(userId, groupId));
    return this.view(row);
  }

  /** 새 토큰. 이전 주소는 바로 404. 주소가 없으면 404 NOT_FOUND */
  async rotate(userId: number, groupId: number): Promise<CalendarFeedView> {
    await this.memberships.assertMember(userId, groupId);
    const row = await this.feeds.replaceToken(userId, groupId, this.newToken(userId, groupId));
    if (!row) throw new ApiException('NOT_FOUND', '연결 주소가 없어요');
    return this.view(row);
  }

  /** 끄기 = 행 삭제. 없어도 200 */
  async remove(userId: number, groupId: number): Promise<{ ok: true }> {
    await this.memberships.assertMember(userId, groupId);
    await this.feeds.remove(userId, groupId);
    return { ok: true };
  }

  /** 공개 피드. 형식이 틀리거나, 없거나, 다시 만든 토큰과 다르거나, 그 팀 멤버가 아니면 모두 같은 404 */
  async feed(token: string, ifNoneMatch: string | undefined, now: Date = new Date()): Promise<FeedResult> {
    const hash = lookupHash(token);
    if (!hash) throw feedNotFound();
    const row = await this.feeds.findByHash(hash);
    if (!row || !tokenMatches(this.key(), row, token)) throw feedNotFound();
    if (!(await this.memberships.isMember(row.userId, row.groupId))) throw feedNotFound();

    const window = feedWindow(now);
    // (#305) 멤버 생일은 "기념일 포함" 을 따른다 (D-233)
    const [views, anniversaries, birthdays] = await Promise.all([
      this.events.listForFeed(row.groupId, window.from, window.to),
      row.includeAnniversaries ? this.anniversaries.listForFeed(row.groupId) : Promise.resolve([]),
      row.includeAnniversaries ? this.birthdays.listForFeed(row.groupId) : Promise.resolve([]),
    ]);
    const options = {
      includeMemo: row.includeMemo,
      includeParticipants: row.group.type === 'TEAM',
      webOrigin: this.webOrigin(),
      groupCode: row.group.publicCode,
    };
    const items: IcsEvent[] = [
      ...views.map((view) => eventToIcs(view, options)),
      ...anniversaries.flatMap((a) => anniversaryEvents(a, window)),
      ...birthdays.flatMap((b) => birthdayEvents(b, window)),
    ];
    const body = buildIcs({ name: `${FEED_NAME_PREFIX}${row.group.name}`, timezone: FEED_TIMEZONE, refreshInterval: FEED_REFRESH, events: items });
    const etag = bodyEtag(body);
    await this.feeds.touchFetched(row.id, now);
    return etagMatches(ifNoneMatch, etag) ? { notModified: true, etag } : { notModified: false, etag, body };
  }

  /** 주소는 저장하지 않고 소금으로 다시 만든다. 서버 비밀이 바뀌어 해시가 안 맞으면 지금 비밀로 해시를 다시 맞춘다 (옛 주소는 이미 404) */
  private async view(row: CalendarFeedRow): Promise<CalendarFeedView> {
    const token = feedToken(this.key(), row.userId, row.groupId, row.tokenSalt);
    const tokenHash = feedTokenHash(token);
    if (tokenHash !== row.tokenHash) await this.feeds.replaceToken(row.userId, row.groupId, { tokenSalt: row.tokenSalt, tokenHash });
    const httpsUrl = `${this.apiOrigin()}/v1/ics/${token}.ics`;
    const webcalUrl = httpsUrl.replace(/^https?:/, 'webcal:');
    return {
      httpsUrl,
      webcalUrl,
      googleAddUrl: `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcalUrl)}`,
      includeMemo: row.includeMemo,
      includeAnniversaries: row.includeAnniversaries,
      createdAt: row.createdAt,
      lastFetchedAt: row.lastFetchedAt,
    };
  }

  private newToken(userId: number, groupId: number): { tokenSalt: string; tokenHash: string } {
    const tokenSalt = newFeedSalt();
    return { tokenSalt, tokenHash: feedTokenHash(feedToken(this.key(), userId, groupId, tokenSalt)) };
  }

  private key(): Buffer {
    this.tokenKey ??= deriveKey(this.config.getOrThrow<string>('JWT_SECRET'), FEED_TOKEN_KEY_INFO);
    return this.tokenKey;
  }

  private webOrigin(): string {
    return this.config.getOrThrow<string>('WEB_ORIGIN');
  }

  /** `API_PUBLIC_ORIGIN`, 없으면 운영은 api.whenwemeet.day, 개발은 localhost:PORT */
  private apiOrigin(): string {
    const configured = this.config.get<string>('API_PUBLIC_ORIGIN')?.trim().replace(/\/+$/, '');
    if (configured) return configured;
    if (this.config.get<string>('NODE_ENV') === 'production') return DEFAULT_API_PUBLIC_ORIGIN;
    return `http://localhost:${this.config.get<string>('PORT') ?? 4000}`;
  }
}
