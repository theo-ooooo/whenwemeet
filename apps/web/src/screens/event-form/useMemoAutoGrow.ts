"use client";
// (#497) 메모 칸 높이 맞추기. EventFormScreen 에서 옮김 (효과 순서를 지키려고 화면 컴포넌트에서 부른다)
import { useEffect, useRef } from "react";

export function useMemoAutoGrow(memo: string, loaded: boolean) {
  // 메모 칸은 내용만큼 늘어난다 (손잡이 대신, #140 L17)
  const memoRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = memoRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [memo, loaded]);
  return memoRef;
}
