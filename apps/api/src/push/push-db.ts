import { Prisma } from '../generated/prisma/client.js';
import type { PushPayload } from './push-copy.js';

/**
 * `YYYY-MM-DD` ↔ `@db.Date` (events/event-rows 의 같은 이름 함수와 같은 규칙).
 * 일정 쓰기 저장소들이 푸시 저장소를 주입받으므로 순환 import 를 피하려고 여기 둔다. (#485) 푸시 저장소들이 같이 쓴다
 */
export const dateToDb = (value: string): Date =>
  new Date(`${value}T00:00:00.000Z`);
export const dbToDate = (value: Date): string =>
  value.toISOString().slice(0, 10);

export const idsOf = (rows: { userId: number }[]): number[] =>
  rows.map((row) => row.userId).sort((a, b) => a - b);

export const asPayload = (
  value: Prisma.JsonValue | null,
): PushPayload | null =>
  value === null ? null : (value as unknown as PushPayload);
export const toJson = (payload: PushPayload): Prisma.InputJsonValue =>
  payload as unknown as Prisma.InputJsonValue;
