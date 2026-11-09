"use client";
// /g/[groupId]/* 공통 뼈대: 상단 바(팀 전환, 새 소식, 내 프로필) + 하단 탭. 팀 정보를 컨텍스트로 내려준다
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { messageOf, useGroup, useGroupGone, useGroups, type ApiFailure } from "@/hooks";
import { forgetGroup, rememberGroup } from "@/lib/group-cookie";
import type { GroupDetail, GroupSummary } from "@/lib/types";
import { GroupGone } from "./GroupGone";
import { cycleColor } from "@/lib/colors";
import { kstToIso, todayKey } from "@/lib/date";
import { Symbol } from "./Logo";
import { IconBell, IconCalendar, IconChevronDown, IconClock, IconHeart, IconPlus, IconTeam } from "./icons";
import { Avatar, Sheet, Skeleton } from "./ui";

type GroupCtx = {
  groupId: number;
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
  switch (name) {
    case "calendar":
      return <IconCalendar active={active} />;
    case "free":
      return <IconClock />;
    case "anniversaries":
      return <IconHeart />;
    case "settings":
      return <IconTeam />;
  }
}

/** 사이드바 팀 점 색: 개인 달력은 먹색, 팀은 목록 순서대로 멤버 색 순환 (목업 PC) */
function teamDotColors(groups: GroupSummary[]): Map<number, string> {
  const map = new Map<number, string>();
  let i = 0;
  for (const g of groups) map.set(g.id, g.type === "PERSONAL" ? "var(--ink)" : cycleColor(i++));
  return map;
}

export function AppShell({ groupId, children }: { groupId: number; children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
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

  function switchTo(id: number) {
    setSwitcher(false);
    if (id === groupId) return;
    rememberGroup(id);
    const tab = TABS.some((t) => t.key === section) ? section : "calendar";
    router.push(`/g/${id}/${tab}`);
  }

  // + 버튼: 달력에서 고른 날(쿼리 date), 없으면 오늘 10:00~11:00
  const dateParam = searchParams.get("date");
  const baseDay = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : todayKey();
  const newHref = `/g/${groupId}/events/new?start=${encodeURIComponent(kstToIso(baseDay, "10:00"))}&end=${encodeURIComponent(kstToIso(baseDay, "11:00"))}`;
  const dots = teamDotColors(groups ?? []);
  const isCalendar = section === "calendar";

  const menu = [
    { href: `/g/${groupId}/calendar`, label: "달력", icon: <IconCalendar size={18} />, on: section === "calendar" || section === "events" },
    { href: `/g/${groupId}/free`, label: "빈 시간 찾기", icon: <IconClock size={18} />, on: section === "free" },
    { href: `/g/${groupId}/anniversaries`, label: "기념일", icon: <IconHeart size={18} />, on: section === "anniversaries" },
    { href: `/g/${groupId}/news`, label: "새 소식", icon: <IconBell size={18} />, on: section === "news", badge: unread },
    { href: `/g/${groupId}/settings`, label: "팀 설정", icon: <IconTeam size={18} />, on: section === "settings" },
  ];

  return (
    <Ctx.Provider value={value}>
      <div className="min-h-dvh lg:grid lg:grid-cols-[232px_minmax(0,1fr)]">
        {/* PC 사이드바 (목업 .side) */}
        <aside className="sticky top-0 hidden h-dvh flex-col gap-1.5 overflow-y-auto px-4 py-[26px] lg:flex">
          <Link href={`/g/${groupId}/calendar`} className="flex items-center gap-2.5 rounded-sm px-2 pb-[22px] text-[18px] font-extrabold tracking-[-0.03em]">
            <Symbol size={30} />
            언제볼까
          </Link>
          <nav aria-label="주요 화면" className="flex flex-col gap-1.5">
            {menu.map((it) => (
              <Link
                key={it.label}
                href={it.href}
                aria-current={it.on ? "page" : undefined}
                className={`flex items-center gap-2.5 rounded-sm px-3 py-2.5 text-[14px] font-semibold ${it.on ? "bg-paper" : "hover:bg-paper/60"}`}
              >
                {it.icon}
                {it.label}
                {it.badge ? (
                  <span className="ml-auto rounded-full bg-brand px-[7px] py-0.5 text-[11px] font-bold text-white">
                    <span className="sr-only">새 소식 </span>
                    {it.badge > 99 ? "99+" : it.badge}
                  </span>
                ) : null}
              </Link>
            ))}
          </nav>
          <h2 className="px-2.5 pb-1.5 pt-3.5 text-[11px] font-bold text-ink-2">내 팀</h2>
          <ul className="flex flex-col gap-1.5">
            {groups
              ? groups.map((g) => {
                  const current = g.id === groupId;
                  return (
                    <li key={g.id}>
                      <button
                        type="button"
                        onClick={() => switchTo(g.id)}
                        aria-current={current ? "true" : undefined}
                        className={`flex w-full items-center gap-2.5 rounded-sm px-3 py-2.5 text-left text-[14px] font-semibold ${current ? "bg-paper" : "hover:bg-paper/60"}`}
                      >
                        <span aria-hidden="true" className="size-2.5 shrink-0 rounded-[3px]" style={{ background: dots.get(g.id) }} />
                        <span className="min-w-0 flex-1 truncate">{g.name}</span>
                        {!current && g.unreadNewsCount > 0 && (
                          <span className="rounded-full bg-brand px-[7px] py-0.5 text-[11px] font-bold text-white">
                            <span className="sr-only">새 소식 </span>
                            {g.unreadNewsCount}
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })
              : [0, 1].map((i) => <Skeleton key={i} className="mx-3 my-2.5 h-4" />)}
            <li>
              <Link href="/groups/new" className="flex items-center gap-2.5 rounded-sm px-3 py-2.5 text-[14px] font-semibold text-ink-2 hover:bg-paper/60 hover:text-ink">
                <IconPlus size={14} />팀 만들기
              </Link>
            </li>
          </ul>
          <Link href="/me" className="mt-auto flex items-center gap-2.5 rounded-sm px-3 py-2.5 text-[13px] font-semibold hover:bg-paper/60">
            {group ? <Avatar member={group.me} size={30} /> : <Skeleton className="size-[30px] rounded-full" />}
            <span className="min-w-0 flex-1 truncate">{group?.me.displayName ?? ""}</span>
            <span className="text-ink-2">설정</span>
          </Link>
        </aside>

        <div className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col lg:max-w-none">
          {/* 모바일 상단: 팀 이름 알약 / 새 소식 알약 + 내 프로필 (목업 .top) */}
          <header className="flex items-center justify-between px-4 pb-1 pt-[max(16px,env(safe-area-inset-top))] lg:hidden">
            <button
              type="button"
              onClick={() => setSwitcher(true)}
              aria-haspopup="dialog"
              className="glass-pill flex min-w-0 max-w-[60%] items-center gap-1.5 rounded-full px-3.5 py-[9px] text-[14px] font-bold"
            >
              {group ? (
                <>
                  <span className="truncate">{group.name}</span>
                  <IconChevronDown size={14} strokeWidth={2.4} className="shrink-0 opacity-50" />
                  <span className="sr-only">팀 바꾸기</span>
                </>
              ) : (
                <Skeleton className="h-4 w-16" />
              )}
            </button>
            <div className="flex items-center gap-2">
              <Link
                href={`/g/${groupId}/news`}
                aria-label={unread > 0 ? `새 소식 ${unread}개` : "새 소식"}
                className="glass-pill flex items-center gap-[5px] rounded-full px-3 py-[9px]"
              >
                <IconBell size={18} strokeWidth={2.2} />
                {unread > 0 && <b className="text-[13px] font-bold leading-none">{unread > 99 ? "99+" : unread}</b>}
              </Link>
              <Link href="/me" aria-label="내 정보" className="rounded-full">
                {group ? <Avatar member={group.me} size={36} /> : <Skeleton className="size-9 rounded-full" />}
              </Link>
            </div>
          </header>

          <main
            className={`flex-1 px-4 pb-[calc(64px+22px+32px+env(safe-area-inset-bottom))] lg:px-0 lg:pb-0 ${
              isCalendar ? "" : "lg:mx-auto lg:w-full lg:max-w-[760px] lg:px-8 lg:py-[26px]"
            }`}
          >
            {children}
          </main>
        </div>

        {/* 모바일 떠 있는 탭 + 추가 버튼 (목업 .dock) */}
        <div className="fixed inset-x-4 bottom-[calc(22px+env(safe-area-inset-bottom))] z-30 mx-auto flex max-w-[448px] items-center gap-2 lg:hidden">
          <nav aria-label="주요 화면" className="glass-dock h-16 flex-1 rounded-full">
            <ul className="flex h-full items-center justify-around">
              {TABS.map((t) => {
                const active = section === t.key || (t.key === "calendar" && section === "events");
                return (
                  <li key={t.key}>
                    <Link
                      href={`/g/${groupId}/${t.key}`}
                      aria-current={active ? "page" : undefined}
                      className={`flex min-w-[52px] flex-col items-center gap-[3px] rounded-sm py-1 text-[10.5px] font-bold ${active ? "text-ink" : "text-ink-2"}`}
                    >
                      <TabIcon name={t.key} active={active} />
                      {t.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
          <Link
            href={newHref}
            aria-label="일정 추가"
            className="grid size-16 shrink-0 place-items-center rounded-full bg-pri text-on-pri shadow-[var(--fab-shadow)]"
          >
            <IconPlus size={26} strokeWidth={2.2} />
          </Link>
        </div>
      </div>

      <Sheet open={switcher} onClose={() => setSwitcher(false)} title="내 팀">
        <ul className="flex flex-col gap-1">
          {(groups ?? []).map((g) => {
            const current = g.id === groupId;
            return (
              <li key={g.id}>
                <button
                  type="button"
                  onClick={() => switchTo(g.id)}
                  aria-current={current ? "true" : undefined}
                  className={`flex w-full items-center gap-3 rounded-[18px] px-4 py-3 text-left ${current ? "bg-surface" : "hover:bg-surface"}`}
                >
                  <span aria-hidden="true" className="size-3 shrink-0 rounded-[4px]" style={{ background: dots.get(g.id) }} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[16px] font-bold tracking-[-0.02em]">{g.name}</span>
                    <span className="t-sub block">{g.type === "PERSONAL" ? "나만 보는 달력" : `멤버 ${g.memberCount}명`}</span>
                  </span>
                  {g.unreadNewsCount > 0 && (
                    <span className="rounded-full bg-brand px-2 py-0.5 text-[11px] font-bold text-white">
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
          className="mt-4 flex h-[52px] items-center justify-center gap-1.5 rounded-full bg-btn text-[15px] font-bold text-on-btn"
        >
          <IconPlus size={18} />새 팀 만들기
        </Link>
      </Sheet>
    </Ctx.Provider>
  );
}
