/**
 * (#375) 일정 삭제 되돌리기 보관 형식 (D-251). 순수 함수 (단위 테스트 대상).
 * 행은 Prisma 가 select 없이 읽은 모습 그대로(모든 열) 담는다. 열이 늘어도 보관, 복원 코드를 고칠 필요가 없다.
 * JSON 에는 Date 가 없으므로 `{ "$date": ISO }` 로 바꿔 넣고 꺼낼 때 되살린다
 */
import type { ChangeRevert } from '../push/push-notifications.repository.js';

/** 보관 기간. 지나면 되돌릴 수 없고 하루 청소가 지운다 */
export const DELETION_RETENTION_DAYS = 7;
export const DELETION_RETENTION_MS =
  DELETION_RETENTION_DAYS * 24 * 60 * 60 * 1000;

/** 테이블 한 행 (열 이름 → 값) */
export type Row = Record<string, unknown>;

export interface DeletionLinks {
  /** 일정을 가리키던 기록(새 소식). 행이 지워지면 FK SetNull 로 null 이 되므로 되돌릴 때 다시 잇는다 */
  eventLogIds: number[];
  /** (#279) 가져오기 기록 (SetNull). PK (importId, uidHash) */
  importItems: { importId: number; uidHash: string }[];
  /** (#189) 이 일정을 정한 투표 (SetNull) */
  pollId: number | null;
}

export interface DeletionSnapshot {
  v: 1;
  /** EVENT: 지운 일정 행 */
  event: Row | null;
  /** FOLLOWING: 당기기 전 원본 종료일 (@db.Date 값, null 이면 계속) */
  repeatUntil?: Date | null;
  /** EVENT: 그 일정의 예외 전부. OCCURRENCE: 취소로 덮기 전 그 회차 예외(없으면 빈 배열). FOLLOWING: 그 회차 이후 예외 */
  exceptions: Row[];
  /** EVENT: 참여자 행 */
  participants: Row[];
  /** 지운 참석 여부, 반응 행 */
  rsvps: Row[];
  reactions: Row[];
  /** EVENT: 공유 링크 행 (Cascade 로 지워진다) */
  shares: Row[];
  links: DeletionLinks;
  /** 팀원 변경 알림 묶음에 한 일. PERSONAL 팀이거나 아무것도 안 했으면 null */
  push: ChangeRevert | null;
}

export function emptySnapshot(): DeletionSnapshot {
  return {
    v: 1,
    event: null,
    exceptions: [],
    participants: [],
    rsvps: [],
    reactions: [],
    shares: [],
    links: { eventLogIds: [], importItems: [], pollId: null },
    push: null,
  };
}

const DATE_KEY = '$date';

/** 저장용: Date 를 `{ $date }` 로 (깊이 무관) */
export function encodeSnapshot(value: unknown): unknown {
  if (value instanceof Date) return { [DATE_KEY]: value.toISOString() };
  if (Array.isArray(value)) return value.map(encodeSnapshot);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, inner]) => [key, encodeSnapshot(inner)]),
    );
  }
  return value;
}

/** 읽기용: `{ $date }` 를 Date 로 (깊이 무관) */
export function decodeSnapshot(value: unknown): DeletionSnapshot {
  return revive(value) as DeletionSnapshot;
}

function revive(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(revive);
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value);
    if (
      entries.length === 1 &&
      entries[0][0] === DATE_KEY &&
      typeof entries[0][1] === 'string'
    )
      return new Date(entries[0][1]);
    return Object.fromEntries(
      entries.map(([key, inner]) => [key, revive(inner)]),
    );
  }
  return value;
}

/** 보관 기간이 지났는지 */
export function deletionExpired(createdAt: Date, now: Date): boolean {
  return now.getTime() - createdAt.getTime() > DELETION_RETENTION_MS;
}

/**
 * 되돌릴 때 지금 멤버만 남긴다 (나간 사람의 참여자, 응답, 반응은 나가기 규칙대로 없어야 한다).
 * userId 열이 있는 행에 쓴다
 */
export function keepMembers<T extends Row>(
  rows: T[],
  memberIds: ReadonlySet<number>,
): T[] {
  return rows.filter((row) => memberIds.has(row.userId as number));
}

/**
 * 공유 링크: 만든 사람이 지금 멤버가 아니면 끊긴 링크로 되살린다 (나가기는 그 사람 링크를 끊는다).
 * 만든 사람 계정이 없어졌으면 createdById 를 비운다 (FK)
 */
export function reviveShares(
  rows: Row[],
  memberIds: ReadonlySet<number>,
  existingUserIds: ReadonlySet<number>,
  now: Date,
): Row[] {
  return rows.map((row) => {
    const creator = row.createdById as number | null;
    if (creator === null || memberIds.has(creator)) return row;
    return {
      ...row,
      createdById: existingUserIds.has(creator) ? creator : null,
      revokedAt: row.revokedAt ?? now,
    };
  });
}
