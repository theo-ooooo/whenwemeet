"use client";
// (#490) AppShell 이 내려주는 팀 컨텍스트. AppShell 에서 옮김 (바깥은 지금처럼 "@/components/AppShell" 에서 가져다 쓴다)
import { createContext, useContext } from "react";
import type { GroupDetail, GroupSummary } from "@/lib/types";

export type GroupCtx = {
  groupId: number;
  groups: GroupSummary[] | null;
  group: GroupDetail | null;
  error: string | null;
  refresh: () => Promise<void>;
  setGroup: (g: GroupDetail) => void;
  clearUnread: () => void;
  /** 팀 전환 시트 열기 */
  openSwitcher: () => void;
  /** (#311) 지금 보는 팀을 바꾼다 (쿠키 포함). `/events/<코드>` 페이지처럼 주소가 가리키는 팀이 따로 있을 때 (TeamScope) */
  setGroupId: (id: number) => void;
  /** 일정이 바뀌었음 (달력의 빠른 추가, 삭제). 넓은 화면 사이드바의 다가오는 일정을 다시 받는다 */
  eventsChanged: () => void;
  /** (#375) 지운 일정을 되돌렸음. 달력 화면이 restoredVersion 이 바뀌면 다시 받는다 (일정 화면에서 지우고 달력으로 옮긴 뒤 되돌려도) */
  eventsRestored: () => void;
  restoredVersion: number;
  /** 화면별 + 동작 (#170). 화면이 정하면 폰 + 가 일정 추가 대신 이것을 부른다. null 이면 일정 추가 */
  setFabAction: (a: FabAction | null) => void;
};

export type FabAction = { label: string; run: () => void };

export const Ctx = createContext<GroupCtx | null>(null);

/** AppShell 이 받은 팀 정보(목록 + 현재 팀). 데이터 훅 useGroup(id) 과 구분해 이름을 붙였다 */
export function useGroupContext() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("AppShell 안에서만 쓸 수 있어요");
  return ctx;
}
