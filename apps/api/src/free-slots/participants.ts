import type { BusyParticipants } from '../events/event-busy.repository.js';

/**
 * (#248) 일정 하나가 요청 팀 멤버 중 누군가를 바쁘게 하는지 (설계 4장, D-137). 일정은 그 일정의 참여자만 바쁘게 한다.
 * - "모두" 면 그 팀 멤버 전원이 바쁘다. 후보 일정은 요청 팀 멤버들이 속한 팀(allGroupIds)에서만 읽으므로 그 팀에 요청 팀 멤버가 있다
 * - 골라 담기면 참여자 중 요청 팀 멤버가 있을 때만
 * - 참여자 없음(allMembers false, 행 0) 이면 아무도 바쁘지 않다
 */
export function isBusyForAny(
  event: BusyParticipants,
  memberIds: ReadonlySet<number>,
): boolean {
  return (
    event.allMembers || event.participantIds.some((id) => memberIds.has(id))
  );
}
