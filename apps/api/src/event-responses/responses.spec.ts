import type { Member } from '../common/member.js';
import {
  isSameRsvpTarget,
  isStale,
  parseReactionKind,
  parseRsvpStatus,
  reactionMembers,
  rsvpMembers,
  summarizeReactions,
  summarizeRsvp,
} from './responses.js';

const member = (userId: number, displayName: string): Member => ({
  userId,
  displayName,
  color: '#3B82F6',
  profileImageUrl: null,
});
const START = new Date('2026-11-20T10:00:00.000Z');
const END = new Date('2026-11-20T12:00:00.000Z');
const at = (iso: string) => new Date(iso);

describe('참석 여부 규칙 (#190)', () => {
  it('parseRsvpStatus: 3값과 null 만, 그 밖은 VALIDATION_FAILED(field status)', () => {
    expect(parseRsvpStatus('GOING')).toBe('GOING');
    expect(parseRsvpStatus('NOT_GOING')).toBe('NOT_GOING');
    expect(parseRsvpStatus('MAYBE')).toBe('MAYBE');
    expect(parseRsvpStatus(null)).toBeNull();
    for (const bad of [undefined, 'going', 'YES', 1, {}]) {
      expect(() => parseRsvpStatus(bad)).toThrow(
        expect.objectContaining({
          code: 'VALIDATION_FAILED',
          details: [expect.objectContaining({ field: 'status' })],
        }),
      );
    }
  });

  it('parseReactionKind: 3값과 null 만', () => {
    expect(parseReactionKind('LIKE')).toBe('LIKE');
    expect(parseReactionKind('EXCITED')).toBe('EXCITED');
    expect(parseReactionKind('ACK')).toBe('ACK');
    expect(parseReactionKind(null)).toBeNull();
    expect(() => parseReactionKind('LOVE')).toThrow(
      expect.objectContaining({ code: 'VALIDATION_FAILED' }),
    );
  });

  it('summarizeRsvp: 참여자만 세고 pending = 참여자 - 응답, mine 은 내 값', () => {
    const rows = [
      { userId: 1, status: 'GOING' as const },
      { userId: 2, status: 'NOT_GOING' as const },
      { userId: 3, status: 'MAYBE' as const },
      // 참여자가 아닌 사람의 행(경합으로 남은 행)은 세지 않는다
      { userId: 9, status: 'GOING' as const },
    ];
    expect(summarizeRsvp([1, 2, 3, 4, 5], rows, 2)).toEqual({
      going: 1,
      notGoing: 1,
      maybe: 1,
      pending: 2,
      mine: 'NOT_GOING',
    });
    expect(summarizeRsvp([1, 2], [], 1)).toEqual({
      going: 0,
      notGoing: 0,
      maybe: 0,
      pending: 2,
      mine: null,
    });
    expect(summarizeRsvp([], [], 1)).toEqual({
      going: 0,
      notGoing: 0,
      maybe: 0,
      pending: 0,
      mine: null,
    });
  });

  it('summarizeReactions: 지금 팀원만, 종류별 수와 내 반응', () => {
    const rows = [
      { userId: 1, kind: 'LIKE' as const },
      { userId: 2, kind: 'LIKE' as const },
      { userId: 3, kind: 'ACK' as const },
      { userId: 8, kind: 'EXCITED' as const },
    ];
    expect(summarizeReactions([1, 2, 3], rows, 3)).toEqual({
      LIKE: 2,
      EXCITED: 0,
      ACK: 1,
      mine: 'ACK',
    });
  });

  it('isStale: 응답할 때 본 시작이나 끝이 지금과 다르면 true (D-226)', () => {
    expect(
      isStale(
        { seenStartsAt: START, seenEndsAt: END },
        at('2026-11-20T10:00:00.000Z'),
        END,
      ),
    ).toBe(false);
    expect(
      isStale(
        { seenStartsAt: START, seenEndsAt: END },
        at('2026-11-20T11:00:00.000Z'),
        END,
      ),
    ).toBe(true);
    expect(
      isStale(
        { seenStartsAt: START, seenEndsAt: END },
        START,
        at('2026-11-20T13:00:00.000Z'),
      ),
    ).toBe(true);
  });

  it('rsvpMembers: 참여자 순서대로, 응답 안 한 사람은 null', () => {
    const members = [member(1, '민지'), member(2, '지훈'), member(3, '서연')];
    const updatedAt = at('2026-11-19T01:00:00.000Z');
    const rows = [
      {
        userId: 2,
        status: 'GOING' as const,
        seenStartsAt: START,
        seenEndsAt: END,
        updatedAt,
      },
      {
        userId: 3,
        status: 'MAYBE' as const,
        seenStartsAt: at('2026-11-20T09:00:00.000Z'),
        seenEndsAt: END,
        updatedAt,
      },
    ];
    expect(rsvpMembers(members, rows, START, END)).toEqual([
      { member: members[0], status: null, respondedAt: null, stale: false },
      {
        member: members[1],
        status: 'GOING',
        respondedAt: updatedAt,
        stale: false,
      },
      {
        member: members[2],
        status: 'MAYBE',
        respondedAt: updatedAt,
        stale: true,
      },
    ]);
  });

  it('reactionMembers: 반응한 지금 팀원만 가입순', () => {
    const members = [member(1, '민지'), member(2, '지훈')];
    const createdAt = at('2026-11-19T01:00:00.000Z');
    expect(
      reactionMembers(members, [
        { userId: 2, kind: 'EXCITED', createdAt },
        { userId: 7, kind: 'LIKE', createdAt },
      ]),
    ).toEqual([{ member: members[1], reaction: 'EXCITED' }]);
  });

  it('isSameRsvpTarget: 같은 일정, 같은 회차(한 번짜리는 null)만', () => {
    expect(
      isSameRsvpTarget(
        { eventId: 5, occurrence: '2026-11-20' },
        5,
        '2026-11-20',
      ),
    ).toBe(true);
    expect(
      isSameRsvpTarget(
        { eventId: 5, occurrence: '2026-11-27' },
        5,
        '2026-11-20',
      ),
    ).toBe(false);
    expect(isSameRsvpTarget({ eventId: 5, occurrence: null }, 5, null)).toBe(
      true,
    );
    expect(isSameRsvpTarget({ eventId: 6, occurrence: null }, 5, null)).toBe(
      false,
    );
    expect(isSameRsvpTarget(null, 5, null)).toBe(false);
  });
});
