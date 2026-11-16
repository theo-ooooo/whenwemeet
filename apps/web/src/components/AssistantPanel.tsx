"use client";
// (#450) 넓은 화면(≥600) 볼까 오른쪽 패널 (설계 AI-비서.md 7-3, D-272). 일 상세 패널(DayDock, #331)과 같은 자리, 같은 모양이고 한 번에 하나만.
// 본문 760 이상(main-panel)은 달력 오른쪽 400 칸, 그보다 좁으면(main-sheet) 오른쪽에서 밀려 나와 덮는 시트. 비모달이라 달력을 계속 누를 수 있다.
// 열리면 입력으로(동의 전이면 제목으로) 포커스, ✕ 와 Esc 로 닫는다(대화를 지운다). 열림은 주소에 넣지 않는다
import { useEffect, useId, useRef } from "react";
import type { ShowDate } from "@/lib/assistant";
import { useGroupContext } from "./AppShell";
import { AssistantChat, type AssistantChatHandle } from "./AssistantChat";
import { AssistantHeader } from "./AssistantHeader";
import { useAssistant } from "./AssistantProvider";
import { IconSparkle } from "./icons";
import { CloseButton, EmptyState } from "./ui";

type Props = {
  onClose: () => void;
  /** [추가] 뒤 달력이 그날을 보이게 */
  onShowDate?: ShowDate;
};

export function AssistantPanel({ onClose, onShowDate }: Props) {
  const { group } = useGroupContext();
  const a = useAssistant();
  const titleId = useId();
  const chat = useRef<AssistantChatHandle>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  // 열리면 입력으로. 동의 전(입력이 막힘)이면 제목으로
  const consented = a.consented === true;
  useEffect(() => {
    if (consented) chat.current?.focusInput();
    else heading.current?.focus({ preventScroll: true });
  }, [consented]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // 안쪽(투표 고치기 시트, 피커)이 Esc 를 먼저 처리했거나 모달이 떠 있으면 닫지 않는다 (DayDock 과 같은 규칙)
      if (e.defaultPrevented || e.key !== "Escape") return;
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      e.stopPropagation();
      onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <aside
      aria-labelledby={titleId}
      data-assistant-panel
      className={
        "main-sheet:animate-[slide-in-right_200ms_var(--ease-sheet)] fixed inset-y-0 right-0 z-40 flex w-[min(400px,calc(100vw-48px))] flex-col overflow-hidden border-l border-line bg-paper pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] shadow-[var(--pop-shadow)] " +
        "main-panel:animate-[fade-in_200ms_ease-out] main-panel:static main-panel:z-auto main-panel:ml-3 main-panel:w-[400px] main-panel:shrink-0 main-panel:rounded-xl main-panel:border-l-0 main-panel:p-0 main-panel:shadow-none"
      }
    >
      <div className="shrink-0 border-b border-line px-4 pt-1">
        <AssistantHeader ref={heading} titleId={titleId} teamName={group?.name ?? null} end={<CloseButton onClick={onClose} className="-mr-1 ml-1 shrink-0" />} />
      </div>
      {a.ready && !a.available ? (
        <div className="p-4">
          <EmptyState icon={<IconSparkle size={20} />} title="지금은 볼까를 쓸 수 없어요" className="bg-surface py-6">
            일정은 달력에서 직접 추가할 수 있어요
          </EmptyState>
        </div>
      ) : (
        <AssistantChat ref={chat} variant="panel" onShowDate={onShowDate} />
      )}
    </aside>
  );
}
