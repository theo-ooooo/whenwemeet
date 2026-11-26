import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { MemberResolver } from '../common/member.js';
import { membershipRow } from '../testing/repository-mock.js';
import { EventPatchDto } from './dto/event.dto.js';
import {
  MAX_PARTICIPANTS,
  parseParticipants,
  PARTICIPANTS_EMPTY_MESSAGE,
  PARTICIPANTS_TOO_MANY_MESSAGE,
  PARTICIPANTS_TYPE_MESSAGE,
  participantsProblem,
  participantsSnapshot,
  resolveParticipants,
  sameParticipants,
  toParticipantsView,
} from './participants.js';

/** (#248) 설계 3-2 검증 표, 3-5 순수 함수 */
describe('parseParticipants (설계 3-2 표)', () => {
  it.each([
    ['생략', undefined, undefined],
    ["'ALL'", 'ALL', 'ALL'],
    ['배열은 오름차순, 중복은 합친다', [3, 1, 3, 2], [1, 2, 3]],
    ['한 명', [7], [7]],
  ])('%s', (_label, raw, expected) => {
    expect(parseParticipants(raw)).toEqual(expected);
  });

  it.each([
    ['빈 배열', [], PARTICIPANTS_EMPTY_MESSAGE],
    ['null', null, PARTICIPANTS_TYPE_MESSAGE],
    ['다른 문자열', 'all', PARTICIPANTS_TYPE_MESSAGE],
    ['숫자 하나', 1, PARTICIPANTS_TYPE_MESSAGE],
    ['객체', { all: true }, PARTICIPANTS_TYPE_MESSAGE],
    ['문자열 원소', ['1'], PARTICIPANTS_TYPE_MESSAGE],
    ['0', [0], PARTICIPANTS_TYPE_MESSAGE],
    ['음수', [-1], PARTICIPANTS_TYPE_MESSAGE],
    ['소수', [1.5], PARTICIPANTS_TYPE_MESSAGE],
    ['null 원소', [1, null], PARTICIPANTS_TYPE_MESSAGE],
    [
      '51명',
      Array.from({ length: MAX_PARTICIPANTS + 1 }, (_, i) => i + 1),
      PARTICIPANTS_TOO_MANY_MESSAGE,
    ],
  ])('%s → VALIDATION_FAILED (field participants)', (_label, raw, message) => {
    expect(participantsProblem(raw)).toBe(message);
    expect(() => parseParticipants(raw)).toThrow(
      expect.objectContaining({
        code: 'VALIDATION_FAILED',
        message,
        details: [{ field: 'participants', message }],
      }),
    );
  });

  it('50명까지, 중복을 합쳐 50 이하면 받는다', () => {
    const fifty = Array.from({ length: MAX_PARTICIPANTS }, (_, i) => i + 1);
    expect(parseParticipants(fifty)).toHaveLength(50);
    expect(parseParticipants([...fifty, 1])).toHaveLength(50);
  });
});

describe('EventPatchDto.participants (ValidationPipe 와 같은 검증)', () => {
  const check = async (body: object) => {
    const errors = await validate(plainToInstance(EventPatchDto, body), {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    return errors.map((error) => Object.values(error.constraints ?? {})[0]);
  };

  it('생략, ALL, 배열은 통과', async () => {
    expect(await check({})).toEqual([]);
    expect(await check({ participants: 'ALL' })).toEqual([]);
    expect(await check({ participants: [1, 2] })).toEqual([]);
  });

  it('null, 빈 배열, 형식 오류는 표의 문구', async () => {
    expect(await check({ participants: null })).toEqual([
      PARTICIPANTS_TYPE_MESSAGE,
    ]);
    expect(await check({ participants: [] })).toEqual([
      PARTICIPANTS_EMPTY_MESSAGE,
    ]);
    expect(await check({ participants: ['a'] })).toEqual([
      PARTICIPANTS_TYPE_MESSAGE,
    ]);
  });
});

describe('resolveParticipants', () => {
  const current = { allMembers: false, ids: [2, 3] };
  const members = [3, 1, 2];

  it('생성에서 생략 = [요청자]', () => {
    expect(resolveParticipants(undefined, null, 1, true, members)).toEqual({
      allMembers: false,
      ids: [1],
    });
  });

  it('수정에서 생략 = 그대로 (참여자 없음도 그대로)', () => {
    expect(resolveParticipants(undefined, current, 1, false, members)).toEqual(
      current,
    );
    expect(
      resolveParticipants(
        undefined,
        { allMembers: false, ids: [] },
        1,
        false,
        members,
      ),
    ).toEqual({ allMembers: false, ids: [] });
    // 배포 중 옛 API 가 만든 "모두" 는 생략하면 그대로 (바뀐 게 없는 수정을 저장으로 만들지 않는다)
    expect(
      resolveParticipants(
        undefined,
        { allMembers: true, ids: [] },
        1,
        false,
        members,
      ),
    ).toEqual({ allMembers: true, ids: [] });
  });

  it("(#444) 'ALL' 은 지금 멤버 id 목록으로 풀어 allMembers = false (D-263)", () => {
    expect(resolveParticipants('ALL', null, 1, true, members)).toEqual({
      allMembers: false,
      ids: [1, 2, 3],
    });
    expect(resolveParticipants('ALL', current, 1, false, members)).toEqual({
      allMembers: false,
      ids: [1, 2, 3],
    });
    expect(
      resolveParticipants(
        'ALL',
        { allMembers: true, ids: [] },
        1,
        false,
        [2, 2, 5],
      ),
    ).toEqual({ allMembers: false, ids: [2, 5] });
  });

  it('배열은 그 사람들 (전원을 골라도 ALL 로 바꾸지 않는다, D-133)', () => {
    expect(resolveParticipants([3, 1], current, 1, true, members)).toEqual({
      allMembers: false,
      ids: [1, 3],
    });
  });
});

describe('sameParticipants', () => {
  it('순서와 중복은 무시, 모두끼리는 같다', () => {
    expect(
      sameParticipants(
        { allMembers: false, ids: [2, 1] },
        { allMembers: false, ids: [1, 2] },
      ),
    ).toBe(true);
    expect(
      sameParticipants(
        { allMembers: true, ids: [] },
        { allMembers: true, ids: [5] },
      ),
    ).toBe(true);
    expect(
      sameParticipants(
        { allMembers: false, ids: [] },
        { allMembers: false, ids: [] },
      ),
    ).toBe(true);
  });

  it('모두 ↔ 골라 담기, 사람이 다르면 다르다', () => {
    expect(
      sameParticipants(
        { allMembers: true, ids: [] },
        { allMembers: false, ids: [] },
      ),
    ).toBe(false);
    expect(
      sameParticipants(
        { allMembers: false, ids: [1] },
        { allMembers: false, ids: [1, 2] },
      ),
    ).toBe(false);
    expect(
      sameParticipants(
        { allMembers: false, ids: [1] },
        { allMembers: false, ids: [2] },
      ),
    ).toBe(false);
  });
});

describe('toParticipantsView, participantsSnapshot', () => {
  // 가입순: 1(앨리스) → 3(캐럴) → 2(밥)
  const resolver = new MemberResolver([
    membershipRow({
      userId: 1,
      color: '#F26D6D',
      joinedAt: new Date('2026-11-01T00:00:00Z'),
    }),
    membershipRow({
      userId: 3,
      color: '#6FCF97',
      displayName: '캐럴',
      joinedAt: new Date('2026-11-02T00:00:00Z'),
    }),
    membershipRow({
      userId: 2,
      color: '#F2994A',
      displayName: '밥',
      joinedAt: new Date('2026-11-03T00:00:00Z'),
    }),
  ]);

  it('모두면 지금 멤버 전원, 가입순', () => {
    const view = toParticipantsView(
      { allMembers: true, participantIds: [] },
      resolver,
    );
    expect(view.all).toBe(true);
    expect(view.members.map((member) => member.userId)).toEqual([1, 3, 2]);
    expect(view.members[1]).toEqual({
      userId: 3,
      displayName: '캐럴',
      color: '#6FCF97',
      profileImageUrl: null,
    });
  });

  it('골라 담기는 참여자만 가입순 (id 순서와 무관), 지금 멤버가 아닌 id 는 싣지 않는다', () => {
    expect(
      toParticipantsView(
        { allMembers: false, participantIds: [2, 3, 99] },
        resolver,
      ).members.map((member) => member.userId),
    ).toEqual([3, 2]);
  });

  it('참여자 없음 = all false, members []', () => {
    expect(
      toParticipantsView({ allMembers: false, participantIds: [] }, resolver),
    ).toEqual({ all: false, members: [] });
  });

  it('로그 스냅샷: 모두면 ids null, 아니면 오름차순', () => {
    expect(participantsSnapshot({ allMembers: true, ids: [] })).toEqual({
      participantsAll: true,
      participantIds: null,
    });
    expect(participantsSnapshot({ allMembers: false, ids: [3, 1] })).toEqual({
      participantsAll: false,
      participantIds: [1, 3],
    });
    expect(participantsSnapshot({ allMembers: false, ids: [] })).toEqual({
      participantsAll: false,
      participantIds: [],
    });
  });
});
