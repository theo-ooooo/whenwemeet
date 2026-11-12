import { Injectable } from '@nestjs/common';
import { Db, PrismaService } from '../prisma/prisma.service.js';

/** (#274) 일정 공유 링크 한 행 (D-181). occurrence 는 'YYYY-MM-DD' (KST), 한 번짜리는 null */
export interface EventShareRow {
  id: number;
  token: string;
  groupId: number;
  eventId: number;
  occurrence: string | null;
  createdById: number | null;
  createdAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
  joinCount: number;
}

/** 링크로 찾은 행 + 팀 이름과 종류 */
export interface EventShareWithGroup extends EventShareRow {
  group: { name: string; type: 'PERSONAL' | 'TEAM' };
}

export interface EventShareCreateInput {
  token: string;
  groupId: number;
  eventId: number;
  occurrence: string | null;
  createdById: number;
  expiresAt: Date;
}

/** `@db.Date` ↔ 'YYYY-MM-DD' (events.repository 의 dateToDb, dbToDate 와 같은 규칙) */
const dateToDb = (value: string): Date => new Date(`${value}T00:00:00.000Z`);
const dbToDate = (value: Date): string => value.toISOString().slice(0, 10);

const SHARE_SELECT = {
  id: true,
  token: true,
  groupId: true,
  eventId: true,
  occurrence: true,
  createdById: true,
  createdAt: true,
  expiresAt: true,
  revokedAt: true,
  joinCount: true,
} as const;

type ShareRecord = Omit<EventShareRow, 'occurrence'> & { occurrence: Date | null };

function toRow(record: ShareRecord): EventShareRow {
  return { ...record, occurrence: record.occurrence === null ? null : dbToDate(record.occurrence) };
}

/** 살아 있는 링크 조건: 끊기지 않았고 만료 전 (D-181) */
function liveWhere(now: Date) {
  return { revokedAt: null, expiresAt: { gt: now } };
}

function occurrenceWhere(occurrence: string | null) {
  return occurrence === null ? null : dateToDb(occurrence);
}

/**
 * (#274) 일정 공유 링크 (D-181 ~ D-183). 쓰기는 이 Repository 에만 있고,
 * 초대 코드 재발급과 나가기/탈퇴는 그 트랜잭션 안에서 `revoke...Tx` 를 부른다
 */
@Injectable()
export class EventSharesRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** 그 일정(회차)의 살아 있는 링크. 없으면 null */
  async findLive(eventId: number, occurrence: string | null, now: Date): Promise<EventShareRow | null> {
    const row = await this.prisma.eventShare.findFirst({
      where: { eventId, occurrence: occurrenceWhere(occurrence), ...liveWhere(now) },
      orderBy: { id: 'desc' },
      select: SHARE_SELECT,
    });
    return row && toRow(row);
  }

  /**
   * 살아 있는 링크가 있으면 그것, 없으면 새로 만든다. 같은 일정(회차)에는 팀 전체가 링크 하나 (D-182).
   * 일정 행을 잠가(FOR UPDATE) 같은 일정에 동시에 두 번 만들어도 하나만 생긴다
   */
  findOrCreateLiveTx(input: EventShareCreateInput, now: Date): Promise<{ share: EventShareRow; created: boolean }> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM \`Event\` WHERE id = ${input.eventId} FOR UPDATE`;
      const existing = await tx.eventShare.findFirst({
        where: { eventId: input.eventId, occurrence: occurrenceWhere(input.occurrence), ...liveWhere(now) },
        orderBy: { id: 'desc' },
        select: SHARE_SELECT,
      });
      if (existing) return { share: toRow(existing), created: false };
      const created = await tx.eventShare.create({
        data: { ...input, occurrence: occurrenceWhere(input.occurrence), createdAt: now },
        select: SHARE_SELECT,
      });
      return { share: toRow(created), created: true };
    });
  }

  /** 그 일정(회차)의 살아 있는 링크를 끊는다. 없으면 아무것도 하지 않는다 */
  async revokeLive(eventId: number, occurrence: string | null, now: Date): Promise<void> {
    await this.prisma.eventShare.updateMany({
      where: { eventId, occurrence: occurrenceWhere(occurrence), ...liveWhere(now) },
      data: { revokedAt: now },
    });
  }

  /** 토큰으로 찾는다 (끊김, 만료 여부와 무관). 열 비교가 대소문자를 가리지 않으므로 호출자가 토큰을 다시 맞춰 본다 */
  async findByToken(token: string): Promise<EventShareWithGroup | null> {
    const row = await this.prisma.eventShare.findUnique({
      where: { token },
      select: { ...SHARE_SELECT, group: { select: { name: true, type: true } } },
    });
    return row && { ...toRow(row), group: row.group };
  }

  /** 합류 트랜잭션 안에서 이 링크의 합류 수 +1 (이미 멤버면 부르지 않는다) */
  async incrementJoinCountTx(db: Db, id: number): Promise<void> {
    await db.eventShare.update({ where: { id }, data: { joinCount: { increment: 1 } } });
  }

  /** 초대 코드 재발급: 그 팀의 살아 있는 일정 링크를 모두 끊는다 (D-183) */
  async revokeGroupTx(db: Db, groupId: number, now: Date): Promise<void> {
    await db.eventShare.updateMany({ where: { groupId, ...liveWhere(now) }, data: { revokedAt: now } });
  }

  /** 나가기, 탈퇴: 그 사람이 그 팀에서 만든 살아 있는 링크를 끊는다 (D-183) */
  async revokeCreatorTx(db: Db, groupId: number, userId: number, now: Date): Promise<void> {
    await db.eventShare.updateMany({ where: { groupId, createdById: userId, ...liveWhere(now) }, data: { revokedAt: now } });
  }
}
