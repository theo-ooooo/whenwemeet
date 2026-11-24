"use client";
// (#490) 자식 화면에 내려줄 팀 컨텍스트 값과 그 콜백(다시 받기, 새 소식 읽음, 일정 변경 알림, 화면별 + 동작). AppShell 에서 옮김
import { useCallback, useMemo, useState } from "react";
import type { QueryResult } from "@/hooks";
import type { GroupDetail, GroupSummary } from "@/lib/types";
import type { FabAction, GroupCtx } from "./context";

type Args = {
  groupId: number | null;
  groupsQ: QueryResult<GroupSummary[]>;
  groupQ: QueryResult<GroupDetail>;
  error: string | null;
  setGroupId: (id: number) => void;
  /** 팀 전환 시트 열기 (시트 상태는 AppShell 에 있다) */
  openSwitcher: () => void;
};

/** @returns value: 컨텍스트 값(팀이 정해지기 전에는 null), eventsVersion: 사이드바 다시 받기 키, fabAction: 지금 팀에 걸린 + 동작 */
export function useGroupContextValue({ groupId, groupsQ, groupQ, error, setGroupId, openSwitcher }: Args) {
  const groups = groupsQ.data;
  const group = groupQ.data;

  const refreshGroups = groupsQ.refetch;
  const refreshGroup = groupQ.refetch;
  const refresh = useCallback(async () => {
    await Promise.all([refreshGroups(), refreshGroup()]);
  }, [refreshGroups, refreshGroup]);

  const setGroups = groupsQ.setData;
  const setGroupData = groupQ.setData;

  const clearUnread = useCallback(() => {
    setGroups((prev) => prev?.map((g) => (g.id === groupId ? { ...g, unreadNewsCount: 0 } : g)) ?? prev);
  }, [groupId, setGroups]);

  const setGroup = useCallback(
    (g: GroupDetail) => {
      setGroupData(g);
      setGroups((prev) => prev?.map((x) => (x.id === g.id ? { ...x, name: g.name, memberCount: g.members.length, me: { color: g.me.color, displayName: g.me.displayName } } : x)) ?? prev);
    },
    [setGroupData, setGroups],
  );

  const [eventsVersion, setEventsVersion] = useState(0);
  const eventsChanged = useCallback(() => setEventsVersion((v) => v + 1), []);
  const [restoredVersion, setRestoredVersion] = useState(0);
  const eventsRestored = useCallback(() => setRestoredVersion((v) => v + 1), []);
  // 화면별 + 동작은 건 팀과 함께 둔다. 팀이 바뀌면 자식 화면이 다시 마운트되며 다시 걸고, 그 전까지는 일정 추가
  const [fab, setFab] = useState<{ groupId: number | null; action: FabAction | null }>({ groupId: null, action: null });
  const setFabAction = useCallback((action: FabAction | null) => setFab({ groupId, action }), [groupId]);
  const fabAction = fab.groupId === groupId ? fab.action : null;
  const value = useMemo<GroupCtx | null>(
    () =>
      groupId === null
        ? null
        : { groupId, groups, group: group && group.id === groupId ? group : null, error, refresh, setGroup, clearUnread, openSwitcher, setGroupId, eventsChanged, eventsRestored, restoredVersion, setFabAction },
    [groupId, groups, group, error, refresh, setGroup, clearUnread, openSwitcher, setGroupId, eventsChanged, eventsRestored, restoredVersion, setFabAction],
  );

  return { value, eventsVersion, fabAction };
}
