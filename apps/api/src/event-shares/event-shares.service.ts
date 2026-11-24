import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiException } from '../common/errors.js';
import { isCalendarDate } from '../common/validation.js';
import { EventReadsRepository } from '../events/event-reads.repository.js';
import type { Repeat } from '../events/recurrence.js';
import { GroupsRepository } from '../groups/groups.repository.js';
import { GroupsService } from '../groups/groups.service.js';
import { GroupDetail, MembershipService } from '../groups/membership.service.js';
import { EventShareRow, EventSharesRepository, EventShareWithGroup } from './event-shares.repository.js';
import {
  generateShareToken,
  landingDate,
  resolveSharedOccurrence,
  SHARE_TOKEN_PATTERN,
  type SharedOccurrence,
  shareExpiresAt,
} from './share-rules.js';

/** (#274) 보내는 쪽 링크 (api.md 2.10 EventShareLink) */
export interface EventShareLink {
  token: string;
  url: string;
  expiresAt: Date;
}

/** 멤버가 보는 착지 정보. 비멤버에게는 id 를 주지 않는다 (D-184) */
export interface EventShareLanding {
  groupId: number;
  eventId: number;
  /** (#311) 팀, 일정 공개 코드. 웹은 `/events/<eventCode>?team=<groupCode>` 로 간다 */
  groupCode: string;
  eventCode: string;
  occurrence: string | null;
  /** 달력 착지 날짜 (KST 'YYYY-MM-DD') */
  date: string;
}

/**
 * (#274) 받는 쪽 미리보기 (api.md 2.10 EventSharePreview, D-184). 메모, 참여자, 등록자, 사진, id(비멤버) 는 싣지 않는다
 */
export interface EventSharePreview {
  groupName: string;
  memberCount: number;
  sharer: { displayName: string } | null;
  /** (#343) color: 일정 색(팔레트 키). null 이면 자동이라 카드는 기본 강조색 (D-215) */
  event: { title: string; startsAt: Date; endsAt: Date; allDay: boolean; repeat: Repeat | null; occurrence: string | null; color: string | null };
  expiresAt: Date;
  viewer: ({ member: true } & EventShareLanding) | { member: false };
}

export interface EventShareJoinResult {
  group: GroupDetail;
  eventId: number;
  /** (#311) 일정 공개 코드 */
  eventCode: string;
  occurrence: string | null;
  date: string;
}

/** 살아 있는 링크와 그 회차 */
interface LiveShare {
  share: EventShareWithGroup;
  occurrence: SharedOccurrence;
  repeat: Repeat | null;
  /** (#311) 일정 공개 코드 */
  eventCode: string;
  /** (#343) 일정 색. null 이면 자동 */
  color: string | null;
}

const NOT_FOUND = () => new ApiException('EVENT_SHARE_NOT_FOUND');
const EVENT_NOT_FOUND = () => new ApiException('NOT_FOUND', '일정을 찾을 수 없어요');

function validationFailed(field: string, message: string): ApiException {
  return new ApiException('VALIDATION_FAILED', message, [{ field, message }]);
}

@Injectable()
export class EventSharesService {
  constructor(
    private readonly shares: EventSharesRepository,
    private readonly events: EventReadsRepository,
    private readonly groupsRepo: GroupsRepository,
    private readonly groups: GroupsService,
    private readonly memberships: MembershipService,
    private readonly config: ConfigService,
  ) {}

  /** 그 일정(회차)의 살아 있는 링크. 없으면 null */
  async getLink(userId: number, groupId: number, eventId: number, occurrenceRaw: unknown): Promise<EventShareLink | null> {
    await this.memberships.assertMember(userId, groupId);
    const occurrence = await this.occurrenceKey(groupId, eventId, occurrenceRaw);
    const share = await this.shares.findLive(eventId, occurrence, new Date());
    return share && this.toLink(share);
  }

  /**
   * 살아 있는 링크를 돌려주고, 없으면 만든다 (D-182). 개인 팀 GROUP_NOT_INVITABLE, 지난 회차 EVENT_SHARE_ENDED,
   * 반복인데 occurrence 가 없거나 실제 회차가 아니면 VALIDATION_FAILED
   */
  async createLink(
    userId: number,
    groupId: number,
    eventId: number,
    occurrenceRaw: unknown,
  ): Promise<{ link: EventShareLink; created: boolean }> {
    await this.memberships.assertMember(userId, groupId);
    const group = await this.groupsRepo.findType(groupId);
    if (!group) throw new ApiException('NOT_FOUND', '팀을 찾을 수 없어요');
    if (group.type === 'PERSONAL') throw new ApiException('GROUP_NOT_INVITABLE');
    const row = await this.events.findInGroup(groupId, eventId);
    if (!row) throw EVENT_NOT_FOUND();
    const occurrenceKey = row.repeat ? parseOccurrence(occurrenceRaw) : null;
    const exceptions = row.repeat ? await this.events.listExceptions(row.id) : [];
    const occurrence = resolveSharedOccurrence(row, exceptions, occurrenceKey);
    if (!occurrence) throw validationFailed('occurrence', '이 일정의 회차가 아니에요');
    const now = new Date();
    if (occurrence.endsAt.getTime() <= now.getTime()) throw new ApiException('EVENT_SHARE_ENDED');

    const { share, created } = await this.shares.findOrCreateLiveTx(
      { token: generateShareToken(), groupId, eventId, occurrence: occurrenceKey, createdById: userId, expiresAt: shareExpiresAt(occurrence.endsAt, now) },
      now,
    );
    return { link: this.toLink(share), created };
  }

  /** 그 일정(회차)의 살아 있는 링크를 끊는다. 없어도 성공 (팀원 누구나, D-18) */
  async revokeLink(userId: number, groupId: number, eventId: number, occurrenceRaw: unknown): Promise<{ ok: true }> {
    await this.memberships.assertMember(userId, groupId);
    const occurrence = await this.occurrenceKey(groupId, eventId, occurrenceRaw);
    await this.shares.revokeLive(eventId, occurrence, new Date());
    return { ok: true };
  }

  /** 로그인 없이 보는 미리보기. 로그인했고 이미 멤버면 viewer 에 착지 정보 (D-184) */
  async preview(token: string, viewerId: number | null): Promise<EventSharePreview> {
    const { share, occurrence, repeat, eventCode, color } = await this.findLive(token);
    const members = await this.memberships.listMembers(share.groupId);
    const sharer = share.createdById === null ? undefined : members.find((m) => m.userId === share.createdById);
    const isMember = viewerId !== null && members.some((m) => m.userId === viewerId);
    return {
      groupName: share.group.name,
      memberCount: members.length,
      sharer: sharer ? { displayName: sharer.displayName ?? sharer.user.nickname } : null,
      event: {
        title: occurrence.title,
        startsAt: occurrence.startsAt,
        endsAt: occurrence.endsAt,
        allDay: occurrence.allDay,
        repeat,
        occurrence: occurrence.occurrence,
        color,
      },
      expiresAt: share.expiresAt,
      viewer: isMember ? { member: true, ...landing(share, occurrence, eventCode) } : { member: false },
    };
  }

  /** 링크로 팀 합류. 이미 멤버면 같은 응답 (멱등, D-19). 새로 합류하면 joinCount +1 (D-185) */
  async join(userId: number, token: string): Promise<EventShareJoinResult> {
    const { share, occurrence, eventCode } = await this.findLive(token);
    const group = await this.groups.joinGroup(userId, share.groupId, { eventShareId: share.id });
    const { eventId, occurrence: occ, date } = landing(share, occurrence, eventCode);
    return { group, eventId, eventCode, occurrence: occ, date };
  }

  /** 없음, 만료, 끊김, 일정 삭제, 회차 취소, 회차 소멸을 구분하지 않고 404 (D-182) */
  private async findLive(token: string): Promise<LiveShare> {
    if (!SHARE_TOKEN_PATTERN.test(token)) throw NOT_FOUND();
    const share = await this.shares.findByToken(token);
    // 열 비교는 대소문자를 가리지 않는다 (utf8mb4_unicode_ci). 토큰은 대소문자를 구분한다
    if (!share || share.token !== token || share.revokedAt !== null || share.expiresAt.getTime() <= Date.now()) throw NOT_FOUND();
    if (share.group.type !== 'TEAM') throw NOT_FOUND();
    const row = await this.events.findInGroup(share.groupId, share.eventId);
    if (!row) throw NOT_FOUND();
    const exceptions = row.repeat ? await this.events.listExceptions(row.id) : [];
    const occurrence = resolveSharedOccurrence(row, exceptions, share.occurrence);
    if (!occurrence) throw NOT_FOUND();
    return { share, occurrence, repeat: row.repeat, eventCode: row.publicCode, color: row.color };
  }

  /** 조회, 끊기의 회차 키. 반복이면 occurrence 필수(형식만 검사), 한 번짜리 null */
  private async occurrenceKey(groupId: number, eventId: number, occurrenceRaw: unknown): Promise<string | null> {
    const row = await this.events.findInGroup(groupId, eventId);
    if (!row) throw EVENT_NOT_FOUND();
    return row.repeat ? parseOccurrence(occurrenceRaw) : null;
  }

  private toLink(share: EventShareRow): EventShareLink {
    return { token: share.token, url: `${this.config.getOrThrow<string>('WEB_ORIGIN')}/join/e/${share.token}`, expiresAt: share.expiresAt };
  }
}

function landing(share: EventShareWithGroup, occurrence: SharedOccurrence, eventCode: string): EventShareLanding {
  return {
    groupId: share.groupId,
    eventId: share.eventId,
    groupCode: share.group.publicCode,
    eventCode,
    occurrence: occurrence.occurrence,
    date: landingDate(occurrence),
  };
}

/** 반복 일정의 occurrence. 'YYYY-MM-DD' 실제 날짜가 아니면 VALIDATION_FAILED */
function parseOccurrence(raw: unknown): string {
  if (typeof raw !== 'string' || !isCalendarDate(raw)) {
    throw validationFailed('occurrence', '반복 일정은 occurrence 를 YYYY-MM-DD 로 보내야 해요');
  }
  return raw;
}
