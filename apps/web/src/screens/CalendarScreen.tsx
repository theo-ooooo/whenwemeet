"use client";
// 4 달력. 크기와 색은 최종-A-시안.html (D-57), 배치는 docs/설계/폴더블.md (D-58).
// phone(<600): 구역으로 쌓는다 (디자인규칙.md 2-1, 2-3, 5, #212). "11월" 제목줄(오늘 알약, ‹ ›) → 달력 카드 →
//   "다가오는 일정" 가로 카드 → "기념일" 가로 카드. 날짜를 누르면 일 상세(DayView: 주간 줄 + 그날 요약 + 그날 일정)가 달력 자리를 대신한다
// fold(600~1023), pc(≥1024): 사이드바(AppShell) 옆 본문. 제목줄 44("2026년 11월" 28/700, 오늘, ‹ ›, "일정 추가") →
//   요약 카드 3열(오늘 비는 시간, 오늘/다음 기념일, 이번 주 일정) → 남은 높이를 채우는 달력 (디자인규칙.md 2-2, 5, #212, D-69).
//   D-58 의 개요 칸(다가오는 일정, D-day, 이번 주 빈 시간)은 사이드바 묶음과 요약 카드로 옮겼다
// 날짜 칸을 누르면 어느 폭이든 그날 상세가 먼저 뜬다: phone 일 상세 화면, fold/pc 오른쪽 일 상세 패널(DayDock, #331).
//   패널은 본문 폭 760 이상이면 달력 옆 400 칸(달력이 그만큼 좁아진다), 그보다 좁으면 달력 위를 덮는 시트. 열린 채 다른 날을 누르면 내용만 바뀐다.
// phone 의 일정 상세, 빠른 추가는 일 상세 위 바텀 시트(DaySheet)로 뜨고, 닫으면 일 상세로 돌아간다.
// 그 안에서 "이 날 일정 추가" → 빠른 추가, 일정 → 일정 상세로 같은 자리에서 바뀐다. 바로 추가는 + 버튼만 맡는다.
// 주소: /calendar?date / ?month 는 replaceState(#81), 날짜 상세 단계는 pushState 로 ?day=1, &add=1, 일정 상세는 경로 /events/<코드> (5-5, #311 D-198).
// /events/<코드> 로 바로 들어오면(새로 고침, 알림, 공유) 그 페이지가 서버에서 일정을 찾아 initialEvent 로 넘기고 같은 이 화면을 그린다
// (#484) 상태와 효과는 screens/calendar 의 훅으로, 큰 조각은 같은 폴더 컴포넌트로 나눴다. 이 파일은 그것들을 엮기만 한다.
//   단계 상태 useCalendarSteps → 주소 쿼리 useCalendarQuerySync → 데이터 useCalendarData → 격자 키보드 useGridKeyboard →
//   단계 동작 useStepNavigation → 삭제 useEventDelete → AI 패널 useCalendarAssistant 순서로 부른다 (효과 순서가 옮기기 전과 같다)
import { usePathname, useSearchParams } from "next/navigation";
import { useId, useMemo, useState } from "react";
import { useGroupContext } from "@/components/AppShell";
import { DayDock } from "@/components/DayDock";
import { DayAddButton, DayPanel } from "@/components/DayPanel";
import { DaySheet } from "@/components/DaySheet";
import { ScopeSheet } from "@/components/RecurrenceSheets";
import { DayView } from "@/components/DayView";
import { AssistantPanel } from "@/components/AssistantPanel";
import { NoticeBannerRow } from "@/components/NoticeBannerRow";
import { StartGuide } from "@/components/StartGuide";
import { TogetherHint, togetherHintOf } from "@/components/TogetherHint";
import { useToast } from "@/components/Toast";
import { ConfirmDialog } from "@/components/ui";
import { messageOf, useEvents, useMe } from "@/hooks";
import type { EventRouteTarget } from "@/lib/calendar-url";
import { CALENDAR_PATH, newEventHref } from "@/lib/routes";
import { anniversariesOn } from "@/lib/day-detail";
import { addDays, dateKeyOf, kstToIso, monthGrid, parseKey, timeOf, todayKey, type DateKey } from "@/lib/date";
import type { Event } from "@/lib/types";
import { useLayout } from "@/lib/useLayout";
import { PollHomeSection, PollSideLine } from "@/components/PollHomeSection";
import { TodoHomeSection } from "@/components/TodoHomeSection";
import { useMonthSwipe } from "@/lib/useMonthSwipe";
import { haptic } from "@/lib/app-bridge";
import { resolveCalView, withCalView, type CalView } from "@/lib/calendar-view";
import { useCalendarViewPref } from "@/lib/useCalendarView";
import { weekDays, weekFetchRange, weekTitle } from "@/lib/week-layout";
import { eventStep, onEventRoute, writeUrl } from "@/screens/calendar/calendar-history";
import { PhoneTitleBar, WideTitleBar } from "@/screens/calendar/CalendarTitleBars";
import { MonthGrid } from "@/screens/calendar/MonthGrid";
import { PhoneAnniversaries, PhoneUpcoming } from "@/screens/calendar/PhoneSections";
import { SummaryCards } from "@/screens/calendar/SummaryCards";
import { useCalendarAssistant } from "@/screens/calendar/useCalendarAssistant";
import { useCalendarData } from "@/screens/calendar/useCalendarData";
import { useCalendarQuerySync } from "@/screens/calendar/useCalendarQuerySync";
import { useCalendarSteps } from "@/screens/calendar/useCalendarSteps";
import { useEventDelete } from "@/screens/calendar/useEventDelete";
import { useGridKeyboard } from "@/screens/calendar/useGridKeyboard";
import { useMonthNavigation } from "@/screens/calendar/useMonthNavigation";
import { useStepNavigation } from "@/screens/calendar/useStepNavigation";
import { WeekView } from "@/screens/calendar/WeekView";

type Props = {
  /** `/events/<코드>` 페이지가 넘기는 일정 자리. `/calendar` 는 없음 */
  initialEvent?: EventRouteTarget | null;
};

const newEventLink = (start: string, end: string) => newEventHref({ start, end });

export function CalendarScreen({ initialEvent = null }: Props) {
  const toast = useToast();
  const layout = useLayout();
  const wide = layout !== "phone";
  const { groupId, group, groups, eventsChanged, restoredVersion } = useGroupContext();
  // (#562) 달력 칸 음력 표시 (내 정보 설정, D-297). 못 받았으면 끔
  const showLunar = useMe().data?.showLunar === true;
  const together = togetherHintOf(group, groups);
  const today = todayKey();
  // 선택 날짜, 보는 달의 처음 값은 지금 주소에서 읽는다 (#81, useMonthNavigation)
  const searchParams = useSearchParams();
  const pathname = usePathname();
  // (#192) 월 | 주. 주소 ?view=week 가 우선, 없으면 기기별 마지막 선택 (lib/calendar-view.ts)
  const viewPref = useCalendarViewPref();
  const view = resolveCalView(searchParams.get("view"), viewPref.pref);
  const week = view === "week";
  const { selected, setSelected, y, m, setMonth, go, goToday, pick } = useMonthNavigation({ initialEvent, searchParams, today, week });
  // 주 보기는 선택 날짜가 든 주(일~토). ‹ › 는 선택 날짜를 7일씩 옮긴다
  const days = useMemo(() => weekDays(selected), [selected]);

  // 6주 그리드. 마지막 주가 통째로 다음 달이면 5주만 그린다 (목업처럼)
  const grid42 = useMemo(() => monthGrid(y, m), [y, m]);
  const grid = useMemo(() => (parseKey(grid42[35]).m !== m ? grid42.slice(0, 35) : grid42), [grid42, m]);

  // 일 목록은 세 상태 중 하나: 로딩(events=null, 오류 없음) / 오류(eventsError) / 준비됨(events 배열, 비어 있으면 빈 상태)
  // 늦게 온 응답이 최신 상태를 덮지 않는 것, 오류에도 직전 값을 유지하는 것은 훅이 보장한다 (#18)
  // (#192) 주 보기는 보이는 주 + 앞뒤 1주(21일). 주를 넘겨도 바로 그릴 수 있게 미리 받아 둔다
  const fetchWeek = weekFetchRange(selected);
  const eventsQ = useEvents(
    groupId,
    week ? { from: kstToIso(fetchWeek.from), to: kstToIso(fetchWeek.to) } : { from: kstToIso(grid42[0]), to: kstToIso(addDays(grid42[41], 1)) },
  );
  const events = eventsQ.data;
  const eventsError = eventsQ.error ? messageOf(eventsQ.error, "일정을 불러오지 못했어요") : null;
  const loadEvents = eventsQ.refetch;

  // 다가오는 일정 (개요). 보는 달과 상관없이 오늘부터 한 달
  const upcomingQ = useEvents(groupId, { from: kstToIso(today), to: kstToIso(addDays(today, 31)) });
  const loadUpcoming = upcomingQ.refetch;
  const upcomingData = upcomingQ.data;

  /* ---------- 날짜 상세 단계 (주소가 원본, 5-5) ---------- */

  const steps = useCalendarSteps({ initialEvent, pathname, searchParams, today, events, upcomingData, selected, y, m, setSelected, setMonth });
  const { urlStep, visible, openDate } = steps;
  const calendarSearch = useCalendarQuerySync({ selected, today, y, m, view, searchParams, pathname });

  /* ---------- 데이터 ---------- */

  const surfaceDate = visible ? openDate : null;
  const {
    weekQ,
    loadWeek,
    anniversaries,
    memberCount,
    members,
    todayFreeQ,
    todayFree,
    now,
    showFree,
    setShowFree,
    weekFreeQ,
    reload,
    reloadEvents,
    byDay,
    weeks,
    upcomingList,
    annByDay,
    phoneWeeks,
    annCards,
    nearest,
    freeLabel,
    weekCount,
    weekCardLabel,
  } = useCalendarData({
    groupId,
    group,
    wide,
    week,
    today,
    days,
    grid,
    events,
    upcomingData,
    loadEvents,
    loadUpcoming,
    eventsChanged,
    restoredVersion,
    surfaceDate,
  });

  /* ---------- 상세에 넣을 것 ---------- */

  const surfaceEvents = surfaceDate && events ? (byDay.get(surfaceDate) ?? []) : null;
  // 반복 회차는 (공개 코드, occurrence) 로 찾는다 (#187, #311). 한 번짜리는 occurrence 가 둘 다 null
  // visible 이면 urlStep.open 이다 (훅에서 받은 값이라 타입 좁히기용으로 한 번 더 본다)
  const surfaceRef = visible && urlStep.open && urlStep.step === "event" ? { code: urlStep.code, occurrence: urlStep.occurrence } : null;
  const isSurface = (e: Event) => surfaceRef !== null && e.publicCode === surfaceRef.code && (e.occurrence ?? null) === surfaceRef.occurrence;
  const surfaceEvent = surfaceRef === null ? undefined : (events?.find(isSurface) ?? upcomingData?.find(isSurface));
  const eventMissing = surfaceRef !== null && surfaceEvent === undefined && events !== null && !eventsError && upcomingData !== null;

  /* ---------- 동작 ---------- */

  /** (#192) 월 | 주 전환. 기기에 기억하고 주소도 바꾼다 (일정 상세 경로 위면 기억만. 그 주소에는 달력 쿼리가 없다) */
  function changeView(v: CalView) {
    viewPref.save(v);
    if (onEventRoute()) return;
    const next = withCalView(window.location.search, v);
    if (next !== null) writeUrl(`${CALENDAR_PATH}${next}`, "replace");
  }
  // 주 보기 좌우 스와이프: 왼쪽으로 밀면 다음 주 (월 달력과 같은 판단, #162)
  const weekSwipeRef = useMonthSwipe<HTMLDivElement>({
    enabled: week && !visible,
    onCommit: (dir) => {
      go(dir);
      haptic("light");
    },
  });
  // 달력 좌우 스와이프 (#162): 왼쪽으로 밀면 다음 달. 날짜 상세가 떠 있는 동안은 보지 않는다
  const swipeRef = useMonthSwipe<HTMLDivElement>({
    enabled: !week && !visible,
    onCommit: (dir) => {
      go(dir);
      haptic("light");
    },
  });

  /* ---------- (#201) 월 격자 키보드 ---------- */

  const { tabKey, gridRef, onGridKey, setFocusKey } = useGridKeyboard({ y, m, selected, today, setMonth });

  const { close, forward, back, dayView, changeDay, stripRef, showInPanel, openDay } = useStepNavigation({ steps, calendarSearch, today, pick, wide, eventMissing });

  // (#192) 빠른 추가의 처음 시작 시각. 주 보기 빈 칸에서 열면 그 시각, "이 날 일정 추가" 는 기본(10:00)
  const [addStart, setAddStart] = useState<string | null>(null);
  function addPlain(date: DateKey) {
    setAddStart(null);
    forward({ step: "add", date });
  }
  function addAtSlot(date: DateKey, time: string) {
    setAddStart(time);
    openDay(date, undefined, true);
  }
  /** (#378 B) 하루 막대의 빈 구간: 그 시각으로 빠른 추가. 그날 날짜 단계 위면 한 칸 더 (닫고 다시 열지 않는다) */
  function addAt(date: DateKey, ms: number) {
    if (urlStep.open && urlStep.step === "day" && openDate === date) {
      setAddStart(timeOf(new Date(ms).toISOString()));
      forward({ step: "add", date });
    } else addAtSlot(date, timeOf(new Date(ms).toISOString()));
  }

  function onCell(key: DateKey) {
    // (#331) 넓은 화면: 패널이 열려 있으면 내용만 그날로 (같은 날이면 일정 상세에서 그날 목록으로 돌아온다)
    if (wide && visible) {
      showInPanel(key);
      return;
    }
    if (visible && urlStep.open && urlStep.date === key) {
      close();
      return;
    }
    openDay(key);
  }

  function onQuickSaved(ev: Event) {
    toast.show("일정을 추가했어요");
    reload();
    // phone 은 일 상세로, 넓은 화면은 패널의 그날 목록으로 돌아간다 (그날 목록에 바로 보이게)
    if (dayView || wide) {
      back();
      return;
    }
    close();
    pick(dateKeyOf(ev.startsAt));
  }

  const { confirmDelete, setConfirmDelete, scopeOpen, setScopeOpen, scopePending, deleting, askDelete, removeEvent } = useEventDelete({
    groupId,
    surfaceEvent,
    toast,
    back,
    reload,
  });

  const newHref = newEventLink(kstToIso(selected, "10:00"), kstToIso(selected, "11:00"));
  const thisYear = parseKey(today).y;

  /* ---------- (#450) 넓은 화면 AI 비서 패널 (AI-비서.md 7-3, D-272) ---------- */

  const assistant = useCalendarAssistant({ wide, visible, stepOpen: urlStep.open, close, reload, openDay, pick });
  const { showAi, closeAssistant, openAssistant } = assistant;
  const titleId = useId();

  /* ---------- 조각 ---------- */

  const panel = surfaceDate ? (
    <DayPanel
      groupId={groupId}
      date={surfaceDate}
      today={today}
      step={urlStep.open ? urlStep.step : "day"}
      titleId={titleId}
      events={surfaceEvents}
      eventsError={eventsError}
      onRetry={reload}
      anniversaries={anniversariesOn(anniversaries, surfaceDate)}
      event={surfaceEvent}
      onClose={dayView ? back : close}
      onBack={back}
      onOpenEvent={(ev) => forward(eventStep(surfaceDate, ev))}
      onPickDay={changeDay}
      onSaved={onQuickSaved}
      onDelete={askDelete}
      onResponded={reloadEvents}
      addStart={addStart}
      members={members}
      now={now}
      onAddAt={(ms) => addAt(surfaceDate, ms)}
    />
  ) : null;
  // 날짜 단계만 "이 날 일정 추가" 를 표면 바닥에 고정한다 (#175, #331). 빠른 추가, 상세는 자기 버튼이 있다.
  // (#378 B) 예전 비는 시간 줄은 패널 위 하루 막대가 대신한다
  const dayFooter =
    surfaceDate && (!urlStep.open || urlStep.step === "day") ? (
      <DayAddButton onAdd={() => addPlain(surfaceDate)} />
    ) : null;

  const titleBar = { week, days, y, m, thisYear, view, onChangeView: changeView, onToday: goToday, onGo: go };

  return (
    // 넓은 화면은 AppShell 본문 바깥 여백(28 32) 안에서 화면 높이를 채운다 (제목줄 → 요약 카드 → 달력).
    // (#331) 가로로 [달력 칸 | 일 상세 패널 400]. 패널은 본문 760 이상에서만 이 줄에 들어오고(main-panel), 그보다 좁으면 fixed 시트
    <div className="fold:flex fold:h-[calc(100dvh-56px)] fold:min-h-[540px]">
      {/* (#201) 보는 달(주)이 바뀌면 읽는다: ‹ ›, 스와이프, 방향키, PageUp/PageDown 어느 쪽이든. 일 상세가 달력을 가려도 남도록 구역 밖에 둔다 */}
      <p aria-live="polite" className="sr-only">
        {week ? weekTitle(days, 0) : `${y}년 ${m}월`}
      </p>
      {/* phone 일 상세: 달력 자리를 대신한다 (#212) */}
      {dayView && surfaceDate && (
        <DayView
          date={surfaceDate}
          today={today}
          titleId={`${titleId}-dv`}
          byDay={events ? byDay : null}
          eventsError={eventsError}
          onRetry={reload}
          anniversaries={anniversariesOn(anniversaries, surfaceDate)}
          members={members}
          now={now}
          stripRef={stripRef}
          onPickDay={changeDay}
          onMonth={close}
          escapeCloses={urlStep.open && urlStep.step === "day" && !confirmDelete && !scopeOpen}
          backLabel={week ? "주 보기" : "월 보기"}
          onOpenEvent={(ev) => forward(eventStep(surfaceDate, ev))}
          onAdd={() => addPlain(surfaceDate)}
          onAddAt={(ms) => addAt(surfaceDate, ms)}
        />
      )}
      {/* 왼쪽: 월 헤더 + 달력. (#331) 이 칸도 컨테이너 main 이라 안쪽 main-* 변형(좁은 제목줄, 요약 카드 3열/세로)은
          패널이 붙어 좁아진 달력 폭으로 갈린다 */}
      <section className={`${dayView ? "hidden" : "flex"} @container/main min-w-0 flex-col fold:min-h-0 fold:flex-1`}>
        {/* phone: 같이 쓰기 입구(있을 때만) → "11월" 제목줄 32 (제목 18/700 / 오늘 알약 + ‹ ›).
            넓은 화면도 입구는 제목줄 위에 같은 카드로 */}
        {/* (#278) 팀 만들기 쓰임별 시작 안내(이 기기에 있을 때만)는 같은 카드에서 입구보다 위 */}
        {/* (#538) 새 공지 띠(있을 때만)가 맨 위. 줄이 하나도 없으면 카드는 empty:hidden 으로 숨는다 */}
        <div className="mb-[22px] rounded-xl bg-paper px-3.5 empty:hidden fold:mb-3 [&>div:last-child]:hidden">
          <NoticeBannerRow />
          {group?.type === "TEAM" && <StartGuide groupId={group.id} />}
          {together && <TogetherHint hint={together} />}
        </div>
        {/* 폰: 진행 중 약속 투표가 있으면 달력 위에 한 줄 카드 (가장 급한 투표 + 나머지 수). 넓은 화면은 사이드바가 같은 줄을 둔다 */}
        <PollSideLine
          groupId={groupId}
          enabled={!wide && group?.type === "TEAM"}
          refreshKey={null}
          className="mb-3 flex h-14 items-center gap-2.5 rounded-xl bg-paper px-3.5 hover:bg-hover fold:hidden"
        />
        <PhoneTitleBar {...titleBar} />
        <WideTitleBar
          {...titleBar}
          assistantAvailable={assistant.available}
          aiButton={assistant.aiButton}
          showAi={showAi}
          onToggleAi={() => (showAi ? closeAssistant() : openAssistant())}
          newHref={newHref}
          addSecondary={Boolean(surfaceDate || showAi)}
        />

        <SummaryCards
          freeLabel={freeLabel}
          todayFree={todayFree}
          todayFreeFailed={Boolean(todayFreeQ.error)}
          onRetryFree={() => void todayFreeQ.refetch()}
          anniversariesLoading={anniversaries === null}
          nearest={nearest}
          week={week}
          weekCardLabel={weekCardLabel}
          weekCount={weekCount}
          weekFailed={Boolean(weekQ.error)}
          onRetryWeek={() => void loadWeek()}
        />

        {/* (#192) 주 보기: 7일 × 시간 격자 (screens/calendar/WeekView.tsx) */}
        {week && (
          <WeekView
            days={days}
            today={today}
            wide={wide}
            events={events}
            eventsError={eventsError}
            onRetry={reload}
            annByDay={annByDay}
            anchor={wide && surfaceDate ? surfaceDate : null}
            free={{
              on: showFree,
              onToggle: () => setShowFree((v) => !v),
              label: memberCount <= 1 ? "빈 시간" : memberCount === 2 ? "둘 다 비는 시간" : "모두 비는 시간",
              slots: weekFreeQ.data?.slots ?? null,
              error: weekFreeQ.error !== null,
            }}
            newHref={newHref}
            swipeRef={weekSwipeRef}
            onOpenDay={(d) => (wide && visible ? showInPanel(d) : openDay(d))}
            onOpenEvent={(d, ev) => openDay(d, ev)}
            onAdd={addAtSlot}
          />
        )}

        {/* 달력 타일 */}
        {!week && (
          <MonthGrid
            gridRef={gridRef}
            swipeRef={swipeRef}
            y={y}
            m={m}
            today={today}
            selected={selected}
            wide={wide}
            surfaceDate={surfaceDate}
            tabKey={tabKey}
            grid={grid}
            weeks={weeks}
            phoneWeeks={phoneWeeks}
            byDay={byDay}
            annByDay={annByDay}
            showLunar={showLunar}
            events={events}
            onKeyDown={onGridKey}
            onCell={onCell}
            onFocusDay={setFocusKey}
            onOpenEvent={(d, ev) => openDay(d, ev)}
          />
        )}

        {/* phone: (#189) 정하는 중(투표가 있을 때만), 다가오는 일정, 기념일, 할 일(#276) 가로 카드 구역 (그날 내용은 일 상세가 보여 준다) */}
        <div className="fold:hidden">
          <PollHomeSection groupId={groupId} enabled={!wide && group?.type === "TEAM"} titleId={`${titleId}-ppoll`} />
          <PhoneUpcoming
            titleId={titleId}
            today={today}
            failed={Boolean(upcomingQ.error)}
            onRetry={() => void loadUpcoming()}
            upcomingList={upcomingList}
            newHref={newHref}
            onOpenDay={(k, ev) => openDay(k, ev)}
          />
          <PhoneAnniversaries titleId={titleId} today={today} annCards={annCards} onOpenDay={(d) => openDay(d)} />
          <TodoHomeSection groupId={groupId} enabled={!wide} titleId={`${titleId}-ptodo`} />
        </div>
      </section>

      {/* 날짜 상세: phone 바텀 시트, 넓은 화면 오른쪽 패널(#331). 폭이 바뀌면 같은 상태로 표면만 바뀐다 */}
      {visible &&
        panel &&
        surfaceDate &&
        (wide ? (
          <DayDock date={surfaceDate} titleId={titleId} onClose={close} paused={confirmDelete || scopeOpen} footer={dayFooter}>
            {panel}
          </DayDock>
        ) : urlStep.open && urlStep.step !== "day" ? (
          <DaySheet titleId={titleId} onClose={back} paused={confirmDelete || scopeOpen}>
            {panel}
          </DaySheet>
        ) : null)}

      {/* (#450) AI 비서 패널: 일 상세가 닫혀 있을 때만 같은 자리에 */}
      {showAi && <AssistantPanel onClose={closeAssistant} onShowDate={assistant.showAddedDate} />}

      <ConfirmDialog
        open={confirmDelete}
        title="이 일정을 삭제할까요?"
        body="팀원 모두에게서 사라져요"
        confirmLabel="삭제"
        danger
        loading={deleting}
        onConfirm={() => void removeEvent()}
        onCancel={() => setConfirmDelete(false)}
      />
      {surfaceEvent?.repeat && (
        <ScopeSheet
          open={scopeOpen}
          mode="delete"
          occurrence={surfaceEvent.occurrence ?? dateKeyOf(surfaceEvent.startsAt)}
          pending={scopePending}
          onPick={(scope) => void removeEvent(scope)}
          onClose={() => setScopeOpen(false)}
        />
      )}
    </div>
  );
}
