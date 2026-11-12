"use client";
// 팀 안 화면(/calendar, /upcoming, /free, /anniversaries, /todos/*, /news, /team, /events/*) 공통 뼈대. 팀 정보를 컨텍스트로 내려준다
// (#311, D-196) 주소에 팀이 없다. 지금 보는 팀은 여기 상태 + 쿠키 wwm_group: 처음 값은 (team) 레이아웃이 쿠키(없으면 서버가 고른 팀)로 넘기고,
//   `?team=<팀 공개 코드>` 가 있으면 내 팀 목록에서 찾아 바꾼 뒤 주소에서 뗀다 (알림, 위젯, 공유, 내 정보의 팀 목록).
//   팀을 바꾸면 같은 화면에 그대로 두고(일정 화면만 달력으로) 자식 화면을 다시 마운트한다 (key)
// 모양은 디자인토큰.md "2026-11 확정"(D-57), 폭 구간은 폴더블.md 3, 4-1 (D-58):
//   phone <600 : 머리줄 52(심볼 30 + 팀 이름 20/700 ⌄, 새 소식 종 + 아바타 32) + 유리 알약 독 64 + 코랄 원 64 (디자인규칙.md 2-1, 4-1, #212)
//   ≥600       : 왼쪽 사이드바 264 (components/Sidebar.tsx, 디자인규칙.md 2-2, 4-2, D-69). 독과 떠 있는 + 는 숨긴다.
//                본문 바깥 여백 28 32. D-58 의 레일(600~1199)과 PC 사이드바(≥1200)를 대신한다
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { createContext, Fragment, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { messageOf, useGroup, useGroupGone, useGroups, type ApiFailure } from "@/hooks";
import { forgetGroup, readGroupCookie, rememberGroup } from "@/lib/group-cookie";
import { confirmLeave } from "@/lib/leave-guard";
import { activeTab, afterTeamSwitch, ANNIVERSARIES_PATH, CALENDAR_PATH, FREE_PATH, NEWS_PATH, newEventHref, parsePublicCode, routeInfo, stripTeam, TEAM_PARAM, TEAM_PATH } from "@/lib/routes";
import { pickStartGroupId } from "@/lib/start-calendar";
import type { GroupDetail, GroupSummary } from "@/lib/types";
import { GroupGone } from "./GroupGone";
import { cycleColor } from "@/lib/colors";
import { kstToIso, todayKey } from "@/lib/date";
import { Symbol } from "./Logo";
import { IconBell, IconCalendar, IconChevronDown, IconFree, IconHeart, IconPlus, IconTeam } from "./icons";
import { Sidebar } from "./Sidebar";
import { Avatar, Sheet, Skeleton } from "./ui";
import { useLayout } from "@/lib/useLayout";
import { useSidebarFold } from "@/lib/useSidebarFold";
import { SIDEBAR_EXPANDED_W, SIDEBAR_RAIL_W } from "@/lib/sidebar-fold";
import { usePushSync } from "@/lib/usePushSync";
import { useWidgetSync } from "@/lib/useWidgetSync";
import { maybeOpenPushPrompt } from "@/lib/push";

type GroupCtx = {
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
  /** 화면별 + 동작 (#170). 화면이 정하면 폰 + 가 일정 추가 대신 이것을 부른다. null 이면 일정 추가 */
  setFabAction: (a: FabAction | null) => void;
};

export type FabAction = { label: string; run: () => void };

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
  { key: "calendar", label: "달력", href: CALENDAR_PATH },
  { key: "free", label: "빈 시간", href: FREE_PATH },
  { key: "anniversaries", label: "기념일", href: ANNIVERSARIES_PATH },
  { key: "team", label: "팀", href: TEAM_PATH },
] as const;

/** 독 아이콘: 선택 칩 안은 24, 아이콘만 있는 항목은 26 (디자인규칙.md 3-1, 4-1). 선택이면 겹침 조각만 코랄 */
function TabIcon({ name, active }: { name: (typeof TABS)[number]["key"]; active: boolean }) {
  const size = active ? 24 : 26;
  switch (name) {
    case "calendar":
      return <IconCalendar size={size} active={active} />;
    case "free":
      return <IconFree size={size} active={active} />;
    case "anniversaries":
      return <IconHeart size={size} active={active} />;
    case "team":
      return <IconTeam size={size} active={active} />;
  }
}

/** 사이드바 팀 점 색: 개인 달력은 먹색, 팀은 목록 순서대로 멤버 색 순환 (목업 PC) */
function teamDotColors(groups: GroupSummary[]): Map<number, string> {
  const map = new Map<number, string>();
  let i = 0;
  for (const g of groups) map.set(g.id, g.type === "PERSONAL" ? "var(--ink)" : cycleColor(i++));
  return map;
}

/** `?team=` 코드 → 내 팀. 목록에 없으면 null (멤버가 아니거나 없는 팀) */
export function resolveTeamParam(groups: readonly Pick<GroupSummary, "id" | "publicCode">[], code: string): number | null {
  return groups.find((g) => g.publicCode === code)?.id ?? null;
}

type Props = {
  /** (team) 레이아웃이 쿠키(없으면 서버가 고른 팀)로 넘긴 처음 팀. null 이면 목록을 받아 여기서 고른다 */
  initialGroupId: number | null;
  /** 레이아웃이 팀을 고르느라 이미 받은 목록. 있으면 스켈레톤 없이 시작한다 */
  initialGroups?: GroupSummary[] | null;
  children: React.ReactNode;
};

export function AppShell({ initialGroupId, initialGroups = null, children }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
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
  const [switcher, setSwitcher] = useState(false);
  // (#188) 푸시 지원 앱이면 이 기기 토큰을 등록, 정리 (처음 그릴 때와 앱이 앞으로 올 때)
  usePushSync();
  // (#197) 홈 화면 위젯 스냅샷 (위젯을 아는 앱 셸에서만)
  useWidgetSync();
  // (#291) 앱을 열면 알림 안내를 띄운다. 첫 화면이 그려진 뒤 잠깐 두고 묻는다 (웹, 1.0.x 앱, 이미 답한 기기는 아무것도 안 함)
  useEffect(() => {
    const t = window.setTimeout(() => void maybeOpenPushPrompt(), 800);
    return () => window.clearTimeout(t);
  }, []);

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
  const gone = goneByEvent || teamGone || detailGone || isGone(groupsError);
  useEffect(() => {
    if (gone) forgetGroup();
  }, [gone]);

  const group = groupQ.data;
  useEffect(() => {
    if (group && group.id === groupId) rememberGroup(groupId);
  }, [group, groupId]);

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
  const [eventsVersion, setEventsVersion] = useState(0);
  const eventsChanged = useCallback(() => setEventsVersion((v) => v + 1), []);
  // 화면별 + 동작은 건 팀과 함께 둔다. 팀이 바뀌면 자식 화면이 다시 마운트되며 다시 걸고, 그 전까지는 일정 추가
  const [fab, setFab] = useState<{ groupId: number | null; action: FabAction | null }>({ groupId: null, action: null });
  const setFabAction = useCallback((action: FabAction | null) => setFab({ groupId, action }), [groupId]);
  const fabAction = fab.groupId === groupId ? fab.action : null;
  const value = useMemo<GroupCtx | null>(
    () =>
      groupId === null
        ? null
        : { groupId, groups, group: group && group.id === groupId ? group : null, error, refresh, setGroup, clearUnread, openSwitcher, setGroupId, eventsChanged, setFabAction },
    [groupId, groups, group, error, refresh, setGroup, clearUnread, openSwitcher, setGroupId, eventsChanged, setFabAction],
  );
  const wide = useLayout() !== "phone";
  // (#315) 사이드바 접기. 처음 그린 뒤에만 너비 전환을 켠다 (저장값을 읽어 첫 화면이 바로 접힌 폭이 될 때 애니메이션이 보이지 않게)
  const fold = useSidebarFold();
  const [animate, setAnimate] = useState(false);
  useEffect(() => {
    const id = window.requestAnimationFrame(() => setAnimate(true));
    return () => window.cancelAnimationFrame(id);
  }, []);

  const tab = activeTab(pathname);
  const info = routeInfo(pathname);
  const unread = groups?.find((g) => g.id === groupId)?.unreadNewsCount ?? 0;

  if (gone) return <GroupGone />;

  function switchTo(id: number) {
    setSwitcher(false);
    if (id === groupId) return;
    // 일정 작성 중이면 입력을 버릴지 먼저 묻는다 (#137)
    confirmLeave(() => {
      // (#311) 같은 화면에 그대로. 다른 팀의 일정을 가리키는 주소(/events/<코드>)만 달력으로
      const to = afterTeamSwitch(pathname);
      setGroupId(id);
      if (to !== null) router.push(to);
    });
  }

  // + 버튼: 달력에서 고른 날(쿼리 date), 없으면 오늘 10:00~11:00
  const dateParam = searchParams.get("date");
  const baseDay = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : todayKey();
  const newHref = newEventHref({ start: kstToIso(baseDay, "10:00"), end: kstToIso(baseDay, "11:00") });
  const dots = teamDotColors(groups ?? []);
  const isCalendar = tab === "calendar";
  // 일정 작성/수정 화면(/events/new, /events/<코드>/edit)은 저장 버튼이 주 동작이라 폰 독과 + 를 숨긴다 (#137). 일정 가져오기(#279)도 같다.
  // (#276) 할 일 목록 상세(/todos/<코드>)도 맨 아래 입력줄이 주 동작이라 독과 + 를 숨긴다 (D-209)
  const isForm = info.form || info.todoCode !== null;
  const shownGroup = group && group.id === groupId ? group : null;

  return (
    <Ctx.Provider value={value}>
      {/* 사이드바 폭 264, 접으면 72 (#315). 열 너비를 200ms 로 옮긴다 (prefers-reduced-motion 이면 globals.css 가 즉시로) */}
      <div
        className={`min-h-dvh fold:grid fold:grid-cols-[var(--side-w)_minmax(0,1fr)] ${animate ? "transition-[grid-template-columns] duration-200 ease-out" : ""}`}
        style={{ "--side-w": `${fold.collapsed ? SIDEBAR_RAIL_W : SIDEBAR_EXPANDED_W}px` } as React.CSSProperties}
        data-sidebar={fold.collapsed ? "collapsed" : "expanded"}
      >
        <Sidebar
          groupId={groupId}
          group={shownGroup}
          tab={tab}
          unread={unread}
          enabled={wide && groupId !== null && !fold.collapsed}
          refreshKey={`${tab ?? ""}#${eventsVersion}`}
          onSwitchTeam={() => setSwitcher(true)}
          collapsed={fold.collapsed}
          onToggle={fold.toggle}
        />

        <div className="flex min-h-dvh w-full flex-col">
          {/* 폰 머리줄 52 (디자인규칙.md 2-1): 심볼 30(달력으로) + 팀 이름 20/700 ⌄ / 새 소식 종(새 소식이 있을 때만 코랄 조각) + 아바타 32.
              글자 로고(워드마크)는 쓰지 않는다. 누르는 칸은 44 (#133, 심볼은 hit 로 44 QA3-L3) */}
          <header className="flex h-[calc(52px+env(safe-area-inset-top))] items-center pl-5 pr-3 pt-[env(safe-area-inset-top)] fold:hidden">
            <Link href={CALENDAR_PATH} aria-label="언제볼까 달력" className="hit mr-2 grid size-[30px] shrink-0 place-items-center rounded-sm">
              <Symbol size={30} />
            </Link>
            <button
              type="button"
              onClick={() => setSwitcher(true)}
              aria-haspopup="dialog"
              className="mr-auto flex h-11 min-w-0 max-w-[60%] items-center gap-1 rounded-sm text-[20px] font-bold leading-7 tracking-[-0.02em]"
            >
              {shownGroup ? (
                <>
                  <span className="truncate">{shownGroup.name}</span>
                  <IconChevronDown size={18} className="shrink-0 text-ink-2" />
                  <span className="sr-only">팀 바꾸기</span>
                </>
              ) : (
                <Skeleton className="h-5 w-20" />
              )}
            </button>
            <Link
              href={NEWS_PATH}
              aria-label={unread > 0 ? `새 소식 ${unread}개` : "새 소식"}
              className="group grid size-11 place-items-center text-ink"
            >
              <span className="grid size-9 place-items-center rounded-sm group-hover:bg-hover">
                <IconBell size={24} unread={unread > 0} />
              </span>
            </Link>
            <Link href="/me" aria-label="내 정보" className="grid size-11 place-items-center rounded-full">
              {shownGroup ? <Avatar member={shownGroup.me} color={shownGroup.me.color} size={32} /> : <Skeleton className="size-8 rounded-full" />}
            </Link>
          </header>

          <main
            // 넓은 화면 본문 바깥 여백 28 32 (디자인규칙.md 2-2). 달력은 남은 높이를 채우고, 다른 화면도 본문 폭을 다 쓴다.
            // 폭 상한(예전 760)은 두지 않고 본문 폭이 넉넉하면 화면마다 2단, 격자로 나눈다 (#244, D-100).
            // (#323) 그 판단은 뷰포트(lg)가 아니라 이 본문의 폭으로 한다: 컨테이너 main(안쪽 폭 = 본문 폭) + globals.css main-* 변형.
            // 사이드바를 72 레일로 접든 264 로 펼치든 화면이 실제로 받은 폭으로 1단/2단을 고른다
            className={`@container/main min-w-0 flex-1 px-5 ${isForm ? "pb-[calc(24px+env(safe-area-inset-bottom))]" : "pb-[calc(64px+16px+24px+env(safe-area-inset-bottom))]"} fold:px-8 fold:py-7 ${
              isCalendar ? "" : "fold:w-full fold:min-w-0"
            }`}
          >
            {/* 팀이 정해진 뒤에만 자식 화면. 팀이 바뀌면 key 로 다시 마운트해 화면 상태(폼 입력, 선택 날짜)를 새 팀 기준으로 시작한다 */}
            {value !== null && !resolvingTeam ? (
              <Fragment key={groupId}>{children}</Fragment>
            ) : (
              <div className="space-y-3 pt-1" aria-busy="true" aria-label="불러오는 중">
                <Skeleton className="h-8 w-40" />
                <Skeleton className="h-[320px] w-full rounded-xl" />
              </div>
            )}
          </main>
        </div>

        {/* 모바일 떠 있는 유리 알약 탭 + 코랄 원 추가 버튼 (#126: 사용자 선호로 #111 의 평평한 바 대신 복원) */}
        <div className={`fixed inset-x-4 bottom-[calc(16px+env(safe-area-inset-bottom))] z-30 items-center gap-2 fold:hidden ${isForm ? "hidden" : "flex"}`}>
          {/* 선택된 메뉴만 먹색 칩(높이 44, 모서리 22) + 아이콘 + 이름 14/700, 나머지는 아이콘만 (디자인규칙.md 4-1).
              칩은 폭과 면이 200ms 로 옮겨 간다 (prefers-reduced-motion 이면 globals.css 가 즉시로) */}
          <nav aria-label="주요 화면" className="glass-dock h-16 min-w-0 flex-1 rounded-full px-2">
            <ul className="flex h-full items-center justify-between">
              {TABS.map((t) => {
                // 다가오는 일정 목록(#222)과 일정 화면은 달력에 딸린 화면이라 달력 칩을 켠다
                const active = tab === t.key || (t.key === "calendar" && tab === "upcoming");
                return (
                  <li key={t.key} className="flex h-full items-center">
                    <Link
                      href={t.href}
                      aria-current={active ? "page" : undefined}
                      aria-label={active ? undefined : t.label}
                      className="grid h-full min-w-12 place-items-center"
                    >
                      <span
                        className={`flex h-11 items-center justify-center rounded-[22px] transition-[background-color,color,padding] duration-200 ease-out ${
                          active ? "bg-ink pl-3 pr-4 text-on-ink" : "px-0 text-ink-2"
                        }`}
                      >
                        <TabIcon name={t.key} active={active} />
                        <span
                          className={`overflow-hidden whitespace-nowrap text-[14px] font-bold leading-5 transition-[max-width,opacity,margin] duration-200 ease-out ${
                            active ? "ml-1.5 max-w-16 opacity-100" : "ml-0 max-w-0 opacity-0"
                          }`}
                          aria-hidden={active ? undefined : true}
                        >
                          {t.label}
                        </span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
          {/* 화면이 + 동작을 정했으면(기념일 화면은 기념일 추가) 그것, 아니면 일정 추가 (#170) */}
          {fabAction ? (
            <button
              type="button"
              onClick={fabAction.run}
              aria-label={fabAction.label}
              className="grid size-16 shrink-0 place-items-center rounded-full bg-pri text-on-pri shadow-[var(--fab-shadow)]"
            >
              <IconPlus size={26} strokeWidth={2.2} />
            </button>
          ) : (
            <Link
              href={newHref}
              aria-label="일정 추가"
              className="grid size-16 shrink-0 place-items-center rounded-full bg-pri text-on-pri shadow-[var(--fab-shadow)]"
            >
              <IconPlus size={26} strokeWidth={2.2} />
            </Link>
          )}
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

/**
 * (#311) 주소가 가리키는 팀이 따로 있는 화면(`/events/<코드>`, `/events/<코드>/edit`, `copy=`)에서 그 팀으로 맞춘다.
 * 쿠키 팀과 다르면 바꾸고(쿠키 갱신), 맞을 때만 자식을 그린다 (다른 팀 데이터가 잠깐 비치지 않게)
 */
export function TeamScope({ groupId, children }: { groupId: number; children: React.ReactNode }) {
  const { groupId: current, setGroupId } = useGroupContext();
  useEffect(() => {
    if (current !== groupId) setGroupId(groupId);
  }, [current, groupId, setGroupId]);
  return current === groupId ? <>{children}</> : null;
}
