import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { generatePublicCode } from '../common/public-code.js';
import { Db, PrismaService } from '../prisma/prisma.service.js';
import {
  type DeletionSnapshot,
  decodeSnapshot,
  deletionExpired,
  emptySnapshot,
  encodeSnapshot,
  keepMembers,
  reviveShares,
  type Row,
} from './deletion-snapshot.js';

/**
 * (#375) 일정 삭제 되돌리기 보관 (D-251).
 * 보관(capture*)과 복원(restore*)은 일정 삭제, 되돌리기 트랜잭션 안에서 부르는 함수다 (EventRemovalsRepository, EventSeriesRepository 가 트랜잭션을 연다).
 * 클래스는 하루 청소만 (푸시 틱이 부른다)
 */

export type DeletionKind = 'EVENT' | 'OCCURRENCE' | 'FOLLOWING';

export interface DeletionRecord {
  id: number;
  groupId: number;
  eventId: number;
  kind: DeletionKind;
  /** 'YYYY-MM-DD' (KST). EVENT 는 null */
  occurrence: string | null;
  eventLogId: number | null;
  createdAt: Date;
  snapshot: DeletionSnapshot;
}

/** 복원 결과. CONFLICT 는 그 사이 일정이 바뀌어(다시 지움, 회차 수정, 종료일 변경 등) 그대로 되돌릴 수 없음 */
export type RestoreOutcome = 'RESTORED' | 'CONFLICT';

// events/event-rows 와 같은 변환 (그쪽이 이 파일을 import 하므로 순환을 피해 여기 둔다). UTC 자정 고정
const dateToDb = (value: string): Date => new Date(`${value}T00:00:00.000Z`);
const dbToDate = (value: Date): string => value.toISOString().slice(0, 10);
const addDaysToDate = (value: string, days: number): string => dbToDate(new Date(dateToDb(value).getTime() + days * 86_400_000));

/** EVENT: 일정 행을 지우기 전에. 행과 Cascade 로 같이 지워질 자식, SetNull 로 끊길 연결을 담는다 */
export async function captureEventTx(tx: Db, eventId: number): Promise<DeletionSnapshot> {
  const where = { eventId };
  const [event, exceptions, participants, rsvps, reactions, shares, logs, importItems, poll] = await Promise.all([
    tx.event.findUniqueOrThrow({ where: { id: eventId } }),
    tx.eventException.findMany({ where, orderBy: { id: 'asc' } }),
    tx.eventParticipant.findMany({ where }),
    tx.eventRsvp.findMany({ where }),
    tx.eventReaction.findMany({ where }),
    tx.eventShare.findMany({ where, orderBy: { id: 'asc' } }),
    tx.eventLog.findMany({ where, select: { id: true } }),
    tx.eventImportItem.findMany({ where, select: { importId: true, uidHash: true } }),
    tx.poll.findUnique({ where: { eventId }, select: { id: true } }),
  ]);
  return {
    ...emptySnapshot(),
    event,
    exceptions,
    participants,
    rsvps,
    reactions,
    shares,
    links: { eventLogIds: logs.map((row) => row.id), importItems, pollId: poll?.id ?? null },
  };
}

/** OCCURRENCE: "이 일정만" 삭제가 취소 예외로 덮기 전의 그 회차 예외와 응답, 반응 */
export async function captureOccurrenceTx(tx: Db, eventId: number, occurrence: string): Promise<DeletionSnapshot> {
  const where = { eventId, occurrence: dateToDb(occurrence) };
  const [exception, rsvps, reactions] = await Promise.all([
    tx.eventException.findUnique({ where: { eventId_occurrence: where } }),
    tx.eventRsvp.findMany({ where }),
    tx.eventReaction.findMany({ where }),
  ]);
  return { ...emptySnapshot(), exceptions: exception ? [exception] : [], rsvps, reactions };
}

/** FOLLOWING: 원본 종료일을 당기기 전 값, 그 회차 이후 예외와 응답, 반응 */
export async function captureFollowingTx(tx: Db, eventId: number, occurrence: string): Promise<DeletionSnapshot> {
  const where = { eventId, occurrence: { gte: dateToDb(occurrence) } };
  const [event, exceptions, rsvps, reactions] = await Promise.all([
    tx.event.findUniqueOrThrow({ where: { id: eventId }, select: { repeatUntil: true } }),
    tx.eventException.findMany({ where, orderBy: { id: 'asc' } }),
    tx.eventRsvp.findMany({ where }),
    tx.eventReaction.findMany({ where }),
  ]);
  return { ...emptySnapshot(), repeatUntil: event.repeatUntil, exceptions, rsvps, reactions };
}

export interface DeletionInput {
  groupId: number;
  eventId: number;
  kind: DeletionKind;
  occurrence: string | null;
  actorId: number;
  eventLogId: number;
  snapshot: DeletionSnapshot;
}

/** 보관 행을 남기고 번호를 돌려준다 (DELETE 응답의 deletionId) */
export async function saveDeletionTx(tx: Db, input: DeletionInput): Promise<number> {
  const { occurrence, snapshot, ...rest } = input;
  const row = await tx.eventDeletion.create({
    data: { ...rest, occurrence: occurrence === null ? null : dateToDb(occurrence), snapshot: encodeSnapshot(snapshot) as Prisma.InputJsonValue },
    select: { id: true },
  });
  return row.id;
}

/** 되돌리기 전에 보관 행을 잠근다 (같은 삭제를 두 번 되돌리지 않게). 다른 팀이거나 없거나 기간이 지났으면 null */
export async function lockDeletionTx(tx: Db, groupId: number, deletionId: number, now: Date): Promise<DeletionRecord | null> {
  const locked = await tx.$queryRaw<{ id: number }[]>`SELECT id FROM EventDeletion WHERE id = ${deletionId} AND groupId = ${groupId} FOR UPDATE`;
  if (locked.length === 0) return null;
  const row = await tx.eventDeletion.findUniqueOrThrow({ where: { id: deletionId } });
  if (deletionExpired(row.createdAt, now)) return null;
  return {
    id: row.id,
    groupId: row.groupId,
    eventId: row.eventId,
    kind: row.kind,
    occurrence: row.occurrence === null ? null : dbToDate(row.occurrence),
    eventLogId: row.eventLogId,
    createdAt: row.createdAt,
    snapshot: decodeSnapshot(row.snapshot),
  };
}

/** 지금 멤버 (나가기와 경합하지 않게 공유 잠금, assertParticipantsTx 와 같은 규칙) */
async function memberIdsTx(tx: Db, groupId: number): Promise<Set<number>> {
  const rows = await tx.$queryRaw<{ userId: number }[]>`SELECT userId FROM Membership WHERE groupId = ${groupId} FOR SHARE`;
  return new Set(rows.map((row) => Number(row.userId)));
}

async function restoreResponsesTx(tx: Db, snapshot: DeletionSnapshot, members: Set<number>): Promise<void> {
  const rsvps = keepMembers(snapshot.rsvps, members);
  const reactions = keepMembers(snapshot.reactions, members);
  if (rsvps.length) await tx.eventRsvp.createMany({ data: rsvps as Prisma.EventRsvpCreateManyInput[], skipDuplicates: true });
  if (reactions.length) await tx.eventReaction.createMany({ data: reactions as Prisma.EventReactionCreateManyInput[], skipDuplicates: true });
}

/**
 * 보관한 모습으로 되돌린다. 먼저 지금 상태가 삭제가 남긴 그대로인지 확인하고, 아니면 아무것도 쓰지 않고 CONFLICT.
 * - EVENT: 같은 번호, 같은 공개 코드로 일정 행과 예외, 참여자, 응답, 반응, 공유 링크를 다시 넣고 끊긴 연결(기록, 가져오기, 투표)을 잇는다
 * - OCCURRENCE: 그 회차 취소 예외를 지우고 전 예외(있었다면)와 응답, 반응을 다시 넣는다
 * - FOLLOWING: 원본 종료일을 되돌리고 그 회차 이후 예외, 응답, 반응을 다시 넣는다
 * 나간 멤버의 참여자, 응답, 반응은 넣지 않는다
 */
export async function restoreDeletionTx(tx: Db, deletion: DeletionRecord, now: Date): Promise<RestoreOutcome> {
  const { snapshot } = deletion;
  if (deletion.kind === 'EVENT') return restoreEventTx(tx, deletion.groupId, snapshot, now);

  const series = await tx.event.findFirst({
    where: { id: deletion.eventId, groupId: deletion.groupId, repeat: { not: null } },
    select: { id: true, repeatUntil: true },
  });
  if (!series || deletion.occurrence === null) return 'CONFLICT';
  const occurrence = deletion.occurrence;

  if (deletion.kind === 'OCCURRENCE') {
    const current = await tx.eventException.findUnique({ where: { eventId_occurrence: { eventId: series.id, occurrence: dateToDb(occurrence) } } });
    if (!current?.cancelled) return 'CONFLICT';
    await tx.eventException.delete({ where: { id: current.id } });
    if (snapshot.exceptions.length) await tx.eventException.createMany({ data: snapshot.exceptions as Prisma.EventExceptionCreateManyInput[] });
    await restoreResponsesTx(tx, snapshot, await memberIdsTx(tx, deletion.groupId));
    return 'RESTORED';
  }

  // FOLLOWING: 원본이 삭제가 당긴 종료일 그대로이고 그 회차 이후 예외가 없어야 한다
  const truncatedTo = addDaysToDate(occurrence, -1);
  const after = await tx.eventException.count({ where: { eventId: series.id, occurrence: { gte: dateToDb(occurrence) } } });
  if (series.repeatUntil === null || dbToDate(series.repeatUntil) !== truncatedTo || after > 0) return 'CONFLICT';
  await tx.event.update({ where: { id: series.id }, data: { repeatUntil: snapshot.repeatUntil ?? null } });
  if (snapshot.exceptions.length) await tx.eventException.createMany({ data: snapshot.exceptions as Prisma.EventExceptionCreateManyInput[] });
  await restoreResponsesTx(tx, snapshot, await memberIdsTx(tx, deletion.groupId));
  return 'RESTORED';
}

async function restoreEventTx(tx: Db, groupId: number, snapshot: DeletionSnapshot, now: Date): Promise<RestoreOutcome> {
  const event = snapshot.event as Row | null;
  if (!event) return 'CONFLICT';
  const eventId = event.id as number;
  if (await tx.event.findUnique({ where: { id: eventId }, select: { id: true } })) return 'CONFLICT';

  const members = await memberIdsTx(tx, groupId);
  const userIds = [event.creatorId, ...snapshot.shares.map((row) => row.createdById)].filter((id): id is number => typeof id === 'number');
  const existing = new Set(
    userIds.length ? (await tx.user.findMany({ where: { id: { in: userIds } }, select: { id: true } })).map((row) => row.id) : [],
  );
  // 공개 코드는 그대로 (주소, 공유 링크가 같은 일정을 연다). 7일 사이 같은 코드가 새로 생겼을 때만 새로 만든다
  const codeTaken = await tx.event.findUnique({ where: { publicCode: event.publicCode as string }, select: { id: true } });
  const creatorId = typeof event.creatorId === 'number' && existing.has(event.creatorId) ? event.creatorId : null;
  // (#444) "모두"(allMembers) 였던 일정은 되돌리는 시각 멤버 전원을 참여자 행으로 (D-263). "모두" 로 되살리지 않는다
  const wasAll = event.allMembers === true;
  await tx.event.create({
    data: { ...event, creatorId, allMembers: false, ...(codeTaken ? { publicCode: generatePublicCode() } : {}) } as Prisma.EventUncheckedCreateInput,
  });

  if (snapshot.exceptions.length) await tx.eventException.createMany({ data: snapshot.exceptions as Prisma.EventExceptionCreateManyInput[] });
  const participants = wasAll ? [...members].map((userId) => ({ eventId, userId })) : keepMembers(snapshot.participants, members);
  if (participants.length) await tx.eventParticipant.createMany({ data: participants as Prisma.EventParticipantCreateManyInput[] });
  await restoreResponsesTx(tx, snapshot, members);
  const shares = reviveShares(snapshot.shares, members, existing, now);
  if (shares.length) await tx.eventShare.createMany({ data: shares as Prisma.EventShareCreateManyInput[], skipDuplicates: true });

  const { eventLogIds, importItems, pollId } = snapshot.links;
  if (eventLogIds.length) await tx.eventLog.updateMany({ where: { id: { in: eventLogIds }, groupId, eventId: null }, data: { eventId } });
  if (importItems.length) await tx.eventImportItem.updateMany({ where: { OR: importItems, eventId: null }, data: { eventId } });
  if (pollId !== null) await tx.poll.updateMany({ where: { id: pollId, groupId, eventId: null }, data: { eventId } });
  return 'RESTORED';
}

/** 되돌린 보관 행과 그 삭제의 DELETED 로그를 지운다 (새 소식에서 숨김) */
export async function finishRestoreTx(tx: Db, deletion: DeletionRecord): Promise<void> {
  if (deletion.eventLogId !== null) await tx.eventLog.deleteMany({ where: { id: deletion.eventLogId, action: 'DELETED' } });
  await tx.eventDeletion.delete({ where: { id: deletion.id } });
}

@Injectable()
export class EventDeletionsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** 하루 청소: 보관 기간이 지난 행 (D-251) */
  async purgeCreatedBefore(before: Date): Promise<number> {
    const { count } = await this.prisma.eventDeletion.deleteMany({ where: { createdAt: { lt: before } } });
    return count;
  }
}
