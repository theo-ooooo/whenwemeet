import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { type ExceptionRule, type Repeat, seriesCandidateWindow, type SeriesRule } from './recurrence.js';
import { dateToDb, dbToDate, participantIdsOf } from './event-rows.js';

/** (#248) 빈 시간 판정용 참여자 필드 (D-137) */
const BUSY_PARTICIPANTS_SELECT = { allMembers: true, participants: { select: { userId: true } } } as const;

/** (#248) 빈 시간에서 그 일정이 누구를 바쁘게 하는지 (D-137) */
export interface BusyParticipants {
  allMembers: boolean;
  participantIds: number[];
}

/** 빈 시간 계산용. 일정 내용은 담지 않는다 (결정기록 D-14). 참여자로 거른다 (#248) */
export interface BusyRange extends BusyParticipants {
  startsAt: Date;
  endsAt: Date;
}

/** 빈 시간 계산용 반복 원본. 시각과 반복 필드, 예외의 시각/취소, 참여자만 (D-14, 설계 4-2, D-137) */
export interface BusySeries extends SeriesRule, BusyParticipants {
  exceptions: ExceptionRule[];
}

/** 빈 시간 찾기용 바쁜 구간 읽기. events.repository 에서 옮김 (#504) */
@Injectable()
export class EventBusyRepository {
  constructor(
    private readonly prisma: PrismaService,
  ) {}

  /** 여러 팀의 한 번짜리 바쁜 구간만, startsAt 오름차순. includeAllDay 가 아니면 종일 일정 제외 */
  async listBusyRanges(groupIds: number[], from: Date, to: Date, includeAllDay: boolean): Promise<BusyRange[]> {
    const rows = await this.prisma.event.findMany({
      where: {
        groupId: { in: groupIds },
        repeat: null,
        startsAt: { lt: to },
        endsAt: { gt: from },
        ...(includeAllDay ? {} : { allDay: false }),
      },
      select: { startsAt: true, endsAt: true, ...BUSY_PARTICIPANTS_SELECT },
      orderBy: { startsAt: 'asc' },
    });
    return rows.map(({ participants, ...row }) => ({ ...row, participantIds: participantIdsOf(participants) }));
  }

  /**
   * 여러 팀의 반복 원본 (설계 4-2). 시각과 반복 필드, 예외의 시각/취소만 읽는다 (title/memo 는 select 하지 않는다, D-14).
   * 예외가 종일 여부를 바꿀 수 있어 종일 제외는 펼친 뒤 호출자가 한다
   */
  async listBusySeries(groupIds: number[], from: Date, to: Date): Promise<BusySeries[]> {
    const window = seriesCandidateWindow(from, to);
    const rows = await this.prisma.event.findMany({
      where: {
        groupId: { in: groupIds },
        repeat: { not: null },
        startsAt: { lt: window.startsBefore },
        OR: [{ repeatUntil: null }, { repeatUntil: { gte: dateToDb(window.untilOnOrAfter) } }],
      },
      select: {
        startsAt: true,
        endsAt: true,
        allDay: true,
        repeat: true,
        repeatUntil: true,
        repeatAnchor: true,
        exceptions: { select: { occurrence: true, cancelled: true, startsAt: true, endsAt: true, allDay: true } },
        ...BUSY_PARTICIPANTS_SELECT,
      },
    });
    return rows.map((row) => ({
      allMembers: row.allMembers,
      participantIds: participantIdsOf(row.participants),
      startsAt: row.startsAt,
      endsAt: row.endsAt,
      allDay: row.allDay,
      repeat: row.repeat as Repeat,
      repeatUntil: row.repeatUntil === null ? null : dbToDate(row.repeatUntil),
      repeatAnchor: row.repeatAnchor === null ? null : dbToDate(row.repeatAnchor),
      exceptions: row.exceptions.map((exception) => ({ ...exception, occurrence: dbToDate(exception.occurrence) })),
    }));
  }
}
