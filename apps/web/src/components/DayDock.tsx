"use client";
// (#331) 넓은 화면(fold ≥600) 일 상세 오른쪽 패널. 날짜 칸 옆 팝오버(폴더블.md 5-4)를 대신한다 (디자인규칙.md 2-4).
// 본문 폭 main-panel(≥760, #323 컨테이너 변형): 달력 오른쪽 400 칸, 본문 높이 전체. 달력은 그만큼 좁아지고 계속 보인다.
// 그보다 좁으면(main-sheet) 오른쪽에서 밀려 나와 달력 위를 덮는 시트. 둘 다 비모달이라 배경을 가리지 않는다:
// 보이는 달력의 다른 날을 누르면 패널 내용만 바뀐다(CalendarScreen). 닫기는 ✕ 와 Esc.
// 열리면 제목으로 포커스(DayPanel), 닫히면 그때의 날짜 칸으로 포커스를 돌린다
import { useEffect, useRef } from "react";

type Props = {
  /** 지금 패널의 날짜. 닫힐 때 이 날짜 칸으로 포커스를 돌린다 */
  date: string;
  titleId: string;
  onClose: () => void;
  /** 삭제 확인 창, 범위 시트가 위에 떠 있으면 Esc 를 그쪽에 맡긴다 */
  paused?: boolean;
  /** 스크롤 밖 바닥에 고정하는 줄 (#175: 비는 시간 + "이 날 일정 추가") */
  footer?: React.ReactNode;
  children: React.ReactNode;
};

/** 달력의 날짜 칸 버튼 (CalendarScreen DayCell: li[data-date] > button) */
function dayCellButton(date: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-date="${date}"] > button`);
}

export function DayDock({ date, titleId, onClose, paused = false, footer, children }: Props) {
  const box = useRef<HTMLElement>(null);
  const dateRef = useRef(date);
  useEffect(() => {
    dateRef.current = date;
  }, [date]);

  useEffect(() => {
    if (paused) return;
    const onKey = (e: KeyboardEvent) => {
      // 안쪽(펼친 시각 목록, 피커 등)이 Esc 를 먼저 처리했으면 닫지 않는다 (useDialogKeys 와 같은 규칙)
      if (e.defaultPrevented || e.key !== "Escape") return;
      e.stopPropagation();
      onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, paused]);

  // 닫히면 그 날짜 칸으로. 패널 밖(사이드바 메뉴 등)으로 이미 옮겨 간 포커스는 건드리지 않는다
  useEffect(() => {
    const el = box.current;
    return () => {
      const active = document.activeElement;
      if (active && active !== document.body && !el?.contains(active)) return;
      dayCellButton(dateRef.current)?.focus({ preventScroll: true });
    };
  }, []);

  return (
    <aside
      ref={box}
      aria-labelledby={titleId}
      data-day-panel
      className={
        // 시트(기본): 화면 오른쪽 끝에서 위아래 전체, 폭 400(창이 좁으면 왼쪽 48 은 남긴다), 팝오버 그림자.
        // 패널(main-panel): 달력 옆 흰 카드 400, 본문 높이 전체, 그림자 없음 (디자인규칙.md 5: 층은 면 차이로)
        "main-sheet:animate-[slide-in-right_200ms_var(--ease-sheet)] fixed inset-y-0 right-0 z-40 flex w-[min(400px,calc(100vw-48px))] flex-col overflow-hidden border-l border-line bg-paper pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] shadow-[var(--pop-shadow)] " +
        "main-panel:animate-[fade-in_200ms_ease-out] main-panel:static main-panel:z-auto main-panel:ml-3 main-panel:w-[400px] main-panel:shrink-0 main-panel:rounded-xl main-panel:border-l-0 main-panel:p-0 main-panel:shadow-none"
      }
    >
      <div className={`min-h-0 flex-1 overflow-y-auto px-4 pt-2 ${footer ? "pb-3" : "pb-4"}`}>{children}</div>
      {footer && <div className="shrink-0 space-y-2 border-t border-line px-4 py-3">{footer}</div>}
    </aside>
  );
}
