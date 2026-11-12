// (#274) 일정 공유 링크의 순수 규칙 (D-181 ~ D-184). Prisma, Nest 를 import 하지 않는다 (단위 테스트 대상)
import { randomBytes } from 'node:crypto';
import { applyException, DAY_MS, type ExceptionRule, isOccurrenceDate, kstDate, originalOccurrence, type Repeat } from '../events/recurrence.js';

/** 16바이트 랜덤 base64url = 22자 (128비트, 추측 불가). 순번 ID(D-35)를 주소에 싣지 않는다 */
export const SHARE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{22}$/;

export function generateShareToken(): string {
  return randomBytes(16).toString('base64url');
}

/** 만든 때부터 이 기간을 넘겨 열리지 않는다 */
export const SHARE_MAX_DAYS = 30;

/** 만료 = 그 회차 끝 + 1일, 단 만든 때 + 30일을 넘지 않음 (D-183) */
export function shareExpiresAt(occurrenceEndsAt: Date, now: Date): Date {
  return new Date(Math.min(occurrenceEndsAt.getTime() + DAY_MS, now.getTime() + SHARE_MAX_DAYS * DAY_MS));
}

/** 공유 대상 일정 (원본 행에서 필요한 값만) */
export interface ShareableEvent {
  title: string;
  startsAt: Date;
  endsAt: Date;
  allDay: boolean;
  repeat: Repeat | null;
  repeatUntil: string | null;
  repeatAnchor: string | null;
}

/** 링크가 가리키는 회차의 지금 값 (예외 반영) */
export interface SharedOccurrence {
  title: string;
  startsAt: Date;
  endsAt: Date;
  allDay: boolean;
  /** 반복 회차의 원래 날짜 (KST). 한 번짜리 null */
  occurrence: string | null;
}

/**
 * 링크의 회차를 지금 값으로 푼다. 없으면 null (만료 화면과 같은 404).
 * - 한 번짜리: occurrence 가 null 이어야 한다 (반복이던 일정이 한 번짜리가 됐으면 그 회차는 없다)
 * - 반복: occurrence(null 이면 첫 회차, 한 번짜리였다가 반복이 된 경우)가 지금 규칙의 회차여야 하고 취소되지 않아야 한다.
 *   "이후 모두" 로 원본이 끊겨 그 회차가 옛 원본에 더는 없으면 null (D-66)
 */
export function resolveSharedOccurrence(
  event: ShareableEvent,
  exceptions: readonly ExceptionRule[],
  occurrence: string | null,
): SharedOccurrence | null {
  if (!event.repeat) {
    if (occurrence !== null) return null;
    return { title: event.title, startsAt: event.startsAt, endsAt: event.endsAt, allDay: event.allDay, occurrence: null };
  }
  const rule = { ...event, repeat: event.repeat };
  const date = occurrence ?? kstDate(event.startsAt);
  if (!isOccurrenceDate(rule, date)) return null;
  const resolved = applyException(
    originalOccurrence(rule, date),
    exceptions.find((exception) => exception.occurrence === date),
  );
  if (!resolved) return null;
  return { title: resolved.title ?? event.title, startsAt: resolved.startsAt, endsAt: resolved.endsAt, allDay: resolved.allDay, occurrence: date };
}

/** 달력 착지 날짜: 그 회차가 지금 시작하는 KST 날짜 ("이 일정만" 으로 옮겼으면 옮긴 날) */
export function landingDate(occurrence: SharedOccurrence): string {
  return kstDate(occurrence.startsAt);
}
