"use client";
// (#490) 지금 보는 팀 번호(상태 + 쿠키), 팀 목록과 팀 상세 조회, 자식 화면이 받은 403 표시. AppShell 에서 옮김
import { useCallback, useState } from "react";
import { useGroup, useGroupGone, useGroups } from "@/hooks";
import { rememberGroup } from "@/lib/group-cookie";
import type { GroupSummary } from "@/lib/types";

export function useCurrentGroup(initialGroupId: number | null, initialGroups: GroupSummary[] | null) {
  const [groupId, setGroupIdState] = useState<number | null>(initialGroupId);
  const setGroupId = useCallback((id: number) => {
    rememberGroup(id);
    setGroupIdState(id);
  }, []);

  const groupsQ = useGroups({ initialData: initialGroups ?? undefined });
  const groupQ = useGroup(groupId);
  // 자식 화면(일정, 기념일, 새 소식 등)의 호출이 403 을 받아도 같은 안내로 바꾼다. 어느 팀을 보던 중이었는지 같이 둔다:
  // 쿠키의 옛 팀(내 팀이 아님)이 403 을 내고 아래에서 다른 팀으로 바꾼 뒤에는 그 안내를 보이지 않는다
  const [goneFor, setGoneFor] = useState<number | null>(null);
  const markGone = useCallback(() => setGoneFor(groupId), [groupId]);
  useGroupGone(markGone);
  const goneByEvent = goneFor !== null && goneFor === groupId;

  return { groupId, setGroupId, setGroupIdState, groupsQ, groupQ, goneByEvent };
}
