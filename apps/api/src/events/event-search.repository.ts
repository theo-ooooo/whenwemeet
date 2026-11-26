import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { FileUrlBuilder } from '../files/file-url.builder.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { Repeat } from './recurrence.js';
import { VISIBLE_EVENT_WHERE, visibleEventSql } from './visible-event.js';
import {
  dbToDate,
  EVENT_EXCEPTION_SELECT,
  EVENT_SELECT,
  type EventRow,
  type SeriesRow,
  toEventRow,
  toExceptionRow,
} from './event-rows.js';

/** (#199) 일정 검색. events.repository 에서 옮김 (#504) */
@Injectable()
export class EventSearchRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly urls: FileUrlBuilder,
  ) {}

  /**
   * (#199) 검색: 한 번짜리 일정 중 제목, 메모, 장소 글자(직접 적은 것, 고를 때 검색어)에 pattern(LIKE, 이스케이프 '!')이 맞는 것.
   * upcoming 은 끝이 now 뒤(시작 오름차순), past 는 그 밖(시작 내림차순). 각각 take 개까지 (D-245)
   */
  async searchOnce(
    groupIds: number[],
    pattern: string,
    now: Date,
    take: number,
  ): Promise<{ upcoming: EventRow[]; past: EventRow[] }> {
    if (groupIds.length === 0) return { upcoming: [], past: [] };
    const groups = Prisma.join(groupIds);
    const [upcomingIds, pastIds] = await Promise.all([
      this.prisma.$queryRaw<{ id: number }[]>`
        SELECT id FROM Event
        WHERE groupId IN (${groups}) AND \`repeat\` IS NULL AND endsAt > ${now} AND ${matchSql('', pattern)} AND ${visibleEventSql('')}
        ORDER BY startsAt ASC, id ASC LIMIT ${take}`,
      this.prisma.$queryRaw<{ id: number }[]>`
        SELECT id FROM Event
        WHERE groupId IN (${groups}) AND \`repeat\` IS NULL AND endsAt <= ${now} AND ${matchSql('', pattern)} AND ${visibleEventSql('')}
        ORDER BY startsAt DESC, id DESC LIMIT ${take}`,
    ]);
    const load = async (ids: { id: number }[]) => {
      if (ids.length === 0) return [];
      const rows = await this.prisma.event.findMany({
        where: { id: { in: ids.map((row) => row.id) }, ...VISIBLE_EVENT_WHERE },
        select: EVENT_SELECT,
      });
      const byId = new Map(
        rows.map((row) => [row.id, toEventRow(row, this.urls)]),
      );
      return ids.flatMap((row) => byId.get(row.id) ?? []);
    };
    const [upcoming, past] = await Promise.all([
      load(upcomingIds),
      load(pastIds),
    ]);
    return { upcoming, past };
  }

  /**
   * (#199) 검색: 원본 값이 맞는 반복 원본(matchedIds), 예외 값(제목, 메모, 장소)이 맞는 취소 안 된 회차(exceptionHits),
   * 그리고 둘에 걸린 원본 전부(예외 포함). 원본, 회차 각각 cap 개까지 (D-245)
   */
  async searchSeries(
    groupIds: number[],
    pattern: string,
    cap: number,
  ): Promise<{
    series: SeriesRow[];
    matchedIds: number[];
    exceptionHits: { eventId: number; occurrence: string }[];
  }> {
    if (groupIds.length === 0)
      return { series: [], matchedIds: [], exceptionHits: [] };
    const groups = Prisma.join(groupIds);
    const [matched, hits] = await Promise.all([
      this.prisma.$queryRaw<{ id: number }[]>`
        SELECT id FROM Event
        WHERE groupId IN (${groups}) AND \`repeat\` IS NOT NULL AND ${matchSql('', pattern)} AND ${visibleEventSql('')}
        ORDER BY id ASC LIMIT ${cap}`,
      this.prisma.$queryRaw<{ eventId: number; occurrence: Date }[]>`
        SELECT x.eventId, x.occurrence FROM EventException x JOIN Event e ON e.id = x.eventId
        WHERE e.groupId IN (${groups}) AND e.\`repeat\` IS NOT NULL AND x.cancelled = false AND ${matchSql('x.', pattern)} AND ${visibleEventSql('e.')}
        ORDER BY x.eventId ASC, x.occurrence ASC LIMIT ${cap}`,
    ]);
    const ids = [
      ...new Set([
        ...matched.map((row) => row.id),
        ...hits.map((row) => row.eventId),
      ]),
    ];
    if (ids.length === 0)
      return { series: [], matchedIds: [], exceptionHits: [] };
    const rows = await this.prisma.event.findMany({
      where: { id: { in: ids }, repeat: { not: null }, ...VISIBLE_EVENT_WHERE },
      orderBy: { id: 'asc' },
      select: {
        ...EVENT_SELECT,
        exceptions: { select: EVENT_EXCEPTION_SELECT },
      },
    });
    return {
      series: rows.map(({ exceptions, ...row }) => ({
        ...toEventRow(row, this.urls),
        repeat: row.repeat as Repeat,
        exceptions: exceptions.map(toExceptionRow),
      })),
      matchedIds: matched.map((row) => row.id),
      exceptionHits: hits.map((row) => ({
        eventId: row.eventId,
        occurrence: dbToDate(row.occurrence),
      })),
    };
  }
}

/**
 * (#199) 검색 조건: 제목, 메모, 장소 글자(placeText), 장소 검색어(placeQuery) 중 하나가. 카카오가 준 이름, 주소는 저장하지 않으므로 찾지 않는다 (D-245). pattern 과 LIKE (이스케이프 문자 '!').
 * 열의 콜레이션(utf8mb4_0900_ai_ci)이라 대소문자를 가리지 않는다. prefix 는 테이블 별칭 ('' 또는 'x.')
 */
function matchSql(prefix: '' | 'x.', pattern: string): Prisma.Sql {
  const col = (name: string) => Prisma.raw(`${prefix}${name}`);
  return Prisma.sql`(${col('title')} LIKE ${pattern} ESCAPE '!' OR ${col('memo')} LIKE ${pattern} ESCAPE '!' OR ${col('placeText')} LIKE ${pattern} ESCAPE '!' OR ${col('placeQuery')} LIKE ${pattern} ESCAPE '!')`;
}

/** (#199) 검색어 → LIKE 패턴. '!', '%', '_' 는 '!' 로 이스케이프해 글자 그대로 찾는다 */
export function likePattern(query: string): string {
  return `%${query.replace(/[!%_]/g, (char) => `!${char}`)}%`;
}
