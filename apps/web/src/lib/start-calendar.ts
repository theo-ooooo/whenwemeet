// (#300) 처음 여는 달력 (D-191, D-192). 맨 `/` 진입에서만 쓴다 (app/route.ts). 딥링크(/calendar?team=, /events/..., /join/..., 알림 누름)는 이 규칙을 거치지 않는다.
// (#311) 쿠키 없이 /calendar 를 바로 열면 (team) 레이아웃이 remembered=null 로 이 함수를 불러 LAST 규칙(개인 팀, 없으면 첫 팀)을 쓴다
import type { GroupSummary, StartCalendar, StartCalendarMode } from "./types";

/** 설정을 못 읽었을 때(GET /me 실패)와 기본값 */
export const START_LAST: StartCalendar = { mode: "LAST", groupId: null };

/** 내 정보 행 오른쪽 값과 시트 선택지 이름 */
export const START_MODE_LABEL: Record<Exclude<StartCalendarMode, "GROUP">, string> = {
  LAST: "마지막에 본 달력",
  PERSONAL: "내 달력",
};

/** 행 오른쪽에 보일 현재 값. GROUP 인데 팀 목록에 없으면(막 나간 팀) 마지막에 본 달력 */
export function startCalendarLabel(value: StartCalendar | undefined, groups: Pick<GroupSummary, "id" | "name">[] | null): string {
  if (!value || value.mode === "LAST") return START_MODE_LABEL.LAST;
  if (value.mode === "PERSONAL") return START_MODE_LABEL.PERSONAL;
  const team = groups?.find((g) => g.id === value.groupId);
  return team ? team.name : START_MODE_LABEL.LAST;
}

/**
 * `/` 에서 열 팀 ID. null 이면 팀이 하나도 없다(새 팀 만들기로).
 * - GROUP: 고정한 팀이 내 팀 목록에 있으면 그 팀. 없으면(나갔거나 지워짐) LAST 규칙. 서버는 나가기, 팀 삭제 트랜잭션에서 이미 LAST 로 되돌렸다
 * - PERSONAL: 개인 팀(내 달력), 없으면 첫 팀
 * - LAST: 쿠키 wwm_group 의 팀이 내 팀이면 그 팀, 아니면 개인 팀, 없으면 첫 팀 (#18, 지금 동작)
 */
export function pickStartGroupId(groups: Pick<GroupSummary, "id" | "type">[], start: StartCalendar | null, remembered: number | null): number | null {
  const personal = groups.find((g) => g.type === "PERSONAL") ?? groups[0];
  if (start?.mode === "GROUP" && start.groupId !== null && groups.some((g) => g.id === start.groupId)) return start.groupId;
  if (start?.mode === "PERSONAL") return personal?.id ?? null;
  if (remembered !== null && groups.some((g) => g.id === remembered)) return remembered;
  return personal?.id ?? null;
}
