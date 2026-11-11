/**
 * 팀원 변경 알림 묶기 (#188, 설계 푸시-알림.md 5-4, D-90). 순수 함수 (단위 테스트 대상).
 * (변경한 사람, 일정) 별로 첫 변경부터 2분 고정 창. 창 안의 새 로그를 지금 대기 중인 알림에 합친다
 */

export type ChangeAction = 'CREATED' | 'UPDATED' | 'DELETED';

/** 첫 변경부터 이만큼 뒤에 보낸다 */
export const COALESCE_WINDOW_MS = 2 * 60 * 1000;

/** 대기 중(PENDING, 창 안)인 묶음 */
export interface PendingChange {
  changeAction: ChangeAction;
  eventLogId: number;
}

export interface ChangeLog {
  id: number;
  action: ChangeAction;
}

export type CoalesceResult =
  /** 대기 중인 묶음이 없다 → 새 알림 */
  | { type: 'create' }
  /** 추가 후 원본 삭제 → 둘 다 보내지 않는다 */
  | { type: 'cancel' }
  /** 묶음의 동작과 보일 로그를 바꾼다 */
  | { type: 'update'; changeAction: ChangeAction; eventLogId: number }
  /** 그대로 둔다 */
  | { type: 'keep' };

/**
 * 묶기 결과 (설계 5-4 표).
 * `removesEvent` 는 이 변경으로 원본 행이 지워졌는지 (한 번짜리 삭제, "이후 모두" 첫 회차 삭제)
 */
export function coalesce(pending: PendingChange | null, log: ChangeLog, removesEvent: boolean): CoalesceResult {
  if (!pending) return { type: 'create' };
  if (pending.changeAction === 'CREATED') {
    if (log.action === 'DELETED') return removesEvent ? { type: 'cancel' } : { type: 'keep' };
    return { type: 'update', changeAction: 'CREATED', eventLogId: log.id };
  }
  // UPDATED → UPDATED 는 새 로그, UPDATED → DELETED 는 삭제로. 그 밖(표에 없는 순서)도 마지막 로그를 따른다
  return { type: 'update', changeAction: log.action, eventLogId: log.id };
}

/** 묶음 키 "{actorId}:{eventId}" */
export function coalesceKey(actorId: number, eventId: number): string {
  return `${actorId}:${eventId}`;
}
