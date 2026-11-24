import { Injectable } from '@nestjs/common';
import type { ParticipantSet } from '../events/participants.js';
import { snapshotName } from '../group-activities/activity.js';
import { GroupActivitiesRepository } from '../group-activities/group-activities.repository.js';
import { Db, PrismaService } from '../prisma/prisma.service.js';
import {
  isSameRsvpTarget,
  type ReactionKind,
  type ReactionRecord,
  RSVP_NEWS_MERGE_MS,
  type RsvpActivityPayload,
  type RsvpRecord,
  type RsvpStatus,
} from './responses.js';

/** 목록 집계용 행 (회차 날짜 포함) */
export type RsvpListRow = Pick<RsvpRecord, 'userId' | 'status'> & { eventId: number; occurrence: string };
export type ReactionListRow = Pick<ReactionRecord, 'userId' | 'kind'> & { eventId: number; occurrence: string };

/** 회차 하나 */
export interface OccurrenceRef {
  groupId: number;
  eventId: number;
  /** 'YYYY-MM-DD' (KST). 한 번짜리는 시작 날짜 */
  occurrence: string;
}

export interface RsvpWrite extends OccurrenceRef {
  userId: number;
  status: RsvpStatus | null;
  /** 그 회차의 지금 시각 (D-226) */
  startsAt: Date;
  endsAt: Date;
  /** 새 소식 payload 의 나머지. status 는 저장 값으로 채운다 */
  news: Omit<RsvpActivityPayload, 'status'>;
}

export interface ReactionWrite extends OccurrenceRef {
  userId: number;
  reaction: ReactionKind | null;
}

/** 쓰기 결과. 멤버나 참여자 확인은 쓰기 트랜잭션 안에서 한다 (참여자 변경, 나가기와 경합) */
export type WriteOutcome = 'SAVED' | 'UNCHANGED' | 'NOT_MEMBER' | 'NOT_PARTICIPANT';

// events/event-rows 의 같은 함수 (그쪽이 이 파일을 import 하므로 순환을 피해 여기 둔다). UTC 자정 고정
const dateToDb = (value: string): Date => new Date(`${value}T00:00:00.000Z`);
const dbToDate = (value: Date): string => value.toISOString().slice(0, 10);

const RSVP_SELECT = { userId: true, status: true, seenStartsAt: true, seenEndsAt: true, updatedAt: true } as const;
const REACTION_SELECT = { userId: true, kind: true, createdAt: true } as const;

// ---------- 일정 변경 트랜잭션이 부르는 정리 (#190 설계 4장) ----------

/** 한 번짜리 일정의 시작 날짜가 바뀌면 응답, 반응의 회차 날짜를 옮긴다 (행이 고아가 되지 않게) */
export async function moveOnceResponsesTx(db: Db, eventId: number, occurrence: string): Promise<void> {
  const where = { eventId, occurrence: { not: dateToDb(occurrence) } };
  await db.eventRsvp.updateMany({ where, data: { occurrence: dateToDb(occurrence) } });
  await db.eventReaction.updateMany({ where, data: { occurrence: dateToDb(occurrence) } });
}

/** 참여자를 바꾸면 빠진 사람의 응답을 지운다 (반응은 팀원 누구나라 그대로). 모두면 지울 사람 없음 */
export async function pruneRsvpsTx(db: Db, eventId: number, participants: ParticipantSet): Promise<void> {
  if (participants.allMembers) return;
  await db.eventRsvp.deleteMany({ where: { eventId, userId: { notIn: participants.ids.length ? participants.ids : [0] } } });
}

/** "이 일정만" 삭제: 그 회차 응답, 반응 삭제 */
export async function deleteOccurrenceResponsesTx(db: Db, eventId: number, occurrence: string): Promise<void> {
  const where = { eventId, occurrence: dateToDb(occurrence) };
  await db.eventRsvp.deleteMany({ where });
  await db.eventReaction.deleteMany({ where });
}

/** 그 회차(포함) 이후 응답, 반응. to 가 있으면 그 원본으로 옮기고, 없으면 지운다 (D-225) */
export async function moveResponsesFromTx(db: Db, eventId: number, occurrence: string, to: number | null): Promise<void> {
  const where = { eventId, occurrence: { gte: dateToDb(occurrence) } };
  if (to === null) {
    await db.eventRsvp.deleteMany({ where });
    await db.eventReaction.deleteMany({ where });
    return;
  }
  await db.eventRsvp.updateMany({ where, data: { eventId: to } });
  await db.eventReaction.updateMany({ where, data: { eventId: to } });
}

/** 일정의 응답, 반응 전부 삭제 (회차 날짜가 모두 바뀌는 "이후 모두" 첫 회차 수정) */
export async function deleteAllResponsesTx(db: Db, eventId: number): Promise<void> {
  await db.eventRsvp.deleteMany({ where: { eventId } });
  await db.eventReaction.deleteMany({ where: { eventId } });
}

/** 팀 나가기, 탈퇴: 그 팀 일정의 내 응답, 반응 삭제 */
export async function deleteMemberResponsesTx(db: Db, userId: number, groupId: number): Promise<void> {
  await db.eventRsvp.deleteMany({ where: { userId, event: { groupId } } });
  await db.eventReaction.deleteMany({ where: { userId, event: { groupId } } });
}

@Injectable()
export class EventResponsesRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activities: GroupActivitiesRepository,
  ) {}

  /** 목록 집계: 일정들의 [fromDate, toDate] 회차 응답, 반응. PK (eventId, occurrence, userId) 로 읽는다 */
  async listForEvents(eventIds: number[], fromDate: string, toDate: string): Promise<{ rsvps: RsvpListRow[]; reactions: ReactionListRow[] }> {
    if (eventIds.length === 0) return { rsvps: [], reactions: [] };
    const where = { eventId: { in: eventIds }, occurrence: { gte: dateToDb(fromDate), lte: dateToDb(toDate) } };
    const [rsvps, reactions] = await Promise.all([
      this.prisma.eventRsvp.findMany({ where, select: { eventId: true, occurrence: true, userId: true, status: true } }),
      this.prisma.eventReaction.findMany({ where, select: { eventId: true, occurrence: true, userId: true, kind: true } }),
    ]);
    return {
      rsvps: rsvps.map((row) => ({ ...row, occurrence: dbToDate(row.occurrence) })),
      reactions: reactions.map((row) => ({ ...row, occurrence: dbToDate(row.occurrence) })),
    };
  }

  /** 회차 하나의 응답, 반응 전부 */
  async listForOccurrence(eventId: number, occurrence: string): Promise<{ rsvps: RsvpRecord[]; reactions: ReactionRecord[] }> {
    const where = { eventId, occurrence: dateToDb(occurrence) };
    const [rsvps, reactions] = await Promise.all([
      this.prisma.eventRsvp.findMany({ where, select: RSVP_SELECT }),
      this.prisma.eventReaction.findMany({ where, select: REACTION_SELECT }),
    ]);
    return { rsvps, reactions };
  }

  /**
   * 참석 여부 저장 (D-224). 트랜잭션 안에서 멤버십과 일정 행을 공유 잠금으로 읽어 참여자인지 확인한다:
   * 참여자 변경(일정 행 수정 + 빠진 사람 응답 삭제)과 나가기(멤버십 삭제 + 응답 삭제)가 먼저면 여기서 걸리고, 이쪽이 먼저면 그쪽이 지운다.
   * 같은 값이면 쓰지 않는다 (#62). 정하거나 바꾸면 새 소식 EVENT_RSVP, 2분 안 같은 회차는 그 줄을 고친다. 취소는 2분 안 줄만 지운다 (D-227)
   */
  saveRsvp(input: RsvpWrite, now: Date = new Date()): Promise<WriteOutcome> {
    return this.prisma.$transaction(async (tx) => {
      const actor = await lockMemberTx(tx, input.groupId, input.userId);
      if (!actor) return 'NOT_MEMBER';
      if (!(await isParticipantTx(tx, input.groupId, input.eventId, input.userId))) return 'NOT_PARTICIPANT';
      const key = { eventId_occurrence_userId: { eventId: input.eventId, occurrence: dateToDb(input.occurrence), userId: input.userId } };
      const current = await tx.eventRsvp.findUnique({ where: key, select: { status: true } });
      if ((current?.status ?? null) === input.status) return 'UNCHANGED';

      if (input.status === null) {
        await tx.eventRsvp.delete({ where: key });
      } else {
        const values = { status: input.status, seenStartsAt: input.startsAt, seenEndsAt: input.endsAt };
        await tx.eventRsvp.upsert({
          where: key,
          create: { eventId: input.eventId, occurrence: dateToDb(input.occurrence), userId: input.userId, ...values },
          update: values,
        });
      }
      await this.recordRsvpNewsTx(tx, input, actor, now);
      return 'SAVED';
    });
  }

  /** 반응 저장. 팀원이면 누구나 (D-224). 같은 값이면 쓰지 않는다. 새 소식에 남기지 않는다 */
  saveReaction(input: ReactionWrite): Promise<WriteOutcome> {
    return this.prisma.$transaction(async (tx) => {
      if (!(await lockMemberTx(tx, input.groupId, input.userId))) return 'NOT_MEMBER';
      const key = { eventId_occurrence_userId: { eventId: input.eventId, occurrence: dateToDb(input.occurrence), userId: input.userId } };
      const current = await tx.eventReaction.findUnique({ where: key, select: { kind: true } });
      if ((current?.kind ?? null) === input.reaction) return 'UNCHANGED';
      if (input.reaction === null) {
        await tx.eventReaction.delete({ where: key });
      } else {
        await tx.eventReaction.upsert({
          where: key,
          create: { eventId: input.eventId, occurrence: dateToDb(input.occurrence), userId: input.userId, kind: input.reaction },
          update: { kind: input.reaction, createdAt: new Date() },
        });
      }
      return 'SAVED';
    });
  }

  private async recordRsvpNewsTx(tx: Db, input: RsvpWrite, actor: { displayName: string | null; nickname: string }, now: Date): Promise<void> {
    const since = new Date(now.getTime() - RSVP_NEWS_MERGE_MS);
    const recent = await this.activities.listRsvpActivitiesTx(tx, input.groupId, input.userId, since);
    const same = recent.find((row) => isSameRsvpTarget(row.payload, input.eventId, input.news.occurrence));
    if (input.status === null) {
      // 정한 지 2분 안에 취소하면 기록도 지운다. 그보다 오래된 기록은 그대로 둔다 (취소는 새 소식에 남기지 않는다)
      if (same) await this.activities.deleteTx(tx, same.id);
      return;
    }
    const payload: RsvpActivityPayload = { ...input.news, status: input.status };
    if (same) {
      await this.activities.replaceTx(tx, same.id, payload, now);
      return;
    }
    await this.activities.recordTx(tx, {
      groupId: input.groupId,
      type: 'EVENT_RSVP',
      actor: { id: input.userId, name: snapshotName(actor.displayName, actor.nickname) },
      payload,
    });
  }
}

/** 멤버십 행을 공유 잠금으로 읽는다 (D-133 과 같은 방식). 멤버가 아니면 null */
async function lockMemberTx(tx: Db, groupId: number, userId: number): Promise<{ displayName: string | null; nickname: string } | null> {
  const rows = await tx.$queryRaw<{ displayName: string | null; nickname: string }[]>`
    SELECT m.displayName AS displayName, u.nickname AS nickname
    FROM Membership m JOIN User u ON u.id = m.userId
    WHERE m.groupId = ${groupId} AND m.userId = ${userId}
    FOR SHARE OF m`;
  return rows[0] ?? null;
}

/** 일정 행을 공유 잠금으로 읽고 참여자인지 본다. 모두면 멤버면 참여자 */
async function isParticipantTx(tx: Db, groupId: number, eventId: number, userId: number): Promise<boolean> {
  const events = await tx.$queryRaw<{ allMembers: number | boolean }[]>`
    SELECT allMembers FROM Event WHERE id = ${eventId} AND groupId = ${groupId} FOR SHARE`;
  const event = events[0];
  if (!event) return false;
  if (event.allMembers) return true;
  const rows = await tx.eventParticipant.count({ where: { eventId, userId } });
  return rows > 0;
}
