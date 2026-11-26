import { isBusyForAny } from './participants.js';

/**
 * (#248) 설계 4장 예시 표 = 기획 7장 성공 기준 2.
 * 요청 팀 A = {엄마, 아빠}, 엄마는 팀 B(엄마, 이모) 에도 소속. 후보 일정은 A, B, 엄마 개인, 아빠 개인 팀에서 읽힌다
 */
describe('isBusyForAny (설계 4장 예시 표)', () => {
  const MOM = 1;
  const DAD = 2;
  const AUNT = 3;
  const teamA = new Set([MOM, DAD]);
  const all = { allMembers: true, participantIds: [] };
  const only = (...ids: number[]) => ({
    allMembers: false,
    participantIds: ids,
  });

  it.each([
    ['아이 병원', 'A', '아빠', true, only(DAD)],
    ['저녁 약속', 'A', '모두', true, all],
    ['지난 팀원 일정', 'A', '참여자 없음', false, only()],
    ['이모 미용실', 'B', '이모', false, only(AUNT)],
    ['자매 모임', 'B', '모두', true, all],
    ['엄마 회식', 'B', '엄마, 이모', true, only(MOM, AUNT)],
    ['엄마 개인 일정 (기존)', '엄마 개인', '모두', true, all],
    ['엄마 개인 일정 (새)', '엄마 개인', '엄마', true, only(MOM)],
  ])('%s (팀 %s, 참여자 %s) → 바쁨 %s', (_title, _team, _who, busy, event) => {
    expect(isBusyForAny(event, teamA)).toBe(busy);
  });
});
