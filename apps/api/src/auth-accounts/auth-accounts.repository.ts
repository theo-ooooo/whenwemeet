import { Injectable } from '@nestjs/common';
import { DEFAULT_ANNIVERSARY_REMINDERS } from '../anniversaries/anniversary-reminders.js';
import type { LinkCandidate } from '../auth-link-tickets/auth-link-tickets.repository.js';
import type { AuthProvider, LinkedAccount } from '../auth/providers/auth-provider.js';
import type { StoredObjectRef } from '../files/files.repository.js';
import { type Db, PrismaService } from '../prisma/prisma.service.js';

type Tx = Db;

/** 목록과 연결 결과에 쓰는 연결 계정 */
export interface AuthAccountRow {
  id: number;
  provider: AuthProvider;
  providerUserId: string;
  email: string | null;
  createdAt: Date;
}

const ACCOUNT_SELECT = { id: true, provider: true, providerUserId: true, email: true, createdAt: true } as const;

/** 해제할 계정 (제공자 unlink 에 넘긴다) */
export interface OwnedAccount extends LinkedAccount {
  id: number;
  provider: AuthProvider;
}

/** 흡수한 빈 계정. 행은 지웠고 저장소 객체는 Service 가 커밋 뒤에 지운다 */
export interface AbsorbedUser {
  userId: number;
  files: Omit<StoredObjectRef, 'id'>[];
}

export type LinkOutcome =
  | { kind: 'LINKED'; account: AuthAccountRow; absorbed: AbsorbedUser | null }
  | { kind: 'ALREADY_MINE'; account: AuthAccountRow }
  | { kind: 'PROVIDER_TAKEN' }
  | { kind: 'IN_USE'; blockers: string[] };

export type UnlinkOutcome = 'DELETED' | 'LAST' | 'NOT_FOUND';

/**
 * (#198) 빈 계정 판정이 보는 User 관계 (D-257). 새 관계를 User 에 추가하면 이 표나 아래 정리 표에 넣어야
 * auth-accounts.repository.spec 의 스키마 대조 테스트가 통과한다 (빠뜨리면 데이터 있는 계정을 지울 수 있다)
 */
export const ABSORB_CHECKED_USER_RELATIONS = [
  'files',
  'authAccounts',
  'memberships',
  'createdEvents',
  'anniversaries',
  'eventLogs',
  'groupActivities',
  'eventImports',
  'eventParticipations',
  'eventShares',
  'startGroup',
  'todoListsCreated',
  'todoListsEdited',
  'todoItemsCreated',
  'todoItemsDone',
  'calendarFeeds',
  'eventRsvps',
  'eventReactions',
  'pollsCreated',
  'pollVotes',
  'pollParticipations',
  'notificationPreferences',
  'birthdayReminders',
  'eventDeletions',
  // (#515) 쓴 공지, 숨긴 팀과 일정, 관리자 조치 기록 (관리자 계정은 빈 계정으로 보지 않는다)
  'notices',
  'hiddenGroups',
  'hiddenEvents',
  'adminActions',
  // (#536) 한 신고, 처리한 신고 (흡수로 지우면 신고한 사람이 비므로 데이터로 본다)
  'reports',
  'resolvedReports',
] as const;

/**
 * 흡수 때 데이터로 보지 않고 지우는 User 관계 (로그인 부속물, 받은 알림, 프로필 사진, (#450) AI 비서 하루 횟수, (#532) 접속 기종,
 * (#538) 닫은 팝업 공지는 User 삭제 Cascade)
 */
export const ABSORB_CLEANED_USER_RELATIONS = ['avatar', 'authHandoffs', 'authLinkTickets', 'pushDevices', 'pushDeliveries', 'assistantUsages', 'clients', 'noticeDismissals'] as const;

/** 빈 계정의 개인 팀에서 0 이어야 하는 Group 관계. startUsers 는 개인 팀을 고정할 수 없어(D-191) 판정 밖 */
export const ABSORB_CHECKED_GROUP_RELATIONS = [
  'memberships',
  'events',
  'anniversaries',
  'eventLogs',
  'pushNotifications',
  'activities',
  'eventImports',
  'eventShares',
  'todoLists',
  'calendarFeeds',
  'polls',
  'eventDeletions',
  // (#515) 운영 숨김된 개인 팀은 흡수(삭제)하지 않는다
  'hiddenBy',
] as const;
export const ABSORB_IGNORED_GROUP_RELATIONS = ['startUsers'] as const;

/** 카카오, Apple, 이메일 순 (D-116 버튼 순서). 그 밖은 뒤 */
const PROVIDER_ORDER: Record<AuthProvider, number> = { KAKAO: 0, APPLE: 1, EMAIL: 2, GOOGLE: 3, NAVER: 4, DEV: 5 };

function isDefaultBirthdayReminders(rows: readonly { offset: string }[]): boolean {
  const offsets = rows.map((row) => row.offset).sort();
  const defaults = [...DEFAULT_ANNIVERSARY_REMINDERS].sort();
  return offsets.length === defaults.length && offsets.every((offset, index) => offset === defaults[index]);
}

/**
 * 빈 계정이 아닌 이유 목록 (D-257, 충돌 정책 2). 비었으면 []. 하나라도 사용자 데이터가 있으면 막는다(보수적).
 * - 연결 계정이 그 하나뿐, 멤버십은 개인 팀 하나뿐
 * - 개인 팀: 다른 멤버, 일정, 기념일, 할 일 목록, 투표, 가져오기, 공유 링크, 새 소식 기록, 팀 활동, 삭제 보관, 구독 주소, 알림 묶음이 0
 * - 사용자 단위: 만든 일정과 기념일, 기록, 활동, 가져오기, 참여, 공유 링크, 할 일(만들기, 고치기, 완료), 구독 주소,
 *   참석 응답, 반응, 투표(만들기, 표, 대상), 알림 설정 행, 삭제 보관, 사진 밖의 파일이 0
 * - 설정: 생일 없음, 처음 여는 달력 기본(LAST), 생일 알림 시점 기본(당일)
 */
export async function findAbsorbBlockers(tx: Tx, userId: number): Promise<string[]> {
  const user = await tx.user.findUnique({
    where: { id: userId },
    select: { birthday: true, startCalendarMode: true, role: true, birthdayReminders: { select: { offset: true } } },
  });
  if (!user) return ['user'];
  const blockers: string[] = [];
  if (user.birthday !== null) blockers.push('birthday');
  if (user.startCalendarMode !== 'LAST') blockers.push('startCalendar');
  if (!isDefaultBirthdayReminders(user.birthdayReminders)) blockers.push('birthdayReminders');
  // (#515) 관리자 계정은 흡수하지 않는다
  if (user.role !== 'user') blockers.push('role');

  const memberships = await tx.membership.findMany({ where: { userId }, select: { groupId: true, group: { select: { type: true } } } });
  if (memberships.some((m) => m.group.type !== 'PERSONAL')) blockers.push('memberships');
  const personal = memberships.filter((m) => m.group.type === 'PERSONAL').map((m) => m.groupId);
  if (personal.length !== 1) blockers.push('personalGroup');
  const inGroup = { groupId: { in: personal } };

  const counts: [string, Promise<number>][] = [
    ['authAccounts', tx.authAccount.count({ where: { userId } }).then((n) => (n === 1 ? 0 : n))],
    ['files', tx.file.count({ where: { ownerId: userId, kind: { not: 'AVATAR' } } })],
    ['group.memberships', tx.membership.count({ where: { ...inGroup, userId: { not: userId } } })],
    ['group.events', tx.event.count({ where: inGroup })],
    ['group.anniversaries', tx.anniversary.count({ where: inGroup })],
    ['group.eventLogs', tx.eventLog.count({ where: inGroup })],
    ['group.pushNotifications', tx.pushNotification.count({ where: inGroup })],
    ['group.activities', tx.groupActivity.count({ where: inGroup })],
    ['group.eventImports', tx.eventImport.count({ where: inGroup })],
    ['group.eventShares', tx.eventShare.count({ where: inGroup })],
    ['group.todoLists', tx.todoList.count({ where: inGroup })],
    ['group.calendarFeeds', tx.calendarFeed.count({ where: inGroup })],
    ['group.polls', tx.poll.count({ where: inGroup })],
    ['group.eventDeletions', tx.eventDeletion.count({ where: inGroup })],
    ['group.hiddenBy', tx.group.count({ where: { id: { in: personal }, hiddenAt: { not: null } } })],
    ['createdEvents', tx.event.count({ where: { creatorId: userId } })],
    ['anniversaries', tx.anniversary.count({ where: { creatorId: userId } })],
    ['eventLogs', tx.eventLog.count({ where: { actorId: userId } })],
    ['groupActivities', tx.groupActivity.count({ where: { actorId: userId } })],
    ['eventImports', tx.eventImport.count({ where: { userId } })],
    ['eventParticipations', tx.eventParticipant.count({ where: { userId } })],
    ['eventShares', tx.eventShare.count({ where: { createdById: userId } })],
    ['todoLists', tx.todoList.count({ where: { OR: [{ creatorId: userId }, { editorId: userId }] } })],
    ['todoItems', tx.todoItem.count({ where: { OR: [{ creatorId: userId }, { doneById: userId }] } })],
    ['calendarFeeds', tx.calendarFeed.count({ where: { userId } })],
    ['eventRsvps', tx.eventRsvp.count({ where: { userId } })],
    ['eventReactions', tx.eventReaction.count({ where: { userId } })],
    ['pollsCreated', tx.poll.count({ where: { creatorId: userId } })],
    ['pollVotes', tx.pollVote.count({ where: { userId } })],
    ['pollParticipations', tx.pollParticipant.count({ where: { userId } })],
    ['notificationPreferences', tx.notificationPreference.count({ where: { userId } })],
    ['eventDeletions', tx.eventDeletion.count({ where: { actorId: userId } })],
    ['notices', tx.notice.count({ where: { createdById: userId } })],
    ['hiddenGroups', tx.group.count({ where: { hiddenById: userId } })],
    ['hiddenEvents', tx.event.count({ where: { hiddenById: userId } })],
    ['adminActions', tx.adminAction.count({ where: { adminId: userId } })],
    ['reports', tx.report.count({ where: { reporterId: userId } })],
    ['resolvedReports', tx.report.count({ where: { resolvedById: userId } })],
  ];
  // 한 트랜잭션은 연결 하나라 차례로 센다
  for (const [name, count] of counts) {
    if ((await count) > 0) blockers.push(name);
  }
  return blockers;
}

/** (#198) 로그인 방법 연결, 해제, 빈 계정 흡수 (D-257) */
@Injectable()
export class AuthAccountsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** 내 연결 계정. 카카오, Apple, 이메일 순, 같은 제공자는 오래된 순 */
  async list(userId: number): Promise<AuthAccountRow[]> {
    const rows = await this.prisma.authAccount.findMany({ where: { userId }, orderBy: { id: 'asc' }, select: ACCOUNT_SELECT });
    return rows.sort((a, b) => PROVIDER_ORDER[a.provider] - PROVIDER_ORDER[b.provider]);
  }

  findOwned(userId: number, id: number): Promise<OwnedAccount | null> {
    return this.prisma.authAccount.findFirst({
      where: { id, userId },
      select: { id: true, provider: true, providerUserId: true, providerClientId: true, refreshToken: true },
    });
  }

  countByUser(userId: number): Promise<number> {
    return this.prisma.authAccount.count({ where: { userId } });
  }

  /** 같은 제공자의 연결이 이미 있는지 (연결 시작 전 빠른 확인. 최종 판정은 linkTx 안) */
  async hasProvider(userId: number, provider: AuthProvider): Promise<boolean> {
    return (await this.prisma.authAccount.count({ where: { userId, provider } })) > 0;
  }

  /**
   * 연결 한 트랜잭션 (D-257).
   * 1. 내 사용자 행을 잠근다(FOR UPDATE): 같은 사용자의 연결, 해제가 차례로 돈다 (한 제공자 하나 규칙의 경합)
   * 2. 연결하려는 (provider, providerUserId) 행을 잠근다. 이미 내 것이면 ALREADY_MINE
   * 3. 내가 같은 제공자를 이미 가졌으면 PROVIDER_TAKEN
   * 4. 다른 사용자(B) 의 것이면 B 를 잠그고 빈 계정인지 다시 판정. 아니면 IN_USE.
   *    비었으면 흡수: 개인 팀, handoff, 푸시 기기, 연결 메일 행, 파일 행을 지우고 그 연결 계정을 나에게 옮긴 뒤 B 삭제 (제공자 unlink 안 함)
   * 5. 없으면 새로 만든다. 동시에 같은 계정을 만들면 유일키(provider, providerUserId)가 하나만 남긴다
   */
  linkTx(userId: number, candidate: LinkCandidate): Promise<LinkOutcome> {
    return this.prisma.$transaction(async (tx): Promise<LinkOutcome> => {
      await tx.$queryRaw`SELECT id FROM \`User\` WHERE id = ${userId} FOR UPDATE`;
      const [existing] = await tx.$queryRaw<{ id: number; userId: number }[]>`
        SELECT id, userId FROM AuthAccount WHERE provider = ${candidate.provider} AND providerUserId = ${candidate.providerUserId} FOR UPDATE`;
      if (existing && existing.userId === userId) {
        return { kind: 'ALREADY_MINE', account: await tx.authAccount.findUniqueOrThrow({ where: { id: existing.id }, select: ACCOUNT_SELECT }) };
      }
      if ((await tx.authAccount.count({ where: { userId, provider: candidate.provider } })) > 0) return { kind: 'PROVIDER_TAKEN' };

      const credentials = candidate.credentials ?? {};
      if (!existing) {
        const account = await tx.authAccount.create({
          data: {
            userId,
            provider: candidate.provider,
            providerUserId: candidate.providerUserId,
            email: candidate.email,
            ...(candidate.rawProfile === null ? {} : { rawProfile: candidate.rawProfile }),
            ...credentials,
          },
          select: ACCOUNT_SELECT,
        });
        return { kind: 'LINKED', account, absorbed: null };
      }

      const otherId = existing.userId;
      await tx.$queryRaw`SELECT id FROM \`User\` WHERE id = ${otherId} FOR UPDATE`;
      const blockers = await findAbsorbBlockers(tx, otherId);
      if (blockers.length > 0) return { kind: 'IN_USE', blockers };

      const files = await tx.file.findMany({ where: { ownerId: otherId }, select: { provider: true, bucket: true, key: true } });
      const personal = await tx.membership.findMany({ where: { userId: otherId }, select: { groupId: true } });
      await tx.group.deleteMany({ where: { id: { in: personal.map((m) => m.groupId) }, type: 'PERSONAL' } });
      await tx.authHandoff.deleteMany({ where: { userId: otherId } });
      await tx.pushDevice.deleteMany({ where: { userId: otherId } });
      await tx.emailLoginChallenge.deleteMany({ where: { purpose: 'LINK', userId: otherId } });
      const account = await tx.authAccount.update({
        where: { id: existing.id },
        data: { userId, ...(candidate.rawProfile === null ? {} : { rawProfile: candidate.rawProfile }), ...credentials },
        select: ACCOUNT_SELECT,
      });
      await tx.user.update({ where: { id: otherId }, data: { avatarFileId: null } });
      await tx.file.deleteMany({ where: { ownerId: otherId } });
      await tx.user.delete({ where: { id: otherId } });
      return { kind: 'LINKED', account, absorbed: { userId: otherId, files } };
    });
  }

  /**
   * 해제 한 트랜잭션. 내 사용자 행을 잠그고 다시 세어 마지막 하나면 LAST (동시에 둘을 지워도 하나는 남는다).
   * 이메일이면 그 이메일의 발송 기록도 지운다 (탈퇴와 같은 원칙, 이메일-로그인.md 8-1)
   */
  unlinkTx(userId: number, accountId: number): Promise<UnlinkOutcome> {
    return this.prisma.$transaction(async (tx): Promise<UnlinkOutcome> => {
      await tx.$queryRaw`SELECT id FROM \`User\` WHERE id = ${userId} FOR UPDATE`;
      const account = await tx.authAccount.findFirst({ where: { id: accountId, userId }, select: { provider: true, providerUserId: true } });
      if (!account) return 'NOT_FOUND';
      if ((await tx.authAccount.count({ where: { userId } })) <= 1) return 'LAST';
      await tx.authAccount.delete({ where: { id: accountId } });
      if (account.provider === 'EMAIL') await tx.emailLoginChallenge.deleteMany({ where: { email: account.providerUserId } });
      return 'DELETED';
    });
  }
}
