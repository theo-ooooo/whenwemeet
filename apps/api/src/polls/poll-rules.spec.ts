import { ApiException } from '../common/errors.js';
import { MemberResolver } from '../common/member.js';
import {
  checkDeadline,
  checkOptions,
  isExpired,
  isKstMidnight,
  planVotes,
  type PollRow,
  sortOpenSummaries,
  targetIds,
  toPollSummary,
  toPollView,
} from './poll-rules.js';

const NOW = new Date('2026-11-13T03:00:00.000Z'); // 12:00 KST
const kst = (local: string) => new Date(`${local}+09:00`);
const opt = (start: string, end: string, allDay = false) => ({ startsAt: kst(start), endsAt: kst(end), allDay });

const codeOf = (fn: () => unknown): string | undefined => {
  try {
    fn();
  } catch (error) {
    return (error as ApiException).code + ':' + (error as ApiException).message;
  }
  return undefined;
};

describe('checkOptions', () => {
  it('2~5개만, 시작 순으로 정렬해 돌려준다', () => {
    const sorted = checkOptions([opt('2026-11-15T19:00', '2026-11-15T21:00'), opt('2026-11-14T12:00', '2026-11-14T14:00')], NOW);
    expect(sorted.map((o) => o.startsAt)).toEqual([kst('2026-11-14T12:00'), kst('2026-11-15T19:00')]);
    expect(codeOf(() => checkOptions([opt('2026-11-15T19:00', '2026-11-15T21:00')], NOW))).toBe('VALIDATION_FAILED:후보는 2~5개 골라 주세요');
    const six = Array.from({ length: 6 }, (_, i) => opt(`2026-11-2${i}T10:00`, `2026-11-2${i}T11:00`));
    expect(codeOf(() => checkOptions(six, NOW))).toBe('VALIDATION_FAILED:후보는 2~5개 골라 주세요');
  });

  it('끝 <= 시작, 30일 초과, 지난 시작, 중복은 400', () => {
    const ok = opt('2026-11-20T10:00', '2026-11-20T11:00');
    expect(codeOf(() => checkOptions([ok, opt('2026-11-21T10:00', '2026-11-21T10:00')], NOW))).toContain('뒤여야');
    expect(codeOf(() => checkOptions([ok, opt('2026-11-21T00:00', '2026-12-22T00:00', true)], NOW))).toContain('30일');
    expect(codeOf(() => checkOptions([ok, opt('2026-11-13T12:00', '2026-11-13T13:00')], NOW))).toContain('지난 시간');
    expect(codeOf(() => checkOptions([ok, { ...ok }], NOW))).toContain('두 번');
  });

  it('종일 후보는 KST 00:00 경계만', () => {
    expect(checkOptions([opt('2026-11-20T00:00', '2026-11-21T00:00', true), opt('2026-11-22T00:00', '2026-11-24T00:00', true)], NOW)).toHaveLength(2);
    expect(codeOf(() => checkOptions([opt('2026-11-20T00:00', '2026-11-21T00:00', true), opt('2026-11-22T09:00', '2026-11-23T00:00', true)], NOW))).toContain('하루 단위');
    expect(isKstMidnight(new Date('2026-11-19T15:00:00.000Z'))).toBe(true);
    expect(isKstMidnight(new Date('2026-11-20T00:00:00.000Z'))).toBe(false);
  });
});

describe('checkDeadline, isExpired', () => {
  it('마감은 지금 이후. 진행 중이고 마감이 지났으면 expired', () => {
    expect(() => checkDeadline(null, NOW)).not.toThrow();
    expect(() => checkDeadline(new Date(NOW.getTime() + 1), NOW)).not.toThrow();
    expect(codeOf(() => checkDeadline(NOW, NOW))).toContain('지금 이후');
    expect(isExpired({ status: 'OPEN', deadline: NOW }, NOW)).toBe(true);
    expect(isExpired({ status: 'OPEN', deadline: null }, NOW)).toBe(false);
    expect(isExpired({ status: 'CLOSED', deadline: new Date(0) }, NOW)).toBe(false);
  });
});

describe('planVotes (전체 교체, 지난 후보 고정)', () => {
  const options = [
    { id: 1, startsAt: kst('2026-11-13T11:00') }, // 지남
    { id: 2, startsAt: kst('2026-11-14T10:00') },
    { id: 3, startsAt: kst('2026-11-15T10:00') },
  ];
  it('빠진 앞날 후보는 지우고 새 후보는 넣는다. 지난 후보의 표는 빠져도 남긴다', () => {
    expect(planVotes(options, [1, 2], [3], NOW)).toEqual({ remove: [2], add: [3] });
    expect(planVotes(options, [2, 3], [], NOW)).toEqual({ remove: [2, 3], add: [] });
    expect(planVotes(options, [1], [1, 2], NOW)).toEqual({ remove: [], add: [2] });
  });

  it('지난 후보를 새로 켜면 POLL_OPTION_PAST, 이 투표의 후보가 아니면 400', () => {
    expect(codeOf(() => planVotes(options, [], [1], NOW))).toBe('POLL_OPTION_PAST:이미 지난 시간이에요');
    expect(codeOf(() => planVotes(options, [], [9], NOW))).toBe('VALIDATION_FAILED:이 투표의 후보가 아니에요');
  });
});

const member = (userId: number, nickname: string) => ({
  id: userId,
  userId,
  groupId: 10,
  color: '#F26D6D',
  displayName: null,
  lastSeenAt: NOW,
  joinedAt: new Date(userId * 1000),
  notify: true,
  user: { nickname, profileImageUrl: null },
});

const resolver = new MemberResolver([member(1, '민지'), member(2, '지훈'), member(3, '서연')]);

const row = (over: Partial<PollRow> = {}): PollRow => ({
  id: 5,
  groupId: 10,
  groupCode: 'team1234',
  publicCode: 'poll2345',
  title: '저녁 약속',
  status: 'OPEN',
  deadline: null,
  allMembers: true,
  creatorId: 1,
  creator: { nickname: '민지', profileImageUrl: null },
  eventId: null,
  eventCode: null,
  decidedOptionId: null,
  createdAt: new Date('2026-11-12T00:00:00.000Z'),
  closedAt: null,
  participantIds: [],
  options: [
    { id: 11, startsAt: kst('2026-11-14T19:00'), endsAt: kst('2026-11-14T21:00'), allDay: false, voterIds: [2, 1] },
    { id: 12, startsAt: kst('2026-11-15T12:00'), endsAt: kst('2026-11-15T14:00'), allDay: false, voterIds: [2] },
  ],
  ...over,
});

describe('toPollView, toPollSummary', () => {
  it('표는 가입순 사람, 내 표, 대상 여부, 지난 후보 표시', () => {
    const view = toPollView(row(), resolver, 2, NOW);
    expect(view.options[0].voters.map((m) => m.displayName)).toEqual(['민지', '지훈']);
    expect(view.myVotes).toEqual([11, 12]);
    expect(view.canVote).toBe(true);
    expect(view.options.every((o) => o.past === false)).toBe(true);
    expect(view.participants.all).toBe(true);
    expect(view.creator.displayName).toBe('민지');
  });

  it('골라 담은 대상: 대상 밖은 canVote false, 요약은 대상 중 답한 사람 수', () => {
    const picked = row({ allMembers: false, participantIds: [1, 2] });
    expect(toPollView(picked, resolver, 3, NOW).canVote).toBe(false);
    expect(targetIds(picked, resolver)).toEqual([1, 2]);
    const summary = toPollSummary(picked, resolver, 3, NOW);
    expect(summary).toMatchObject({ voterCount: 2, targetCount: 2, votedByMe: false, allPast: false, expired: false });
    expect(toPollSummary(row(), resolver, 3, NOW).targetCount).toBe(3);
  });

  it('진행 중 정렬: 고를 후보가 남은 것 먼저, 마감 가까운 순, 마감 없음 뒤, 같으면 최근', () => {
    const base = toPollSummary(row(), resolver, 1, NOW);
    const items = [
      { ...base, id: 1, deadline: null, createdAt: new Date(1) },
      { ...base, id: 2, deadline: kst('2026-11-14T00:00') },
      { ...base, id: 3, deadline: null, createdAt: new Date(2) },
      { ...base, id: 4, deadline: kst('2026-11-13T18:00'), allPast: true },
      { ...base, id: 5, deadline: kst('2026-11-13T18:00') },
    ];
    expect(sortOpenSummaries(items).map((i) => i.id)).toEqual([5, 2, 3, 1, 4]);
  });
});
