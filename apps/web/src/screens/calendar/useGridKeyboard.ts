"use client";
// (#201, #484) 월 격자 키보드. CalendarScreen 에서 옮김. 키는 lib/calendar-keys.ts
import { useEffect, useRef, useState } from "react";
import { monthGridTarget, monthTabKey } from "@/lib/calendar-keys";
import { parseKey, type DateKey } from "@/lib/date";

type Args = {
  y: number;
  m: number;
  selected: DateKey;
  today: DateKey;
  setMonth: (month: { y: number; m: number }) => void;
};

export function useGridKeyboard({ y, m, selected, today, setMonth }: Args) {
  // 격자의 Tab 정지점은 칸 하나(roving tabindex). 방향키로 옮겨 둔 칸 → 선택한 날 → 오늘 → 1일 중 이 달 안의 첫 칸.
  // 방향키는 포커스만 옮긴다(주소, 선택 그대로). Enter, Space 는 칸 버튼 클릭이라 지금 누르기와 같다
  const [focusKey, setFocusKey] = useState<DateKey | null>(null);
  const tabKey = monthTabKey(y, m, [focusKey, selected, today]);
  const gridRef = useRef<HTMLDivElement>(null);
  // 방향키로 옮긴 뒤에만 DOM 포커스를 따라간다 (‹ › 버튼, 스와이프로 달이 바뀔 때 포커스를 뺏지 않게. DatePicker 와 같은 규칙)
  const keyMoved = useRef(false);
  useEffect(() => {
    if (!keyMoved.current) return;
    keyMoved.current = false;
    gridRef.current?.querySelector<HTMLButtonElement>(`[data-date="${tabKey}"] > button`)?.focus();
  }, [tabKey]);
  function onGridKey(e: React.KeyboardEvent) {
    // 칸 버튼에서 누른 키만 (칸 안 칩은 포커스 정지점이 아니다)
    const from = (e.target as HTMLElement).closest<HTMLElement>("[data-date]")?.dataset.date;
    if (!from || !(e.target as HTMLElement).matches("[data-date] > button")) return;
    const next = monthGridTarget(from, e);
    if (!next) return;
    e.preventDefault();
    keyMoved.current = true;
    setFocusKey(next);
    // 달 밖으로 나가면 달을 바꾼다 (go(±1) 와 같은 데이터 로드: 보는 달이 바뀌면 useEvents 가 그 달을 받는다)
    const p = parseKey(next);
    if (p.y !== y || p.m !== m) setMonth({ y: p.y, m: p.m });
  }

  return { tabKey, gridRef, onGridKey, setFocusKey };
}
