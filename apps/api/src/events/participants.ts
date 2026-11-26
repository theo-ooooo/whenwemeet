import { ApiException } from '../common/errors.js';
import type { Member, MemberResolver } from '../common/member.js';

/**
 * (#248) 본문 입력. 'ALL' = 지금 멤버 전원, 배열 = 고른 멤버 userId (설계 3-1, D-133).
 * (#444) 'ALL' 은 옛 화면, 앱 셸 호환으로 계속 받지만 "모두"(나중 합류자 포함)로 저장하지 않고 그 시각 멤버 id 목록으로 푼다 (D-263)
 */
export type ParticipantsInput = 'ALL' | number[];

/**
 * (#248) 저장 모양. allMembers 가 false 이고 ids 가 비면 "참여자 없음" (D-130). ids 는 오름차순, 중복 없음.
 * (#444) 새로 쓰는 값은 항상 allMembers = false 다 (D-263). true 는 마이그레이션 전 행, 배포 중 옛 API 가 만든 행을 읽을 때만 나온다
 */
export interface ParticipantSet {
  allMembers: boolean;
  ids: number[];
}

/** (#248) 응답 모양 (D-134). all 이면 members 는 지금 멤버 전원, 아니면 참여자. 둘 다 가입순 */
export interface ParticipantsView {
  all: boolean;
  members: Member[];
}

/** 한 일정에 고를 수 있는 참여자 수 상한 (설계 3-2) */
export const MAX_PARTICIPANTS = 50;

export const PARTICIPANTS_FIELD = 'participants';
export const PARTICIPANTS_TYPE_MESSAGE =
  "participants 는 'ALL' 또는 멤버 id 배열이어야 해요";
export const PARTICIPANTS_EMPTY_MESSAGE = '참여자를 한 명 이상 골라 주세요';
export const PARTICIPANTS_TOO_MANY_MESSAGE = `참여자는 최대 ${MAX_PARTICIPANTS}명까지 고를 수 있어요`;
export const PARTICIPANTS_NOT_MEMBER_MESSAGE =
  '이 팀 멤버만 참여자로 고를 수 있어요';
export const PARTICIPANTS_THIS_SCOPE_MESSAGE =
  '이 일정만 수정할 때는 참여자를 바꿀 수 없어요';

export function participantsFailed(message: string): ApiException {
  return new ApiException('VALIDATION_FAILED', message, [
    { field: PARTICIPANTS_FIELD, message },
  ]);
}

/** 입력 형식 문제를 문구로. 문제가 없으면 null. DTO 검증과 parseParticipants 가 같이 쓴다 (설계 3-2 표) */
export function participantsProblem(raw: unknown): string | null {
  if (raw === undefined || raw === 'ALL') return null;
  if (!Array.isArray(raw)) return PARTICIPANTS_TYPE_MESSAGE;
  if (!raw.every((id) => Number.isSafeInteger(id) && (id as number) > 0))
    return PARTICIPANTS_TYPE_MESSAGE;
  if (raw.length === 0) return PARTICIPANTS_EMPTY_MESSAGE;
  if (new Set(raw).size > MAX_PARTICIPANTS)
    return PARTICIPANTS_TOO_MANY_MESSAGE;
  return null;
}

/**
 * 본문 값 → 'ALL' | 오름차순 중복 없는 userId 배열 | undefined(생략). 형식이 틀리면 VALIDATION_FAILED.
 * 멤버 여부는 여기서 보지 않는다 (쓰기 트랜잭션 안에서, D-133)
 */
export function parseParticipants(raw: unknown): ParticipantsInput | undefined {
  const problem = participantsProblem(raw);
  if (problem) throw participantsFailed(problem);
  if (raw === undefined || raw === 'ALL') return raw;
  return sortedUnique(raw as number[]);
}

/**
 * 저장할 참여자. 생략이면 생성은 [요청자], 수정은 지금 값 그대로 (설계 3-2).
 * 멤버 전원을 하나씩 고른 배열도 'ALL' 로 바꾸지 않는다 (D-133).
 * (#444) 'ALL' 은 memberIds(그 팀의 지금 멤버 userId) 로 풀어 allMembers = false 로 돌려준다. "모두" 를 새로 저장하지 않는다 (D-263).
 * 생략한 수정은 지금 값 그대로라 "모두"(마이그레이션 뒤 배포 중 옛 API 가 만든 행) 는 그대로 남는다. 바뀐 게 없는 수정을 저장으로 만들지 않기 위해서다
 */
export function resolveParticipants(
  input: ParticipantsInput | undefined,
  current: ParticipantSet | null,
  requesterId: number,
  isCreate: boolean,
  memberIds: readonly number[],
): ParticipantSet {
  if (input === 'ALL')
    return { allMembers: false, ids: sortedUnique(memberIds) };
  if (input !== undefined)
    return { allMembers: false, ids: sortedUnique(input) };
  if (isCreate || current === null)
    return { allMembers: false, ids: [requesterId] };
  return { allMembers: current.allMembers, ids: [...current.ids] };
}

/** 순서와 무관하게 같은 참여자인지. "모두" 끼리는 행과 무관하게 같다 */
export function sameParticipants(
  a: ParticipantSet,
  b: ParticipantSet,
): boolean {
  if (a.allMembers !== b.allMembers) return false;
  if (a.allMembers) return true;
  const x = sortedUnique(a.ids);
  const y = sortedUnique(b.ids);
  return x.length === y.length && x.every((id, i) => id === y[i]);
}

/** 응답 모양. 가입순 = 해석기의 멤버 순서. 지금 멤버가 아닌 id 는 싣지 않는다 (나가면 행이 지워져 원래 없다, 설계 6장) */
export function toParticipantsView(
  row: { allMembers: boolean; participantIds: number[] },
  resolver: MemberResolver,
): ParticipantsView {
  const members = resolver.all();
  if (row.allMembers) return { all: true, members };
  const ids = new Set(row.participantIds);
  return {
    all: false,
    members: members.filter(
      (member) => member.userId !== null && ids.has(member.userId),
    ),
  };
}

/** 로그 스냅샷 (D-136). "모두" 면 participantIds 는 null */
export function participantsSnapshot(set: ParticipantSet): {
  participantsAll: boolean;
  participantIds: number[] | null;
} {
  return {
    participantsAll: set.allMembers,
    participantIds: set.allMembers ? null : sortedUnique(set.ids),
  };
}

function sortedUnique(ids: readonly number[]): number[] {
  return [...new Set(ids)].sort((a, b) => a - b);
}
