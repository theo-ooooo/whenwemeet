import { Injectable } from '@nestjs/common';
import { FileUrlBuilder } from '../files/file-url.builder.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { type Repeat, seriesCandidateWindow } from './recurrence.js';
import { dateToDb, EVENT_EXCEPTION_SELECT, EVENT_SELECT, type EventExceptionRow, type EventRow, type SeriesRow, toEventRow, toExceptionRow } from './event-rows.js';

/** 일정 읽기: 범위 목록, 반복 원본, 한 건 찾기, 예외. events.repository 에서 옮김 (#504) */
@Injectable()
export class EventReadsRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly urls: FileUrlBuilder,
  ) {}

  /** 한 번짜리 일정. 겹침 조건 `startsAt < to AND endsAt > from`, startsAt 오름차순 */
  async listInRange(groupId: number, from: Date, to: Date): Promise<EventRow[]> {
    const rows = await this.prisma.event.findMany({
      where: { groupId, repeat: null, startsAt: { lt: to }, endsAt: { gt: from } },
      orderBy: { startsAt: 'asc' },
      select: EVENT_SELECT,
    });
    return rows.map((row) => toEventRow(row, this.urls));
  }

  /** [from, to) 에 회차가 있을 수 있는 반복 원본 + 예외 (설계 4장, 창은 recurrence.seriesCandidateWindow) */
  async listSeriesForRange(groupId: number, from: Date, to: Date): Promise<SeriesRow[]> {
    const window = seriesCandidateWindow(from, to);
    const rows = await this.prisma.event.findMany({
      where: {
        groupId,
        repeat: { not: null },
        startsAt: { lt: window.startsBefore },
        OR: [{ repeatUntil: null }, { repeatUntil: { gte: dateToDb(window.untilOnOrAfter) } }],
      },
      orderBy: { id: 'asc' },
      select: { ...EVENT_SELECT, exceptions: { select: EVENT_EXCEPTION_SELECT } },
    });
    return rows.map(({ exceptions, ...row }) => ({
      ...toEventRow(row, this.urls),
      repeat: row.repeat as Repeat,
      exceptions: exceptions.map(toExceptionRow),
    }));
  }

  /** 다른 팀 자원을 가리키는 ID 는 null */
  async findInGroup(groupId: number, eventId: number): Promise<EventRow | null> {
    const row = await this.prisma.event.findFirst({ where: { id: eventId, groupId }, select: EVENT_SELECT });
    return row && toEventRow(row, this.urls);
  }

  /** (#311) 공개 코드로 찾는다 (팀 불문). 열 비교가 대소문자를 가리지 않으므로 호출자가 코드를 소문자로 맞춰 넘긴다 */
  async findByPublicCode(publicCode: string): Promise<EventRow | null> {
    const row = await this.prisma.event.findUnique({ where: { publicCode }, select: EVENT_SELECT });
    return row && toEventRow(row, this.urls);
  }

  /** 원본 하나의 예외 전부, 회차 날짜 오름차순 */
  async listExceptions(eventId: number): Promise<EventExceptionRow[]> {
    const rows = await this.prisma.eventException.findMany({
      where: { eventId },
      orderBy: { occurrence: 'asc' },
      select: EVENT_EXCEPTION_SELECT,
    });
    return rows.map(toExceptionRow);
  }
}
