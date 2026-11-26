import { Prisma } from '../generated/prisma/client.js';

/**
 * (#515) 멤버에게 보이는 일정 조건 (D-286). 관리자가 숨긴 일정과 숨긴 팀의 일정은 멤버가 읽는 모든 곳(달력, 회차, 다가오는 일정, 검색,
 * 빈 시간, 구독 피드, 위젯, 공유 링크, 알림 예약과 펼치기, 볼까)에서 없는 것과 같다. 일정 읽기 where 에 이 조건을 펼쳐 넣는다.
 * 관리자 화면(admin/)만 이 조건 없이 읽는다
 */
export const VISIBLE_EVENT_WHERE = {
  hiddenAt: null,
  group: { hiddenAt: null },
} satisfies Prisma.EventWhereInput;

/** 같은 조건의 원시 SQL 조각 (Event 별칭 `prefix`, 예: '' 또는 'e.'). 팀 숨김은 Group 을 하위 질의로 본다 */
export function visibleEventSql(prefix: string): Prisma.Sql {
  return Prisma.sql`${Prisma.raw(`${prefix}hiddenAt`)} IS NULL AND ${Prisma.raw(`${prefix}groupId`)} NOT IN (SELECT id FROM \`Group\` WHERE hiddenAt IS NOT NULL)`;
}
