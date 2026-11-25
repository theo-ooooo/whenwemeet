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
import { Fragment, useCallback, useEffect, useState } from "react";
import { confirmLeave } from "@/lib/leave-guard";
import { activeTab, afterTeamSwitch, CALENDAR_PATH, navTab, NEWS_PATH, SEARCH_PATH, newEventHref, pollCodeOf, routeInfo } from "@/lib/routes";
import type { GroupSummary } from "@/lib/types";
import { GroupGone } from "./GroupGone";
import { GroupHiddenModal } from "./GroupHiddenModal";
import { NoticePopup } from "./NoticePopup";
import { AppUpdateBanner, AppUpdateRequired, useAppUpdate } from "./AppUpdatePrompt";
import { pickStartGroupId } from "@/lib/start-calendar";
import { cycleColor } from "@/lib/colors";
import { kstToIso, todayKey } from "@/lib/date";
import { Symbol } from "./Logo";
import { AvatarDot, IconBell, IconChevronDown, IconPlus, IconSearch } from "./icons";
import { useMe } from "@/hooks";
import { AssistantProvider } from "./AssistantProvider";
import { AssistantPill } from "./AssistantPill";
import { DockTabs } from "./PhoneDock";
import { Sidebar } from "./Sidebar";
import { Avatar, Sheet, Skeleton } from "./ui";
import { SIDEBAR_EXPANDED_W, SIDEBAR_RAIL_W } from "@/lib/sidebar-fold";
import { Ctx, useGroupContext } from "./app-shell/context";
import { useCurrentGroup } from "./app-shell/useCurrentGroup";
import { useGroupContextValue } from "./app-shell/useGroupContextValue";
import { usePendingNav } from "./app-shell/usePendingNav";
import { useShellAppEffects } from "./app-shell/useShellAppEffects";
import { useShellSidebar } from "./app-shell/useShellSidebar";
import { useTeamSelection } from "./app-shell/useTeamSelection";

// (#490) 컨텍스트와 `?team=` 풀이는 app-shell/ 로 옮겼다. 바깥은 지금처럼 이 파일에서 가져다 쓴다
export { useGroupContext, type FabAction } from "./app-shell/context";
export { resolveTeamParam } from "./app-shell/useTeamSelection";

/** 사이드바 팀 점 색: 개인 달력은 먹색, 팀은 목록 순서대로 멤버 색 순환 (목업 PC) */
function teamDotColors(groups: GroupSummary[]): Map<number, string> {
  const map = new Map<number, string>();
  let i = 0;
  for (const g of groups) map.set(g.id, g.type === "PERSONAL" ? "var(--ink)" : cycleColor(i++));
  return map;
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
  const { groupId, setGroupId, setGroupIdState, groupsQ, groupQ, goneByEvent } = useCurrentGroup(initialGroupId, initialGroups);
  const [switcher, setSwitcher] = useState(false);
  const openSwitcher = useCallback(() => setSwitcher(true), []);
  useShellAppEffects();
  const { pendingNav, onMenuNavigate } = usePendingNav();

  const groups = groupsQ.data;
  const { gone, resolvingTeam, error, hidden } = useTeamSelection({ initialGroupId, groupId, setGroupId, setGroupIdState, groupsQ, groupQ, goneByEvent, searchParams, router });
  const group = groupQ.data;
  const { value, eventsVersion, fabAction } = useGroupContextValue({ groupId, groupsQ, groupQ, error, setGroupId, openSwitcher });
  const { wide, fold, animate } = useShellSidebar();

  const tab = activeTab(pathname);
  const menuTab = navTab(pathname, pendingNav);
  const info = routeInfo(pathname);
  const unread = groups?.find((g) => g.id === groupId)?.unreadNewsCount ?? 0;
  // (#515) 안 본 공지가 있으면 내 정보(아바타)에 코랄 점 (D-285). /notices 는 이 뼈대 밖이라 돌아오면 다시 받는다
  const noticeDot = useMe().data?.hasUnreadNotice === true;
  // (#539) 앱 셸이면 기종의 최신, 최소 버전과 비교 (웹 브라우저는 status null)
  const appUpdate = useAppUpdate();
  const updateRequired = appUpdate.status === "required";

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

  /**
   * (#515) 숨긴 팀에서 다른 팀 열기. 숨기지 않은 팀 중 팀이 사라졌을 때와 같은 규칙(개인 달력 먼저)으로 고르고,
   * 열 팀이 없으면 팀이 하나도 없을 때처럼 새 팀 만들기로
   */
  function openOtherTeam() {
    const next = pickStartGroupId((groups ?? []).filter((g) => !g.hidden), null, null);
    if (next === null) router.replace("/groups/new");
    else switchTo(next);
  }

  // + 버튼: 달력에서 고른 날(쿼리 date), 없으면 오늘 10:00~11:00
  const dateParam = searchParams.get("date");
  const baseDay = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : todayKey();
  const newHref = newEventHref({ start: kstToIso(baseDay, "10:00"), end: kstToIso(baseDay, "11:00") });
  const dots = teamDotColors(groups ?? []);
  const isCalendar = tab === "calendar";
  // 일정 작성/수정 화면(/events/new, /events/<코드>/edit)은 저장 버튼이 주 동작이라 폰 독과 + 를 숨긴다 (#137). 일정 가져오기(#279)도 같다.
  // (#276) 할 일 목록 상세(/todos/<코드>)도 맨 아래 입력줄이 주 동작이라 독과 + 를 숨긴다 (D-209)
  // (#189) 약속 투표 화면(/polls/<코드>)도 맨 아래 "이 시간으로 정하기" 가 주 동작이라 같다
  // (#450) AI 비서 화면(/assistant)도 맨 아래 입력 줄이 주 동작이라 같다 (AI-비서.md 7-2)
  // (#515) 운영 숨김 팀은 독과 + 도 숨긴다 (본문이 이용 제한 안내 하나라 갈 곳이 없다. 팀 바꾸기는 머리줄, 사이드바)
  const isForm = info.form || info.todoCode !== null || pollCodeOf(pathname) !== null || info.screen === "assistant" || hidden !== null;
  const shownGroup = group && group.id === groupId ? group : null;
  // (#515) 숨긴 팀은 상세가 403 이라 머리줄 이름, 아바타를 팀 목록 요약으로 그린다
  const hiddenSummary = hidden ? (groups?.find((g) => g.id === groupId) ?? null) : null;

  return (
    <Ctx.Provider value={value}>
      {/* (#450) AI 비서 대화는 메모리에. 팀이 바뀌면 지운다 (AssistantProvider 안에서 groupId 를 본다) */}
      <AssistantProvider groupId={groupId}>
      {/* 사이드바 폭 264, 접으면 72 (#315). 열 너비를 200ms 로 옮긴다 (prefers-reduced-motion 이면 globals.css 가 즉시로) */}
      <div
        className={`min-h-dvh fold:grid fold:grid-cols-[var(--side-w)_minmax(0,1fr)] ${animate ? "transition-[grid-template-columns] duration-200 ease-out" : ""}`}
        style={{ "--side-w": `${fold.collapsed ? SIDEBAR_RAIL_W : SIDEBAR_EXPANDED_W}px` } as React.CSSProperties}
        data-sidebar={fold.collapsed ? "collapsed" : "expanded"}
      >
        <Sidebar
          groupId={groupId}
          group={shownGroup}
          tab={menuTab}
          onNavigate={onMenuNavigate}
          unread={unread}
          noticeDot={noticeDot}
          hiddenTeam={hiddenSummary}
          enabled={wide && groupId !== null && !fold.collapsed && hidden === null}
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
              {shownGroup || hiddenSummary ? (
                <>
                  <span className="truncate">{shownGroup?.name ?? hiddenSummary?.name}</span>
                  <IconChevronDown size={18} className="shrink-0 text-ink-2" />
                  <span className="sr-only">팀 바꾸기</span>
                </>
              ) : (
                <Skeleton className="h-5 w-20" />
              )}
            </button>
            {/* (#199) 일정 검색. 새 소식 종 왼쪽 */}
            <Link href={SEARCH_PATH} aria-label="일정 검색" className="group grid size-11 place-items-center text-ink">
              <span className="grid size-9 place-items-center rounded-sm group-hover:bg-hover">
                <IconSearch size={22} />
              </span>
            </Link>
            <Link
              href={NEWS_PATH}
              aria-label={unread > 0 ? `새 소식 ${unread}개` : "새 소식"}
              className="group grid size-11 place-items-center text-ink"
            >
              <span className="grid size-9 place-items-center rounded-sm group-hover:bg-hover">
                <IconBell size={24} unread={unread > 0} />
              </span>
            </Link>
            <Link href="/me" aria-label={noticeDot ? "내 정보, 새 공지" : "내 정보"} className="relative grid size-11 place-items-center rounded-full">
              {noticeDot && <AvatarDot />}
              {shownGroup ? (
                <Avatar member={shownGroup.me} color={shownGroup.me.color} size={32} />
              ) : hiddenSummary ? (
                <Avatar member={{ displayName: hiddenSummary.me.displayName, profileImageUrl: null }} color={hiddenSummary.me.color} size={32} />
              ) : (
                <Skeleton className="size-8 rounded-full" />
              )}
            </Link>
          </header>

          <main
            // 넓은 화면 본문 바깥 여백 28 32 (디자인규칙.md 2-2). 달력은 남은 높이를 채우고, 다른 화면도 본문 폭을 다 쓴다.
            // 폭 상한(예전 760)은 두지 않고 본문 폭이 넉넉하면 화면마다 2단, 격자로 나눈다 (#244, D-100).
            // (#323) 그 판단은 뷰포트(lg)가 아니라 이 본문의 폭으로 한다: 컨테이너 main(안쪽 폭 = 본문 폭) + globals.css main-* 변형.
            // 사이드바를 72 레일로 접든 264 로 펼치든 화면이 실제로 받은 폭으로 1단/2단을 고른다
            className={`@container/main min-w-0 flex-1 px-5 ${
              isForm
                ? "pb-[calc(24px+env(safe-area-inset-bottom))]"
                : "pb-dock"
            } fold:px-8 fold:py-7 ${
              isCalendar ? "" : "fold:w-full fold:min-w-0"
            }`}
          >
            {/* 팀이 정해진 뒤에만 자식 화면. 팀이 바뀌면 key 로 다시 마운트해 화면 상태(폼 입력, 선택 날짜)를 새 팀 기준으로 시작한다 */}
            {/* (#539) 최신 버전보다 낮은 앱: 본문 위 한 줄 (버전마다 한 번 닫을 수 있다) */}
            {appUpdate.status === "available" && appUpdate.release && <AppUpdateBanner release={appUpdate.release} />}
            {/* (#515) 숨긴 팀: 본문은 비워 두고 안내는 모달로 (D-286) */}
            {hidden ? null : value !== null && !resolvingTeam ? (
              <Fragment key={groupId}>{children}</Fragment>
            ) : (
              <div className="space-y-3 pt-1" aria-busy="true" aria-label="불러오는 중">
                <Skeleton className="h-8 w-40" />
                <Skeleton className="h-[320px] w-full rounded-xl" />
              </div>
            )}
          </main>
        </div>

        {/* 모바일 떠 있는 유리 알약 탭 + 코랄 원 추가 버튼 (#126: 사용자 선호로 #111 의 평평한 바 대신 복원).
            (#332, D-212) 독이 5칸이라 + 와 한 줄에 칸 44 다섯 + 이름 칩이 들어가는 폭은 390 부터다(dock 구간).
            그보다 좁으면(360, 320) 독이 줄 폭을 다 쓰고 + 는 독 위 오른쪽에 12 띄워 얹는다. 빈 왼쪽은 아래 본문을 누를 수 있게 둔다 */}
        <div
          className={`pointer-events-none fixed inset-x-4 bottom-[calc(16px+env(safe-area-inset-bottom))] z-30 flex-col-reverse items-end gap-3 dock:flex-row dock:items-center dock:gap-2 fold:hidden ${
            isForm ? "hidden" : "flex"
          }`}
        >
          {/* 선택된 메뉴만 먹색 칩 + 아이콘 + 이름, 나머지는 아이콘만 (디자인규칙.md 4-1, components/PhoneDock.tsx) */}
          <DockTabs tab={menuTab} onNavigate={onMenuNavigate} className="pointer-events-auto w-full dock:w-auto dock:flex-1" />
          {/* 화면이 + 동작을 정했으면(기념일 화면은 기념일 추가) 그것, 아니면 일정 추가 (#170).
              (#450) + 위 오른쪽 끝에 12 띄워 "AI 볼까" 알약을 얹는다 (390 미만에서 + 가 독 위로 올라가면 그 위로 같이) */}
          <div className="pointer-events-none relative shrink-0">
            <AssistantPill />
          {fabAction ? (
            <button
              type="button"
              onClick={fabAction.run}
              aria-label={fabAction.label}
              className="pointer-events-auto grid size-16 shrink-0 place-items-center rounded-full bg-pri text-on-pri shadow-[var(--fab-shadow)]"
            >
              <IconPlus size={26} strokeWidth={2.2} />
            </button>
          ) : (
            <Link
              href={newHref}
              aria-label="일정 추가"
              className="pointer-events-auto grid size-16 shrink-0 place-items-center rounded-full bg-pri text-on-pri shadow-[var(--fab-shadow)]"
            >
              <IconPlus size={26} strokeWidth={2.2} />
            </Link>
          )}
          </div>
        </div>
      </div>

      {/* (#538) 중요 공지 팝업. 이용 제한 팀 안내, 꼭 업데이트 창이 떠 있으면 기다린다 (D-291) */}
      <NoticePopup blocked={hidden !== null || updateRequired} />
      {/* (#539) 최소 버전보다 낮은 앱: 닫을 수 없는 창 (D-292) */}
      {updateRequired && appUpdate.release && <AppUpdateRequired release={appUpdate.release} version={appUpdate.version} />}
      {hidden && hiddenSummary && <GroupHiddenModal key={hiddenSummary.id} team={hiddenSummary} reason={hidden.reason} onOpenOther={openOtherTeam} />}
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
                    <span className="t-sub block">
                      {g.type === "PERSONAL" ? "나만 보는 달력" : `멤버 ${g.memberCount}명`}
                      {/* (#515) 운영 숨김 팀 */}
                      {g.hidden && <span className="font-semibold text-danger">, 이용 제한</span>}
                    </span>
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
      </AssistantProvider>
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
