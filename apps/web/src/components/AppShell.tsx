"use client";
// /g/[groupId]/* 공통 뼈대. 팀 정보를 컨텍스트로 내려준다
// 모양은 디자인토큰.md "2026-11 확정"(D-57), 폭 구간은 폴더블.md 3, 4-1 (D-58):
//   phone <600 : 머리줄 52(심볼 30 + 팀 이름 20/700 ⌄, 새 소식 종 + 아바타 32) + 유리 알약 독 64 + 코랄 원 64 (디자인규칙.md 2-1, 4-1, #212)
//   ≥600       : 왼쪽 사이드바 264 (components/Sidebar.tsx, 디자인규칙.md 2-2, 4-2, D-69). 독과 떠 있는 + 는 숨긴다.
//                본문 바깥 여백 28 32. D-58 의 레일(600~1199)과 PC 사이드바(≥1200)를 대신한다
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { messageOf, useGroup, useGroupGone, useGroups, type ApiFailure } from "@/hooks";
import { forgetGroup, rememberGroup } from "@/lib/group-cookie";
import { confirmLeave } from "@/lib/leave-guard";
import type { GroupDetail, GroupSummary } from "@/lib/types";
import { GroupGone } from "./GroupGone";
import { cycleColor } from "@/lib/colors";
import { kstToIso, todayKey } from "@/lib/date";
import { Symbol } from "./Logo";
import { IconBell, IconCalendar, IconChevronDown, IconFree, IconHeart, IconPlus, IconTeam } from "./icons";
import { Sidebar } from "./Sidebar";
import { Avatar, Sheet, Skeleton } from "./ui";
import { useLayout } from "@/lib/useLayout";

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
  { key: "calendar", label: "달력" },
  { key: "free", label: "빈 시간" },
  { key: "anniversaries", label: "기념일" },
  { key: "settings", label: "팀" },
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
    case "settings":
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
  const [eventsVersion, setEventsVersion] = useState(0);
  const eventsChanged = useCallback(() => setEventsVersion((v) => v + 1), []);
  const [fabAction, setFabAction] = useState<FabAction | null>(null);
  const value = useMemo<GroupCtx>(
    () => ({ groupId, groups, group, error, refresh, setGroup, clearUnread, openSwitcher, eventsChanged, setFabAction }),
    [groupId, groups, group, error, refresh, setGroup, clearUnread, openSwitcher, eventsChanged],
  );
  const wide = useLayout() !== "phone";

  const section = pathname.split("/")[3] ?? "calendar";
  const unread = groups?.find((g) => g.id === groupId)?.unreadNewsCount ?? 0;

  if (gone) return <GroupGone />;

  function switchTo(id: number) {
    setSwitcher(false);
    if (id === groupId) return;
    // 다가오는 일정 목록(#222)은 다른 팀에서도 같은 목록으로
    const tab = TABS.some((t) => t.key === section) || section === "upcoming" ? section : "calendar";
    // 일정 작성 중이면 입력을 버릴지 먼저 묻는다 (#137)
    confirmLeave(() => {
      rememberGroup(id);
      router.push(`/g/${id}/${tab}`);
    });
  }

  // + 버튼: 달력에서 고른 날(쿼리 date), 없으면 오늘 10:00~11:00
  const dateParam = searchParams.get("date");
  const baseDay = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : todayKey();
  const newHref = `/g/${groupId}/events/new?start=${encodeURIComponent(kstToIso(baseDay, "10:00"))}&end=${encodeURIComponent(kstToIso(baseDay, "11:00"))}`;
  const dots = teamDotColors(groups ?? []);
  const isCalendar = section === "calendar";
  // 일정 작성/수정 화면(/events/new, /events/<id>)은 저장 버튼이 주 동작이라 폰 독과 + 를 숨긴다 (#137)
  const isForm = section === "events";

  return (
    <Ctx.Provider value={value}>
      <div className="min-h-dvh fold:grid fold:grid-cols-[264px_minmax(0,1fr)]">
        <Sidebar
          groupId={groupId}
          group={group}
          section={section}
          unread={unread}
          enabled={wide}
          refreshKey={`${pathname}#${eventsVersion}`}
          onSwitchTeam={() => setSwitcher(true)}
        />

        <div className="flex min-h-dvh w-full flex-col">
          {/* 폰 머리줄 52 (디자인규칙.md 2-1): 심볼 30(달력으로) + 팀 이름 20/700 ⌄ / 새 소식 종(새 소식이 있을 때만 코랄 조각) + 아바타 32.
              글자 로고(워드마크)는 쓰지 않는다. 누르는 칸은 44 (#133) */}
          <header className="flex h-[calc(52px+env(safe-area-inset-top))] items-center pl-5 pr-3 pt-[env(safe-area-inset-top)] fold:hidden">
            <Link href={`/g/${groupId}/calendar`} aria-label="언제볼까 달력" className="mr-2 grid size-[30px] shrink-0 place-items-center rounded-sm">
              <Symbol size={30} />
            </Link>
            <button
              type="button"
              onClick={() => setSwitcher(true)}
              aria-haspopup="dialog"
              className="mr-auto flex h-11 min-w-0 max-w-[60%] items-center gap-1 rounded-sm text-[20px] font-bold leading-7 tracking-[-0.02em]"
            >
              {group ? (
                <>
                  <span className="truncate">{group.name}</span>
                  <IconChevronDown size={18} className="shrink-0 text-ink-2" />
                  <span className="sr-only">팀 바꾸기</span>
                </>
              ) : (
                <Skeleton className="h-5 w-20" />
              )}
            </button>
            <Link
              href={`/g/${groupId}/news`}
              aria-label={unread > 0 ? `새 소식 ${unread}개` : "새 소식"}
              className="group grid size-11 place-items-center text-ink"
            >
              <span className="grid size-9 place-items-center rounded-sm group-hover:bg-hover">
                <IconBell size={24} unread={unread > 0} />
              </span>
            </Link>
            <Link href="/me" aria-label="내 정보" className="grid size-11 place-items-center rounded-full">
              {group ? <Avatar member={group.me} color={group.me.color} size={32} /> : <Skeleton className="size-8 rounded-full" />}
            </Link>
          </header>

          <main
            // 넓은 화면 본문 바깥 여백 28 32 (디자인규칙.md 2-2). 달력은 남은 높이를 채우고, 다른 화면은 내용 폭 760 까지 사이드바 옆 같은 선에서
            className={`flex-1 px-5 ${isForm ? "pb-[calc(24px+env(safe-area-inset-bottom))]" : "pb-[calc(64px+16px+24px+env(safe-area-inset-bottom))]"} fold:px-8 fold:py-7 ${
              isCalendar ? "" : "fold:w-full fold:max-w-[824px]"
            }`}
          >
            {children}
          </main>
        </div>

        {/* 모바일 떠 있는 유리 알약 탭 + 코랄 원 추가 버튼 (#126: 사용자 선호로 #111 의 평평한 바 대신 복원) */}
        <div className={`fixed inset-x-4 bottom-[calc(16px+env(safe-area-inset-bottom))] z-30 items-center gap-2 fold:hidden ${isForm ? "hidden" : "flex"}`}>
          {/* 선택된 메뉴만 먹색 칩(높이 44, 모서리 22) + 아이콘 + 이름 14/700, 나머지는 아이콘만 (디자인규칙.md 4-1).
              칩은 폭과 면이 200ms 로 옮겨 간다 (prefers-reduced-motion 이면 globals.css 가 즉시로) */}
          <nav aria-label="주요 화면" className="glass-dock h-16 min-w-0 flex-1 rounded-full px-2">
            <ul className="flex h-full items-center justify-between">
              {TABS.map((t) => {
                // 다가오는 일정 목록(#222)은 달력에 딸린 화면이라 달력 칩을 켠다
                const active = section === t.key || (t.key === "calendar" && (section === "events" || section === "upcoming"));
                return (
                  <li key={t.key} className="flex h-full items-center">
                    <Link
                      href={`/g/${groupId}/${t.key}`}
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
