"use client";
// (#484) 날짜 상세 단계를 바꾸는 동작: 열기, 닫기, 한 단계 더(일정 상세, 빠른 추가), ←, 일 상세 안에서 다른 날로, 넓은 화면 패널 안에서 바꾸기 (#331).
// 단계 상태는 useCalendarSteps. CalendarScreen 에서 옮김. 효과 순서(닫힘 반영 → 사라진 일정 → 패널 대기)는 그대로 둔다
import { useEffect, useEffectEvent, useRef } from "react";
import { dayStepUrl, stepDepth, withSelection, type StepTarget } from "@/lib/calendar-url";
import { panelMove } from "@/lib/day-panel";
import { shiftWeek } from "@/lib/day-view";
import { parseKey, type DateKey } from "@/lib/date";
import { haptic } from "@/lib/app-bridge";
import { CALENDAR_PATH } from "@/lib/routes";
import { useMonthSwipe } from "@/lib/useMonthSwipe";
import { eventStep, type EventRef, writeUrl } from "./calendar-history";
import type { CalendarSteps } from "./useCalendarSteps";

type Args = {
  steps: CalendarSteps;
  /** 달력 쿼리의 바탕 (useCalendarQuerySync) */
  calendarSearch: () => string;
  today: DateKey;
  pick: (date: DateKey) => void;
  wide: boolean;
  /** 열린 일정 상세의 일정이 목록에 없다 (다른 사람이 삭제) */
  eventMissing: boolean;
};

export function useStepNavigation({ steps, calendarSearch, today, pick, wide, eventMissing }: Args) {
  const { urlStep, visible, ownDepth, closing, setClosing, setForeign, setIgnoreAdd, setDayTarget, openDate, rememberRoute } = steps;
  // 닫히는 중에 다른 날짜를 누른 경우: 닫힘이 주소에 반영된 뒤 연다
  const pending = useRef<{ date: DateKey; ev?: EventRef; add?: boolean } | null>(null);

  /** 닫기 버튼, 배경, 끌기, 바깥 클릭, Esc. 쌓은 칸 수만큼 되돌린다 (앞으로가기에 유령 상태가 남지 않게) */
  function close() {
    if (!urlStep.open) return;
    setClosing(true);
    if (ownDepth > 0) window.history.go(-ownDepth);
    else writeUrl(dayStepUrl(calendarSearch(), { step: "closed" }, today), "replace");
  }

  /** 날짜 상세를 연다 (ev 가 있으면 그 일정 상세까지 두 칸). 이미 열려 있으면 닫고 나서 연다. 넓은 화면은 openDay 가 먼저 패널을 본다 */
  function openDayFresh(date: DateKey, ev?: EventRef, add = false) {
    if (urlStep.open) {
      pending.current = { date, ev, add };
      if (!closing) close();
      return;
    }
    pick(date);
    // 바탕 칸에 고른 날짜를 먼저 남긴다. 뒤로가기로 닫혀도 같은 날짜가 선택돼 있게 (여기 올 때 주소는 늘 /calendar 다)
    const p = parseKey(date);
    const base = withSelection(window.location.search, date, today, { y: p.y, m: p.m });
    if (base !== null) writeUrl(`${CALENDAR_PATH}${base}`, "replace");
    writeUrl(dayStepUrl(window.location.search, { step: "day", date }, today), "push");
    if (ev !== undefined) {
      rememberRoute(ev.publicCode, ev.occurrence ?? null, date);
      writeUrl(dayStepUrl(window.location.search, eventStep(date, ev), today), "push");
    } else if (add) {
      // (#192) 주 보기 빈 칸: 날짜 상세 위에 빠른 추가까지 두 칸 (닫으면 그날 목록, 한 번 더 닫으면 주 보기)
      setIgnoreAdd(false);
      writeUrl(dayStepUrl(window.location.search, { step: "add", date }, today), "push");
    }
  }

  // 닫힘이 주소에 반영된 뒤 기다리던 열기를 지금 렌더의 openDay 로 (옛 렌더의 urlStep 을 보지 않게)
  const runPending = useEffectEvent(() => {
    const p = pending.current;
    pending.current = null;
    if (p) openDayFresh(p.date, p.ev, p.add);
  });

  useEffect(() => {
    if (!urlStep.open) {
      // 닫힘이 반영됐다. 기다리던 열기가 있으면 지금
      if (pending.current) queueMicrotask(runPending);
      return;
    }
    // 우리가 쌓은 칸을 다 되돌렸는데 남의 칸(새로고침 주소)이 남아 있으면 떼어 낸다
    if (closing && ownDepth === 0) writeUrl(dayStepUrl(calendarSearch(), { step: "closed" }, today), "replace");
  }, [urlStep, closing, ownDepth, today, calendarSearch]);

  /** 날짜 상세 안에서 한 단계 더 (일정 상세, 빠른 추가). 날짜 단계 위에서만 부르므로 주소는 /calendar 다 */
  function forward(target: StepTarget) {
    setIgnoreAdd(false);
    if (target.step === "event") rememberRoute(target.code, target.occurrence, target.date);
    writeUrl(dayStepUrl(window.location.search, target, today), "push");
  }

  /** ← : 일정 상세/빠른 추가 → 날짜 상세. 우리가 쌓은 칸이면 history.back, 아니면 주소만 바꾼다 */
  function back() {
    if (!urlStep.open) return;
    // 맨 위 칸(일정 상세/빠른 추가)을 우리가 쌓았으면 되돌리고, 새로고침 주소면 바꿔 쓴다
    if (ownDepth >= 1 && stepDepth(urlStep) === 2) window.history.back();
    else writeUrl(dayStepUrl(calendarSearch(), { step: "day", date: urlStep.date }, today), "replace");
  }

  // 일정이 없어졌으면(다른 사람이 삭제) 날짜 상세로
  useEffect(() => {
    if (eventMissing && urlStep.open) writeUrl(dayStepUrl(calendarSearch(), { step: "day", date: urlStep.date }, today), "replace");
  }, [eventMissing, urlStep, today, calendarSearch]);

  // phone 일 상세 (#212). 날짜 단계만 달력 자리를 대신하고, 일정 상세/빠른 추가는 그 위 시트
  const dayView = !wide && visible;
  /** 일 상세 안에서 다른 날로: 기록 칸을 더 쌓지 않고 주소만 바꾼다 (뒤로가기는 여전히 월 보기로, D-58) */
  function changeDay(date: DateKey) {
    if (!urlStep.open || urlStep.step !== "day" || date === openDate) return;
    setDayTarget(date);
    pick(date);
    writeUrl(dayStepUrl(window.location.search, { step: "day", date }, today), "replace");
  }
  // 주간 줄 좌우 스와이프: 왼쪽으로 밀면 다음 주 같은 요일 (달력 스와이프와 같은 판단, #162)
  const stripRef = useMonthSwipe<HTMLDivElement>({
    enabled: dayView && urlStep.open && urlStep.step === "day",
    onCommit: (dir) => {
      if (openDate) changeDay(shiftWeek(openDate, dir));
      haptic("light");
    },
  });

  /* ---------- 넓은 화면 일 상세 패널 (#331) ---------- */

  // 일정 상세/빠른 추가에서 한 칸 되돌린 뒤 바꿀 날 (history.back 결과가 주소에 반영되면 아래 효과가 마저 한다)
  const panelPending = useRef<{ date: DateKey; ev?: EventRef; add?: boolean } | null>(null);
  /** 열린 패널에서 다른 날(ev 가 있으면 그날의 그 일정 상세까지)로. 기록은 날짜 단계 한 칸(+ 일정 상세 한 칸)을 넘지 않는다 */
  function showInPanel(date: DateKey, ev?: EventRef, add = false) {
    const move = panelMove(urlStep, ownDepth);
    if (move === "open") {
      openDayFresh(date, ev, add);
      return;
    }
    if (move === "back") {
      panelPending.current = { date, ev, add };
      window.history.back();
      return;
    }
    if (move === "rewrite") {
      // 새로 고침, 공유로 들어온 일정 상세(되돌릴 칸이 없다): 주소를 그날 날짜 단계로 바꿔 쓴다. 남의 칸은 이제 한 칸
      setIgnoreAdd(false);
      setForeign(1);
      setDayTarget(date);
      pick(date);
      writeUrl(dayStepUrl(calendarSearch(), { step: "day", date }, today), "replace");
    } else if (date !== openDate) {
      changeDay(date);
    }
    if (ev !== undefined) forward(eventStep(date, ev));
    else if (add) forward({ step: "add", date });
  }
  const runPanelPending = useEffectEvent(() => {
    const p = panelPending.current;
    panelPending.current = null;
    if (p) showInPanel(p.date, p.ev, p.add);
  });
  useEffect(() => {
    if (panelPending.current && urlStep.open && urlStep.step === "day") queueMicrotask(runPanelPending);
    // 되돌리다 패널이 닫혔으면(다른 경로) 기다리던 것은 버린다
    if (!urlStep.open) panelPending.current = null;
  }, [urlStep]);

  /** 날짜 상세를 연다. (#331) 넓은 화면 패널이 열려 있으면 닫지 않고 내용만 바꾼다 */
  function openDay(date: DateKey, ev?: EventRef, add = false) {
    if (wide && urlStep.open) showInPanel(date, ev, add);
    else openDayFresh(date, ev, add);
  }

  return { close, forward, back, dayView, changeDay, stripRef, showInPanel, openDay };
}
