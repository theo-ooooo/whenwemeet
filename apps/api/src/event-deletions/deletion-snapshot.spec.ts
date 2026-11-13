import { describe, expect, it } from 'vitest';
import {
  decodeSnapshot,
  DELETION_RETENTION_MS,
  deletionExpired,
  emptySnapshot,
  encodeSnapshot,
  keepMembers,
  reviveShares,
} from './deletion-snapshot.js';

describe('(#375) 일정 삭제 보관 형식 (D-251)', () => {
  it('Date 를 { $date } 로 넣고 깊이와 무관하게 되살린다', () => {
    const at = new Date('2026-11-13T05:00:00.000Z');
    const snapshot = {
      ...emptySnapshot(),
      event: { id: 1, startsAt: at, repeatUntil: null, title: '갱 피티', allDay: false },
      exceptions: [{ id: 2, occurrence: new Date('2026-11-20T00:00:00.000Z'), startsAt: null }],
      repeatUntil: new Date('2027-01-01T00:00:00.000Z'),
    };
    const json = JSON.parse(JSON.stringify(encodeSnapshot(snapshot)));
    expect(json.event.startsAt).toEqual({ $date: '2026-11-13T05:00:00.000Z' });
    const back = decodeSnapshot(json);
    expect(back).toEqual(snapshot);
    expect(back.event?.startsAt).toBeInstanceOf(Date);
    expect(back.repeatUntil).toBeInstanceOf(Date);
  });

  it('$date 외 키가 섞인 객체는 그대로, 원시값과 배열은 그대로', () => {
    expect(decodeSnapshot({ a: { $date: 'x', b: 1 }, c: [1, 'y', true, null] })).toEqual({ a: { $date: 'x', b: 1 }, c: [1, 'y', true, null] });
  });

  it('보관 기간 7일', () => {
    const created = new Date('2026-11-13T00:00:00Z');
    expect(deletionExpired(created, new Date(created.getTime() + DELETION_RETENTION_MS))).toBe(false);
    expect(deletionExpired(created, new Date(created.getTime() + DELETION_RETENTION_MS + 1))).toBe(true);
  });

  it('지금 멤버의 행만 남긴다', () => {
    expect(keepMembers([{ userId: 1 }, { userId: 2 }, { userId: 3 }], new Set([1, 3]))).toEqual([{ userId: 1 }, { userId: 3 }]);
  });

  it('공유 링크: 나간 사람 링크는 끊긴 채로, 탈퇴한 사람은 만든 사람을 비운다', () => {
    const now = new Date('2026-11-13T00:00:00Z');
    const earlier = new Date('2026-11-12T00:00:00Z');
    const rows = [
      { id: 1, createdById: 1, revokedAt: null },
      { id: 2, createdById: 2, revokedAt: null },
      { id: 3, createdById: 3, revokedAt: earlier },
      { id: 4, createdById: null, revokedAt: null },
    ];
    expect(reviveShares(rows, new Set([1]), new Set([1, 2]), now)).toEqual([
      { id: 1, createdById: 1, revokedAt: null },
      { id: 2, createdById: 2, revokedAt: now },
      { id: 3, createdById: null, revokedAt: earlier },
      { id: 4, createdById: null, revokedAt: null },
    ]);
  });
});
