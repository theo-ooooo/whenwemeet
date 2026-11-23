"use client";
// (#450, #484) 넓은 화면 AI 비서 패널 (AI-비서.md 7-3, D-272). CalendarScreen 에서 옮김
import { useCallback, useEffect, useRef } from "react";
import { useAssistant } from "@/components/AssistantProvider";
import type { DateKey } from "@/lib/date";
import type { EventRef } from "./calendar-history";

type Args = {
  wide: boolean;
  /** 날짜 상세가 떠 있다 */
  visible: boolean;
  /** 주소가 날짜 상세 단계다 (닫히는 중 포함) */
  stepOpen: boolean;
  close: () => void;
  reload: () => void;
  openDay: (date: DateKey, ev?: EventRef) => void;
  pick: (date: DateKey) => void;
};

export function useCalendarAssistant({ wide, visible, stepOpen, close, reload, openDay, pick }: Args) {
  // 일 상세 패널과 같은 오른쪽 칸을 번갈아 쓴다. 한 번에 하나: AI 를 열면 일 상세를 닫고, AI 가 열린 채 날짜를 누르면 일 상세로 바뀐다
  // (대화는 메모리에 남아 버튼으로 다시 열면 그대로). 열림은 주소에 넣지 않는다
  const assistant = useAssistant();
  const { setPanelOpen: setAiOpen, clear: clearAi } = assistant;
  const aiButton = useRef<HTMLButtonElement>(null);
  const showAi = wide && assistant.available && assistant.panelOpen && !visible;
  const wasVisible = useRef(visible);
  useEffect(() => {
    if (visible && !wasVisible.current) setAiOpen(false);
    wasVisible.current = visible;
  }, [visible, setAiOpen]);
  function openAssistant() {
    if (stepOpen) close();
    setAiOpen(true);
  }
  const closeAssistant = useCallback(() => {
    // ✕ 로 닫으면 대화를 지운다 (7-4). 포커스는 "AI 볼까" 버튼으로
    clearAi();
    setAiOpen(false);
    aiButton.current?.focus({ preventScroll: true });
  }, [clearAi, setAiOpen]);
  /** 카드 [추가] 뒤: 달력을 다시 받고 그날을 고른다 (보는 달도 그 달로) */
  /** 볼까 패널: [추가] 직후는 그날을 고르기만, "달력에서 보기" 는 그 일정 상세를 연다 (#470) */
  function showAddedDate(date: DateKey, event?: { publicCode: string }) {
    reload();
    if (event) openDay(date, { publicCode: event.publicCode, occurrence: null });
    else pick(date);
  }

  return { available: assistant.available, aiButton, showAi, openAssistant, closeAssistant, showAddedDate };
}
