import { Logger } from '@nestjs/common';

/**
 * (#450) 성공 기준 지표용 저장 출처 헤더 `X-Client-Source` (설계 AI-비서.md 6-1, D-275).
 * 웹이 볼까 카드에서 일정, 투표를 만들 때만 싣는다. 저장하지 않고 만들기 로그 한 줄에만 남긴다 (동작 변화 없음). 허용 값 밖은 무시
 */
export const CLIENT_SOURCES = ['assistant', 'assistant-poll', 'assistant-edit', 'assistant-edit-changed'] as const;
export type ClientSource = (typeof CLIENT_SOURCES)[number];

export function clientSourceOf(header: unknown): ClientSource | null {
  return typeof header === 'string' && (CLIENT_SOURCES as readonly string[]).includes(header) ? (header as ClientSource) : null;
}

const logger = new Logger('ClientSource');

/** 만든 뒤 출처가 있으면 로그 한 줄 (`event_create`, `poll_create`). 사용자 글은 남기지 않는다 */
export async function logCreateSource<T extends { id: number }>(kind: 'event_create' | 'poll_create', header: unknown, ids: { userId: number; groupId: number }, created: Promise<T>): Promise<T> {
  const result = await created;
  const source = clientSourceOf(header);
  if (source) logger.log(`${kind} ${JSON.stringify({ source, userId: ids.userId, groupId: ids.groupId, id: result.id })}`);
  return result;
}
