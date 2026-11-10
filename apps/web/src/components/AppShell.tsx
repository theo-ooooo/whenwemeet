"use client";
// /g/[groupId]/* 공통 뼈대. 팀 정보를 컨텍스트로 내려준다
// 모양은 디자인토큰.md "2026-11 확정"(D-57), 폭 구간은 폴더블.md 3, 4-1 (D-58):
//   phone <600 : 상단 바 52(팀 전환, 새 소식, 내 프로필) + 바닥에 붙은 평평한 탭 56 + safe-area, + 는 탭 위 오른쪽 52 원
//   600~1199   : 왼쪽 레일 64(심볼, + , 달력/빈 시간/기념일/새 소식/팀, 내 프로필). 탭과 떠 있는 + 는 숨긴다
//   ≥1200      : PC 사이드바 220
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
import { IconArrowRight, IconBell, IconCalendar, IconChevronDown, IconClock, IconHeart, IconPlus, IconTeam } from "./icons";
import { Avatar, Sheet, Skeleton } from "./ui";

type GroupCtx = {
  groupId: number;
  groups: GroupSummary[] | null;
  group: GroupDetail | null;
  error: string | null;
  refresh: () => Promise<void>;
  setGroup: (g: GroupDetail) => void;
  clearUnread: () => void;
  /** 팀 전환 시트 열기 (레일 폭에서 달력 월 헤더의 팀 이름이 쓴다) */
  openSwitcher: () => void;
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

  const openSwitcher = useCallback(() => setSwitcher(true), []);
  const value = useMemo<GroupCtx>(
    () => ({ groupId, groups, group, error, refresh, setGroup, clearUnread, openSwitcher }),
    [groupId, groups, group, error, refresh, setGroup, clearUnread, openSwitcher],
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
    {
      href: `/g/${groupId}/calendar`,
      label: "달력",
      short: "달력",
      icon: <IconCalendar size={18} />,
      railIcon: <IconCalendar size={20} active={section === "calendar" || section === "events"} />,
      on: section === "calendar" || section === "events",
    },
    { href: `/g/${groupId}/free`, label: "빈 시간 찾기", short: "빈 시간", icon: <IconClock size={18} />, railIcon: <IconClock size={20} />, on: section === "free" },
    { href: `/g/${groupId}/anniversaries`, label: "기념일", short: "기념일", icon: <IconHeart size={18} />, railIcon: <IconHeart size={20} />, on: section === "anniversaries" },
    { href: `/g/${groupId}/news`, label: "새 소식", short: "새 소식", icon: <IconBell size={18} />, railIcon: <IconBell size={20} />, on: section === "news", badge: unread },
    { href: `/g/${groupId}/settings`, label: "팀 설정", short: "팀", icon: <IconTeam size={18} />, railIcon: <IconTeam size={20} />, on: section === "settings" },
  ];

  return (
    <Ctx.Provider value={value}>
      <div className="min-h-dvh fold:grid fold:grid-cols-[64px_minmax(0,1fr)] wide:grid-cols-[220px_minmax(0,1fr)]">
        {/* 레일 600~1199 (폴더블.md 4-1, 시안 final-a-wide-day) */}
        <aside className="sticky top-0 hidden h-dvh flex-col items-center gap-1 overflow-y-auto py-3 fold:flex wide:hidden">
          <Link href={`/g/${groupId}/calendar`} aria-label="언제볼까 달력" className="grid size-10 place-items-center rounded-sm">
            <Symbol size={24} />
          </Link>
          <Link
            href={newHref}
            aria-label="일정 추가"
            className="mb-2 mt-1 grid size-12 place-items-center rounded-md bg-pri text-on-pri shadow-[var(--fab-shadow)] hover:brightness-95"
          >
            <IconPlus size={24} strokeWidth={2.2} />
          </Link>
          <nav aria-label="주요 화면">
            <ul className="flex flex-col gap-1">
              {menu.map((it) => (
                <li key={it.label}>
                  <Link
                    href={it.href}
                    aria-current={it.on ? "page" : undefined}
                    aria-label={it.badge ? `${it.label}, 새 소식 ${it.badge}개` : undefined}
                    className="group flex w-14 flex-col items-center gap-0.5 rounded-sm py-1 text-[10.5px] font-semibold leading-3"
                  >
                    <span
                      className={`relative grid h-8 w-[52px] place-items-center rounded-md ${it.on ? "bg-paper text-ink" : "text-ink-2 group-hover:bg-hover group-hover:text-ink"}`}
                    >
                      {it.railIcon}
                      {it.badge ? <i aria-hidden="true" className="absolute right-3 top-1 block size-1.5 rounded-full bg-pri" /> : null}
                    </span>
                    <span className={it.on ? "text-ink" : "text-ink-2"}>{it.short}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <Link href="/me" aria-label="내 정보" className="mt-auto grid size-10 place-items-center rounded-full">
            {group ? <Avatar member={group.me} size={32} /> : <Skeleton className="size-8 rounded-full" />}
          </Link>
        </aside>

        {/* PC 사이드바 ≥1200 (목업 .side) */}
        <aside className="sticky top-0 hidden h-dvh flex-col gap-0.5 overflow-y-auto border-r border-line bg-paper px-3 py-3.5 wide:flex">
          <Link href={`/g/${groupId}/calendar`} className="flex items-center gap-2 rounded-sm px-2 pb-3.5 pt-1 text-[16px] font-bold leading-6">
            <Symbol size={24} />
            언제볼까
          </Link>
          <nav aria-label="주요 화면" className="flex flex-col gap-0.5">
            {menu.map((it) => (
              <Link
                key={it.label}
                href={it.href}
                aria-current={it.on ? "page" : undefined}
                className={`flex h-10 items-center gap-2.5 rounded-sm px-3 text-[14px] font-bold ${it.on ? "bg-hover" : "hover:bg-hover"}`}
              >
                {it.icon}
                {it.label}
                {it.badge ? (
                  <span className="ml-auto text-[11px] font-bold text-acc-ink">
                    <span className="sr-only">새 소식 </span>
                    {it.badge > 99 ? "99+" : it.badge}
                  </span>
                ) : null}
              </Link>
            ))}
          </nav>
          <h2 className="px-3 pb-1 pt-3.5 text-[11px] font-semibold text-ink-2">내 팀</h2>
          <ul className="flex flex-col gap-0.5">
            {groups
              ? groups.map((g) => {
                  const current = g.id === groupId;
                  return (
                    <li key={g.id}>
                      <button
                        type="button"
                        onClick={() => switchTo(g.id)}
                        aria-current={current ? "true" : undefined}
                        className={`flex h-10 w-full items-center gap-2.5 rounded-sm px-3 text-left text-[14px] font-bold ${current ? "bg-hover" : "hover:bg-hover"}`}
                      >
                        <span aria-hidden="true" className="size-2 shrink-0 rounded-[3px]" style={{ background: dots.get(g.id) }} />
                        <span className="min-w-0 flex-1 truncate">{g.name}</span>
                        {!current && g.unreadNewsCount > 0 && (
                          <span className="text-[11px] font-bold text-acc-ink">
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
              <Link href="/groups/new" className="flex h-10 items-center gap-2.5 rounded-sm px-3 text-[14px] font-semibold text-ink-2 hover:bg-hover hover:text-ink">
                <IconPlus size={14} />팀 만들기
              </Link>
            </li>
            <li>
              <Link href="/join" className="flex h-10 items-center gap-2.5 rounded-sm px-3 text-[14px] font-semibold text-ink-2 hover:bg-hover hover:text-ink">
                <IconArrowRight size={14} />초대 코드로 합류
              </Link>
            </li>
          </ul>
          <Link href="/me" className="mt-auto flex h-11 items-center gap-2 rounded-sm px-2 text-[13px] font-semibold hover:bg-hover">
            {group ? <Avatar member={group.me} size={28} /> : <Skeleton className="size-7 rounded-full" />}
            <span className="min-w-0 flex-1 truncate">{group?.me.displayName ?? ""}</span>
            <span className="text-[12px] font-normal text-ink-2">설정</span>
          </Link>
        </aside>

        <div className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col fold:max-w-none">
          {/* 레일 폭 상단 줄: 팀 이름 알약만 (새 소식, 프로필은 레일). 달력은 월 헤더 안에 팀 이름을 둔다 */}
          {!isCalendar && (
            <header className="hidden h-12 items-center px-6 pt-1 fold:flex wide:hidden">
              <button type="button" onClick={() => setSwitcher(true)} aria-haspopup="dialog" className="flex h-9 min-w-0 max-w-[60%] items-center gap-1 rounded-sm text-[16px] font-bold leading-6">
                {group ? (
                  <>
                    <span className="truncate">{group.name}</span>
                    <IconChevronDown size={16} className="shrink-0 text-ink-2" />
                    <span className="sr-only">팀 바꾸기</span>
                  </>
                ) : (
                  <Skeleton className="h-4 w-16" />
                )}
              </button>
            </header>
          )}
          {/* 폰 상단 바 52: 팀 이름 글자 / 새 소식(점 배지) + 내 프로필 (시안 .top) */}
          <header className="flex h-[calc(52px+env(safe-area-inset-top))] items-center gap-0.5 pl-4 pr-3 pt-[env(safe-area-inset-top)] fold:hidden">
            <button
              type="button"
              onClick={() => setSwitcher(true)}
              aria-haspopup="dialog"
              className="mr-auto flex h-9 min-w-0 max-w-[60%] items-center gap-1 rounded-sm text-[16px] font-bold leading-6"
            >
              {group ? (
                <>
                  <span className="truncate">{group.name}</span>
                  <IconChevronDown size={16} className="shrink-0 text-ink-2" />
                  <span className="sr-only">팀 바꾸기</span>
                </>
              ) : (
                <Skeleton className="h-4 w-16" />
              )}
            </button>
            <Link
              href={`/g/${groupId}/news`}
              aria-label={unread > 0 ? `새 소식 ${unread}개` : "새 소식"}
              className="relative grid size-8 place-items-center rounded-sm text-ink hover:bg-hover"
            >
              <IconBell size={18} />
              {unread > 0 && <i aria-hidden="true" className="absolute right-1.5 top-1.5 block size-1.5 rounded-full bg-pri" />}
            </Link>
            <Link href="/me" aria-label="내 정보" className="grid size-8 place-items-center rounded-full">
              {group ? <Avatar member={group.me} size={28} /> : <Skeleton className="size-7 rounded-full" />}
            </Link>
          </header>

          <main
            className={`flex-1 px-4 pb-[calc(56px+72px+env(safe-area-inset-bottom))] fold:px-0 fold:pb-0 ${
              isCalendar ? "" : "fold:mx-auto fold:w-full fold:max-w-[640px] fold:px-6 fold:pb-6 lg:max-w-[720px] lg:px-8 wide:py-6"
            }`}
          >
            {children}
          </main>
        </div>

        {/* 모바일 하단 탭: 바닥에 붙은 평평한 바 56 + safe-area, 위 1px 선. + 는 탭 위 오른쪽 52 원 (시안 .tab, .fab) */}
        <Link
          href={newHref}
          aria-label="일정 추가"
          className="fixed bottom-[calc(56px+14px+env(safe-area-inset-bottom))] right-[max(16px,calc(50%-224px))] z-30 grid size-[52px] place-items-center rounded-full bg-pri text-on-pri shadow-[var(--fab-shadow)] fold:hidden"
        >
          <IconPlus size={24} strokeWidth={2.2} />
        </Link>
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-paper pb-[env(safe-area-inset-bottom)] fold:hidden">
          <nav aria-label="주요 화면" className="mx-auto h-14 max-w-[480px]">
            <ul className="flex h-full items-center justify-around">
              {TABS.map((t) => {
                const active = section === t.key || (t.key === "calendar" && section === "events");
                return (
                  <li key={t.key}>
                    <Link
                      href={`/g/${groupId}/${t.key}`}
                      aria-current={active ? "page" : undefined}
                      className={`flex w-[60px] flex-col items-center gap-0.5 rounded-sm py-1 text-[10px] font-semibold leading-3 ${active ? "text-ink" : "text-ink-2"}`}
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
                  className={`flex min-h-11 w-full items-center gap-2.5 rounded-sm px-3 py-1 text-left ${current ? "bg-hover" : "hover:bg-hover"}`}
                >
                  <span aria-hidden="true" className="size-2 shrink-0 rounded-[3px]" style={{ background: dots.get(g.id) }} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-semibold leading-5">{g.name}</span>
                    <span className="t-sub block">{g.type === "PERSONAL" ? "나만 보는 달력" : `멤버 ${g.memberCount}명`}</span>
                  </span>
                  {g.unreadNewsCount > 0 && (
                    <span className="text-[12px] font-bold text-acc-ink">
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
          className="mt-3 flex h-11 items-center justify-center gap-1.5 rounded-md bg-btn text-[13.5px] font-bold text-on-btn"
        >
          <IconPlus size={16} strokeWidth={2.2} />새 팀 만들기
        </Link>
        {/* 링크 없이 6자리 코드만 받은 경우 (#56) */}
        <Link
          href="/join"
          onClick={() => setSwitcher(false)}
          className="mt-2 flex h-11 items-center justify-center rounded-md bg-hover text-[13.5px] font-bold text-ink hover:brightness-95"
        >
          초대 코드로 합류
        </Link>
      </Sheet>
    </Ctx.Provider>
  );
}
