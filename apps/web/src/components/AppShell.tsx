"use client";
// /g/[groupId]/* 공통 뼈대: 상단 바(팀 전환, 새 소식, 내 프로필) + 하단 탭. 팀 정보를 컨텍스트로 내려준다
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { messageOf, useGroup, useGroupGone, useGroups, type ApiFailure } from "@/hooks";
import { forgetGroup, rememberGroup } from "@/lib/group-cookie";
import type { GroupDetail, GroupSummary } from "@/lib/types";
import { GroupGone } from "./GroupGone";
import { Avatar, MemberDot, Sheet, Skeleton } from "./ui";

type GroupCtx = {
  groupId: string;
  groups: GroupSummary[] | null;
  group: GroupDetail | null;
  error: string | null;
  refresh: () => Promise<void>;
  setGroup: (g: GroupDetail) => void;
  clearUnread: () => void;
};

const Ctx = createContext<GroupCtx | null>(null);

/** AppShell 이 받은 팀 정보(목록 + 현재 팀). 데이터 훅 useGroup(id) 과 구분해 이름을 붙였다 */
export function useGroupContext() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("AppShell 안에서만 쓸 수 있어요");
  return ctx;
}

/** 이 팀에 더 이상 접근할 수 없음(403 멤버 아님, 404 팀 없음) */
const isGone = (f: ApiFailure | null) => f !== null && (f.status === 403 || f.status === 404);

const TABS = [
  { key: "calendar", label: "달력" },
  { key: "free", label: "빈 시간" },
  { key: "anniversaries", label: "기념일" },
  { key: "settings", label: "팀" },
] as const;

function TabIcon({ name, active }: { name: (typeof TABS)[number]["key"]; active: boolean }) {
  const stroke = active ? "currentColor" : "currentColor";
  const common = { width: 22, height: 22, viewBox: "0 0 24 24", fill: "none", stroke, strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  switch (name) {
    case "calendar":
      return (
        <svg {...common}>
          <rect x="3.5" y="5" width="17" height="15.5" rx="3" />
          <path d="M3.5 10h17M8 3v4M16 3v4" />
          {active && <circle cx="12" cy="15" r="1.8" fill="currentColor" stroke="none" />}
        </svg>
      );
    case "free":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8.5" />
          <path d="M12 7.5V12l3 2" />
        </svg>
      );
    case "anniversaries":
      return (
        <svg {...common}>
          <path d="M12 20s-7-4.4-7-9.5A4 4 0 0 1 12 8a4 4 0 0 1 7 2.5C19 15.6 12 20 12 20z" />
        </svg>
      );
    case "settings":
      return (
        <svg {...common}>
          <circle cx="9" cy="8.5" r="3.2" />
          <circle cx="16.5" cy="9.5" r="2.6" />
          <path d="M3.5 19c.6-3 2.8-4.8 5.5-4.8s4.9 1.8 5.5 4.8M14.5 14.6c2.4.2 4.3 1.6 5 4.4" />
        </svg>
      );
  }
}

export function AppShell({ groupId, children }: { groupId: string; children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  // groupId 가 바뀌면 layout 이 key 로 다시 마운트하므로 여기서는 불러오기만 한다
  const groupsQ = useGroups();
  const groupQ = useGroup(groupId);
  // 자식 화면(일정, 기념일, 새 소식 등)의 호출이 403 을 받아도 같은 안내로 바꾼다
  const [goneByEvent, setGoneByEvent] = useState(false);
  const markGone = useCallback(() => setGoneByEvent(true), []);
  useGroupGone(markGone);
  const [switcher, setSwitcher] = useState(false);

  // 이 팀에 더 이상 접근할 수 없음. 남은 wwm_group 쿠키를 지우고 안내 화면으로 (#18)
  const groupsError = groupsQ.error;
  const groupError = groupQ.error;
  const gone = goneByEvent || isGone(groupError) || isGone(groupsError);
  useEffect(() => {
    if (gone) forgetGroup();
  }, [gone]);

  const group = groupQ.data;
  useEffect(() => {
    if (group) rememberGroup(groupId);
  }, [group, groupId]);

  const groups = groupsQ.data;
  const failure = gone ? null : (groupError ?? groupsError);
  const error = failure ? messageOf(failure, "팀 정보를 불러오지 못했어요") : null;

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

  const value = useMemo<GroupCtx>(
    () => ({ groupId, groups, group, error, refresh, setGroup, clearUnread }),
    [groupId, groups, group, error, refresh, setGroup, clearUnread],
  );

  const section = pathname.split("/")[3] ?? "calendar";
  const unread = groups?.find((g) => g.id === groupId)?.unreadNewsCount ?? 0;

  if (gone) return <GroupGone />;

  function switchTo(id: string) {
    setSwitcher(false);
    if (id === groupId) return;
    rememberGroup(id);
    const tab = TABS.some((t) => t.key === section) ? section : "calendar";
    router.push(`/g/${id}/${tab}`);
  }

  return (
    <Ctx.Provider value={value}>
      <div className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between bg-surface/90 px-3 backdrop-blur">
          <button
            type="button"
            onClick={() => setSwitcher(true)}
            aria-haspopup="dialog"
            className="flex min-w-0 items-center gap-1.5 rounded-sm px-2 py-1.5 text-left hover:bg-paper"
          >
            {group ? (
              <>
                <span className="truncate text-[17px] font-bold tracking-[-0.02em]">{group.name}</span>
                <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-ink-2">
                  <path d="m6 9 6 6 6-6" />
                </svg>
                <span className="sr-only">팀 바꾸기</span>
              </>
            ) : (
              <Skeleton className="h-5 w-24" />
            )}
          </button>
          <div className="flex items-center gap-1">
            <Link
              href={`/g/${groupId}/news`}
              aria-label={unread > 0 ? `새 소식 ${unread}개` : "새 소식"}
              className="relative rounded-sm p-2 hover:bg-paper"
            >
              <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15L6 16z" />
                <path d="M10 20a2 2 0 0 0 4 0" />
              </svg>
              {unread > 0 && (
                <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand px-1 text-[10px] font-bold leading-none text-paper">
                  {unread > 99 ? "99+" : unread}
                </span>
              )}
            </Link>
            <Link href="/me" aria-label="내 정보" className="rounded-full p-1 hover:bg-paper">
              {group ? <Avatar member={group.me} size={30} /> : <Skeleton className="size-[30px] rounded-full" />}
            </Link>
          </div>
        </header>

        <main className="flex-1 px-5 pb-[calc(88px+env(safe-area-inset-bottom))]">{children}</main>

        <nav
          aria-label="주요 화면"
          className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-paper pb-[env(safe-area-inset-bottom)]"
        >
          <ul className="mx-auto flex h-16 max-w-[480px]">
            {TABS.map((t) => {
              const active = section === t.key || (t.key === "calendar" && section === "events");
              return (
                <li key={t.key} className="flex-1">
                  <Link
                    href={`/g/${groupId}/${t.key}`}
                    aria-current={active ? "page" : undefined}
                    className={`flex h-full flex-col items-center justify-center gap-0.5 text-[11px] font-semibold ${active ? "text-brand" : "text-ink-2"}`}
                  >
                    <TabIcon name={t.key} active={active} />
                    {t.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </div>

      <Sheet open={switcher} onClose={() => setSwitcher(false)} title="내 팀">
        <ul className="-mx-2">
          {(groups ?? []).map((g) => {
            const current = g.id === groupId;
            return (
              <li key={g.id}>
                <button
                  type="button"
                  onClick={() => switchTo(g.id)}
                  aria-current={current ? "true" : undefined}
                  className={`flex w-full items-center gap-3 rounded-sm px-2 py-3 text-left hover:bg-surface ${current ? "bg-brand-soft" : ""}`}
                >
                  <MemberDot color={g.me.color} size={10} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-semibold">{g.name}</span>
                    <span className="t-sub block">
                      {g.type === "PERSONAL" ? "나만 보는 달력" : `멤버 ${g.memberCount}명`}
                    </span>
                  </span>
                  {g.unreadNewsCount > 0 && (
                    <span className="flex items-center gap-1 text-[12px] font-semibold text-brand">
                      <span aria-hidden="true" className="size-2 rounded-full bg-brand" />
                      새 소식 {g.unreadNewsCount}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
        <Link
          href="/groups/new"
          onClick={() => setSwitcher(false)}
          className="mt-3 flex h-12 items-center justify-center rounded-sm border border-dashed border-ink-2/40 text-[15px] font-semibold text-brand hover:bg-brand-soft"
        >
          새 팀 만들기
        </Link>
      </Sheet>
    </Ctx.Provider>
  );
}
