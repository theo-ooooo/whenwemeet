/**
 * (#369) 사용자 알림 종류 설정 (설계 푸시-알림.md 7-1, D-249). 순수 함수와 기본값 표.
 * 저장은 `NotificationPreference(userId, kind, enabled)` 행. **행이 없으면 아래 기본값**이고, 사용자가 고른 값은 기본값과 같아도 행으로 남긴다
 * (기본값을 나중에 바꿔도 이미 고른 사람의 값은 그대로)
 */
import type { Prisma } from '../generated/prisma/client.js';
import type { NotificationPreferenceKind } from '../generated/prisma/enums.js';

export type PreferenceKind = NotificationPreferenceKind;

/**
 * 기본값 표 (행이 없을 때). 종류를 늘리면 여기 한 줄과 schema 의 enum 값 하나만 더한다.
 * 기본값을 바꾸면 행이 없는 모든 사용자의 값이 바뀐다: 기존 사용자를 지금 값으로 묶어 둘지 정하고, 묶으려면 마이그레이션으로 행을 넣는다
 */
export const PREFERENCE_DEFAULTS: Readonly<Record<PreferenceKind, boolean>> = {
  REMINDER: true,
  CHANGE: true,
  ANNIVERSARY: true,
  JOIN: true,
  /** (#277) 주간 요약 */
  WEEKLY: true,
  /** (#277) 다 같이 비는 시간. 법률 확인 전이라 기본 끔 (D-204) */
  WEEKLY_NUDGE: false,
  /** (#189) 약속 투표 */
  POLL: true,
  /** (#528) 공지 (D-287) */
  NOTICE: true,
};

export interface PreferenceRow {
  kind: PreferenceKind;
  enabled: boolean;
}

/** 저장된 행 + 기본값 → 종류마다 지금 값 */
export function resolvePreferences(
  rows: readonly PreferenceRow[],
): Record<PreferenceKind, boolean> {
  const out = { ...PREFERENCE_DEFAULTS };
  for (const row of rows) out[row.kind] = row.enabled;
  return out;
}

/**
 * User 를 거르는 조건 "그 종류가 켜짐". 기본 켬이면 "끈 행이 없음", 기본 끔이면 "켠 행이 있음".
 * Repository 의 `user: { ... }` 안에 넣는다 (쿼리는 Repository 가 연다)
 */
export function preferenceOn(kind: PreferenceKind): Prisma.UserWhereInput {
  return PREFERENCE_DEFAULTS[kind]
    ? { notificationPreferences: { none: { kind, enabled: false } } }
    : { notificationPreferences: { some: { kind, enabled: true } } };
}
