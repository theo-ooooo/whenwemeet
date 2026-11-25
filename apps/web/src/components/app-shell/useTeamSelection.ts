"use client";
// (#490) 어느 팀을 볼지 맞춘다: `?team=` 코드, 쿠키, 목록에 없는 팀 대신 고르기, 접근할 수 없는 팀 안내. AppShell 에서 옮김
import type { ReadonlyURLSearchParams } from "next/navigation";
import { useEffect } from "react";
import { messageOf, type ApiFailure, type QueryResult } from "@/hooks";
import { forgetGroup, readGroupCookie, rememberGroup } from "@/lib/group-cookie";
import { parsePublicCode, stripTeam, TEAM_PARAM } from "@/lib/routes";
import { pickStartGroupId } from "@/lib/start-calendar";
import type { GroupDetail, GroupSummary } from "@/lib/types";

/** 이 팀에 더 이상 접근할 수 없음(403 멤버 아님, 404 팀 없음) */
const isGone = (f: ApiFailure | null) => f !== null && (f.status === 403 || f.status === 404);

/** `?team=` 코드 → 내 팀. 목록에 없으면 null (멤버가 아니거나 없는 팀) */
export function resolveTeamParam(groups: readonly Pick<GroupSummary, "id" | "publicCode">[], code: string): number | null {
  return groups.find((g) => g.publicCode === code)?.id ?? null;
}

type Args = {
  initialGroupId: number | null;
  groupId: number | null;
  setGroupId: (id: number) => void;
  setGroupIdState: (id: number) => void;
  groupsQ: QueryResult<GroupSummary[]>;
  groupQ: QueryResult<GroupDetail>;
  /** 자식 화면의 호출이 지금 팀에서 403 을 받았음 (useCurrentGroup) */
  goneByEvent: boolean;
  searchParams: ReadonlyURLSearchParams;
  router: { replace: (href: string) => void };
};

/**
 * @returns gone: 안내 화면으로 바꿀지, hidden: (#515) 지금 팀의 운영 숨김(사유), resolvingTeam: `?team=` 을 아직 맞추는 중(자식 화면을 그리지 않는다), error: 컨텍스트에 실을 오류 문구
 */
export function useTeamSelection({ initialGroupId, groupId, setGroupId, setGroupIdState, groupsQ, groupQ, goneByEvent, searchParams, router }: Args) {
  const groups = groupsQ.data;

  // (#311) `?team=<코드>`: 내 팀 목록으로 코드를 찾아 그 팀으로 바꾸고 주소에서 뗀다. 목록을 받기 전에는 자식 화면을 그리지 않는다
  // (쿠키 팀의 데이터가 잠깐 비치지 않게). 없는 팀이면 "이 팀을 열 수 없어요"
  const teamParam = parsePublicCode(searchParams.get(TEAM_PARAM));
  const teamId = teamParam !== null && groups !== null ? resolveTeamParam(groups, teamParam) : null;
  const teamGone = teamParam !== null && groups !== null && teamId === null;
  useEffect(() => {
    if (teamId === null) return;
    // 효과 본문에서 바로 setState 하지 않도록 마이크로태스크로 미룬다 (hooks/_useQuery 와 같은 규칙)
    queueMicrotask(() => {
      setGroupId(teamId);
      // router.replace 는 페이지를 다시 받아 화면 상태(달력의 날짜 상세 등)가 날아간다. Next 가 주소만 맞추게 history 로 (#57)
      window.history.replaceState(null, "", `${window.location.pathname}${stripTeam(window.location.search)}${window.location.hash}`);
    });
  }, [teamId, setGroupId]);
  const resolvingTeam = teamParam !== null && !teamGone;

  // 뒤로가기 복원 등으로 서버가 넘긴 처음 값이 쿠키보다 오래됐으면 쿠키를 따른다 (다른 탭, 다른 화면에서 팀을 바꾼 경우)
  useEffect(() => {
    if (teamParam !== null) return;
    const remembered = readGroupCookie();
    if (remembered !== null && remembered !== initialGroupId) queueMicrotask(() => setGroupIdState(remembered));
    // 마운트 때 한 번만
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 쿠키의 팀이 내 팀이 아니거나(나갔거나 삭제된 팀, 목 모드 잔여값) 팀이 정해지지 않았으면 목록에서 고른다 (#18, LAST 규칙).
  // 팀이 하나도 없으면 새 팀 만들기로
  const stale = groups !== null && teamParam === null && (groupId === null || !groups.some((g) => g.id === groupId));
  useEffect(() => {
    if (!stale) return;
    const fallback = pickStartGroupId(groups, null, null);
    if (fallback === null) router.replace("/groups/new");
    else queueMicrotask(() => setGroupId(fallback));
  }, [stale, groups, setGroupId, router]);

  // 이 팀에 더 이상 접근할 수 없음. 남은 wwm_group 쿠키를 지우고 안내 화면으로 (#18)
  const groupsError = groupsQ.error;
  const groupError = groupQ.error;
  // 팀 상세만 403/404 인 경우는 목록에 있는 팀일 때만 (목록에 없으면 위에서 다른 팀으로 바꾼다)
  const detailGone = isGone(groupError) && groups !== null && groups.some((g) => g.id === groupId);
  // (#515) 운영 숨김 팀은 "열 수 없어요" 대신 뼈대 안 이용 제한 안내 (팀 바꾸기를 그대로 쓸 수 있게, D-286)
  const hidden = groups?.find((g) => g.id === groupId)?.hidden ?? null;
  const gone = !hidden && (goneByEvent || teamGone || detailGone || isGone(groupsError));
  useEffect(() => {
    if (gone) forgetGroup();
  }, [gone]);

  const group = groupQ.data;
  useEffect(() => {
    if (group && group.id === groupId) rememberGroup(groupId);
  }, [group, groupId]);

  const failure = gone ? null : hidden ? groupsError : (groupError ?? groupsError);
  const error = failure ? messageOf(failure, "팀 정보를 불러오지 못했어요") : null;

  return { gone, resolvingTeam, error, hidden };
}
