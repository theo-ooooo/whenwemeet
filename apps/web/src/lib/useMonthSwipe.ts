"use client";
// 달력 좌우 스와이프 (#162). 판단은 month-swipe.ts, 여기는 포인터 이벤트와 transform 만.
// - 터치와 펜만. 마우스는 화살표 버튼이 맡는다
// - 붙이는 요소에 touch-action: pan-y 를 줘서 세로 스크롤은 브라우저가 그대로 한다 (세로로 정해지면 손을 뗀다)
// - 가로로 정해진 손가락은 놓은 뒤 따라오는 click 을 한 번 삼킨다 (날짜 상세가 열리지 않게)
// - 움직이는 동안 리렌더하지 않는다. transform 은 요소 style 에 바로 쓴다
import { useEffect, useEffectEvent, useRef } from "react";
import { flushSync } from "react-dom";
import { lockDirection, resist, SLIDE_MS, startsAtEdge, swipeOutcome, velocityOf, type Lock, type Sample } from "./month-swipe";

type Options = {
  /** +1 다음 달, -1 이전 달. 상태를 바꿔 새 달을 그린다 (flushSync 안에서 부른다) */
  onCommit: (dir: 1 | -1) => void;
  /** false 면 손가락을 보지 않는다 (날짜 상세가 열려 있을 때 등) */
  enabled: boolean;
};

const EASE_OUT = "cubic-bezier(0.22, 1, 0.36, 1)";

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function useMonthSwipe<T extends HTMLElement>({ onCommit, enabled }: Options) {
  const ref = useRef<T>(null);
  const commit = useEffectEvent((dir: 1 | -1) => onCommit(dir));

  useEffect(() => {
    const node = ref.current;
    if (!node || !enabled) return;
    const el: T = node;

    let id: number | null = null;
    let x0 = 0;
    let y0 = 0;
    let lock: Lock = "pending";
    let samples: Sample[] = [];
    let animating = false;
    let swallowClick = false;
    let timers: ReturnType<typeof setTimeout>[] = [];

    const later = (fn: () => void, ms: number) => timers.push(setTimeout(fn, ms));
    const setX = (x: number, ms = 0) => {
      el.style.transition = ms > 0 ? `transform ${ms}ms ${EASE_OUT}` : "";
      el.style.transform = x === 0 && ms === 0 ? "" : `translateX(${x}px)`;
    };
    const reset = () => {
      id = null;
      lock = "pending";
      samples = [];
    };

    function down(e: PointerEvent) {
      if (e.pointerType === "mouse" || animating) return;
      if (id !== null) {
        // 두 번째 손가락: 끌던 것은 제자리로 돌리고 그만둔다
        if (lock === "horizontal") setX(0, SLIDE_MS);
        reset();
        return;
      }
      if (startsAtEdge(e.clientX, window.innerWidth)) return;
      id = e.pointerId;
      x0 = e.clientX;
      y0 = e.clientY;
      lock = "pending";
      samples = [{ x: e.clientX, t: e.timeStamp }];
      swallowClick = false;
    }

    function move(e: PointerEvent) {
      if (e.pointerId !== id) return;
      const dx = e.clientX - x0;
      const dy = e.clientY - y0;
      if (lock === "pending") {
        lock = lockDirection(dx, dy);
        if (lock === "vertical") {
          reset();
          return;
        }
        if (lock === "horizontal") swallowClick = true;
      }
      if (lock !== "horizontal") return;
      samples.push({ x: e.clientX, t: e.timeStamp });
      if (samples.length > 12) samples.shift();
      if (!prefersReducedMotion()) setX(resist(dx, el.offsetWidth));
    }

    function up(e: PointerEvent) {
      if (e.pointerId !== id) return;
      const wasHorizontal = lock === "horizontal";
      const dx = e.clientX - x0;
      samples.push({ x: e.clientX, t: e.timeStamp });
      const v = velocityOf(samples);
      reset();
      if (!wasHorizontal) return;
      // click 은 pointerup 바로 뒤에 온다. 안 오는 브라우저도 있으니 잠시 뒤 풀어 둔다
      later(() => (swallowClick = false), 400);
      const width = el.offsetWidth;
      const dir = e.type === "pointercancel" ? 0 : swipeOutcome(dx, v, width);
      if (dir === 0) {
        if (!prefersReducedMotion()) setX(0, SLIDE_MS);
        return;
      }
      if (prefersReducedMotion()) {
        setX(0);
        commit(dir);
        return;
      }
      // 나가기: 밀던 쪽으로 폭만큼 → 새 달을 반대편에 두고 → 들어오기
      animating = true;
      setX(dir === 1 ? -width : width, SLIDE_MS);
      later(() => {
        flushSync(() => commit(dir));
        setX(dir === 1 ? width : -width);
        // 위치를 먼저 반영해야 들어오는 transition 이 걸린다
        void el.offsetWidth;
        setX(0, SLIDE_MS);
        later(() => {
          setX(0);
          animating = false;
        }, SLIDE_MS);
      }, SLIDE_MS);
    }

    function click(e: MouseEvent) {
      if (!swallowClick) return;
      swallowClick = false;
      e.preventDefault();
      e.stopPropagation();
    }

    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    el.addEventListener("click", click, true);
    return () => {
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      el.removeEventListener("click", click, true);
      timers.forEach(clearTimeout);
      timers = [];
      // 애니메이션 도중 끊겼으면 제자리로
      el.style.transition = "";
      el.style.transform = "";
    };
  }, [enabled]);

  return ref;
}
