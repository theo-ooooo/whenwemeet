import { Injectable } from '@nestjs/common';
import { birthdayOf, type BirthdayValue } from '../anniversaries/birthdays.js';
import { kstDate, type Repeat } from '../events/recurrence.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { VISIBLE_EVENT_WHERE } from '../events/visible-event.js';
import type { ChangeLogSnapshot, Platform, PushKindName } from './push-copy.js';
import { type PreferenceKind, preferenceOn } from '../notification-preferences/notification-preferences.js';
import { dateToDb, dbToDate, idsOf } from './push-db.js';

/** (#189) 투표 알림 받는 사람 판정용 */
export interface PollTargets {
  status: 'OPEN' | 'CLOSED';
  allMembers: boolean;
  creatorId: number | null;
  participantIds: number[];
}

export interface Recipient {
  userId: number;
  token: string;
  platform: Platform;
}

/** 받는 사람을 거르는 알림 종류. 푸시 종류 이름과 같고 WEEKLY 의 NUDGE 만 WEEKLY_NUDGE 를 따로 넘긴다 (D-204) */
export type SettingKind = PreferenceKind;

/** (#528) 공지 받는 사람을 한 번에 읽는 사용자 수 (id 순으로 이어 읽는다) */
export const NOTICE_RECIPIENT_PAGE = 1000;

/** 펼칠 때 읽는 저장소 (#188, #485). 받는 사람(설정, 참여자, 불참)과 문구 재료(팀, 로그, 이름, 생일, 투표 대상) */
@Injectable()
export class PushRecipientsRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ---------- 펼치기 (설계 5-6 A) ----------

  /** (#515) 숨긴 일정, 숨긴 팀의 일정은 없는 것과 같다 (알림을 보내지 않는다, D-286) */
  async eventExists(eventId: number): Promise<boolean> {
    return (await this.prisma.event.findFirst({ where: { id: eventId, ...VISIBLE_EVENT_WHERE }, select: { id: true } })) !== null;
  }

  /** 팀 이름과 (#311) 공개 코드. 팀이 지워졌거나 (#515) 숨겼으면 null (그 팀 알림은 보내지 않는다) */
  async findGroupRef(groupId: number): Promise<{ name: string; publicCode: string } | null> {
    return this.prisma.group.findFirst({ where: { id: groupId, hiddenAt: null }, select: { name: true, publicCode: true } });
  }

  /** 변경 알림 문구용 로그 스냅샷. (#311) eventCode 는 원본이 남아 있을 때만 (지워지면 로그의 eventId 가 SetNull) */
  async findChangeLog(eventLogId: number): Promise<ChangeLogSnapshot | null> {
    const row = await this.prisma.eventLog.findUnique({
      where: { id: eventLogId },
      select: {
        eventId: true,
        title: true,
        startsAt: true,
        endsAt: true,
        allDay: true,
        repeat: true,
        scope: true,
        occurrence: true,
        event: { select: { publicCode: true } },
      },
    });
    if (!row) return null;
    const { event, ...log } = row;
    return {
      ...log,
      eventCode: event?.publicCode ?? null,
      repeat: (log.repeat as Repeat | null) ?? null,
      occurrence: log.occurrence === null ? null : dbToDate(log.occurrence),
    };
  }

  /** 그 팀의 표시 이름. 나갔으면 닉네임, 탈퇴했으면 null */
  async findPersonName(groupId: number, userId: number): Promise<string | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { nickname: true, memberships: { where: { groupId }, select: { displayName: true } } },
    });
    if (!user) return null;
    return user.memberships[0]?.displayName ?? user.nickname;
  }

  /**
   * 지금 팀원 × 기기 중 종류 설정과 팀 설정이 켜진 것. excludeUserId 는 뺀다 (설계 5-6 받는 사람).
   * (#248) REMINDER 는 펼치는 순간 그 일정의 참여자만 ("모두" 면 팀원 전원). 참여자 없음이거나 일정이 없으면 0명 (D-138).
   * (#297) joinedBy 를 주면 그 시각까지 들어와 있던 팀원만 (joinedAt <= joinedBy). 지난 일을 알리는 CHANGE, JOIN 용 (D-180).
   * (#277) setting 은 푸시 종류와 같은 이름의 알림 종류 대신 볼 설정 (WEEKLY NUDGE 는 WEEKLY_NUDGE, D-204). (#369) 행이 없으면 기본값 (D-249)
   */
  async listRecipients(
    groupId: number,
    kind: PushKindName,
    excludeUserId: number | null,
    eventId: number | null = null,
    joinedBy: Date | null = null,
    setting: SettingKind = kind,
  ): Promise<Recipient[]> {
    let participantIds: number[] | null = null;
    if (kind === 'REMINDER' && eventId !== null) {
      const event = await this.prisma.event.findFirst({
        where: { id: eventId, ...VISIBLE_EVENT_WHERE },
        select: { allMembers: true, participants: { select: { userId: true } } },
      });
      if (!event) return [];
      if (!event.allMembers) participantIds = event.participants.map((row) => row.userId);
    }
    if (participantIds !== null && participantIds.length === 0) return [];
    const rows = await this.prisma.membership.findMany({
      where: {
        groupId,
        notify: true,
        user: preferenceOn(setting),
        ...(excludeUserId === null ? {} : { userId: { not: excludeUserId } }),
        ...(participantIds === null ? {} : { AND: [{ userId: { in: participantIds } }] }),
        ...(joinedBy === null ? {} : { joinedAt: { lte: joinedBy } }),
      },
      select: { userId: true, user: { select: { pushDevices: { select: { token: true, platform: true } } } } },
    });
    return rows.flatMap((row) => row.user.pushDevices.map((device) => ({ userId: row.userId, token: device.token, platform: device.platform })));
  }

  /**
   * (#190) 일정 알림에서 그 회차에 불참으로 답한 사람을 뺀다 (Q3, D-228). 한 번짜리는 회차 = 시작 KST 날짜.
   * 미정, 응답 안 함은 그대로 받는다. 일정이 없으면 그대로 돌려준다 (받는 사람 계산이 이미 0명)
   */
  async withoutNotGoing(recipients: Recipient[], eventId: number, occurrence: string | null): Promise<Recipient[]> {
    if (recipients.length === 0) return recipients;
    let date = occurrence;
    if (date === null) {
      const event = await this.prisma.event.findUnique({ where: { id: eventId }, select: { startsAt: true } });
      if (!event) return recipients;
      date = kstDate(event.startsAt);
    }
    const rows = await this.prisma.eventRsvp.findMany({
      where: { eventId, occurrence: dateToDb(date), status: 'NOT_GOING', userId: { in: [...new Set(recipients.map((r) => r.userId))] } },
      select: { userId: true },
    });
    if (rows.length === 0) return recipients;
    const out = new Set(rows.map((row) => row.userId));
    return recipients.filter((recipient) => !out.has(recipient.userId));
  }

  /** (#305) 펼칠 때 다시 본다: 그 팀에 생일을 보이는 멤버면 지금 생일 (#562 음력 여부, 윤달 포함), 나갔거나 껐거나 지웠으면 null */
  async findShownBirthday(groupId: number, userId: number): Promise<BirthdayValue | null> {
    const row = await this.prisma.membership.findFirst({
      where: { groupId, userId, showBirthday: true },
      select: { user: { select: { birthday: true, birthdayCalendar: true, birthdayLeapMonth: true } } },
    });
    return row ? birthdayOf(row.user) : null;
  }

  // ---------- (#528) 공지 (D-287) ----------

  /** 푸시 문구 재료. 지워졌거나 게시 취소(초안)면 null (보내지 않는다) */
  async findPublishedNotice(noticeId: number): Promise<{ id: number; title: string; body: string } | null> {
    return this.prisma.notice.findFirst({ where: { id: noticeId, publishedAt: { not: null } }, select: { id: true, title: true, body: true } });
  }

  /**
   * 공지 받는 사람: 기기가 하나라도 있고 공지 알림(NOTICE)을 끄지 않은 모든 사용자의 기기 전부.
   * 팀 설정(Membership.notify)은 팀 알림용이라 보지 않는다. 탈퇴한 사용자는 행이 지워져(기기도 Cascade) 빠진다.
   * 사용자 id 순으로 NOTICE_RECIPIENT_PAGE 명씩 이어 읽어 한 쿼리가 커지지 않게 한다
   */
  async listNoticeRecipients(pageSize = NOTICE_RECIPIENT_PAGE): Promise<Recipient[]> {
    const out: Recipient[] = [];
    let after = 0;
    for (;;) {
      const users = await this.prisma.user.findMany({
        where: { id: { gt: after }, pushDevices: { some: {} }, ...preferenceOn('NOTICE') },
        orderBy: { id: 'asc' },
        take: pageSize,
        select: { id: true, pushDevices: { select: { token: true, platform: true } } },
      });
      for (const user of users) for (const device of user.pushDevices) out.push({ userId: user.id, token: device.token, platform: device.platform });
      if (users.length < pageSize) return out;
      after = users[users.length - 1].id;
    }
  }

  // ---------- (#189) 약속 투표 (설계 약속-투표.md 6장, D-241) ----------

  /** 투표 알림을 펼칠 때 받을 사람을 고르는 값. 투표가 지워졌으면 null */
  async findPollTargets(pollId: number): Promise<PollTargets | null> {
    const row = await this.prisma.poll.findUnique({
      where: { id: pollId },
      select: { status: true, allMembers: true, creatorId: true, participants: { select: { userId: true } } },
    });
    if (!row) return null;
    return { status: row.status, allMembers: row.allMembers, creatorId: row.creatorId, participantIds: idsOf(row.participants) };
  }

  /**
   * (#189) userIds 중(null 이면 팀원 전원) 지금 팀원 × 기기, 약속 투표 알림(POLL)과 팀 알림이 켜진 것. excludeUserId 는 뺀다.
   * joinedBy 를 주면 그 시각까지 들어와 있던 팀원만 (지난 일을 알리는 "정함", D-180)
   */
  async listPollRecipients(groupId: number, userIds: number[] | null, excludeUserId: number | null, joinedBy: Date | null): Promise<Recipient[]> {
    if (userIds !== null && userIds.length === 0) return [];
    const rows = await this.prisma.membership.findMany({
      where: {
        groupId,
        notify: true,
        user: preferenceOn('POLL'),
        ...(excludeUserId === null ? {} : { userId: { not: excludeUserId } }),
        ...(userIds === null ? {} : { AND: [{ userId: { in: userIds } }] }),
        ...(joinedBy === null ? {} : { joinedAt: { lte: joinedBy } }),
      },
      select: { userId: true, user: { select: { pushDevices: { select: { token: true, platform: true } } } } },
    });
    return rows.flatMap((row) => row.user.pushDevices.map((device) => ({ userId: row.userId, token: device.token, platform: device.platform })));
  }
}
