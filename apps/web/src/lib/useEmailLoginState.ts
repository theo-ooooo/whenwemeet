"use client";
// (#245) "메일을 보냈어요" 단계 기억 (sessionStorage `wwm_email_login`, 이메일-로그인.md 6-3)과 1초 시계.
// 새로고침해도 ② 를 유지하고 15분이 지나면 버린다. 저장소 접근이 막힌 브라우저(사생활 모드 등)는 메모리 값으로 동작한다
import { useSyncExternalStore } from "react";
import { EMAIL_STORAGE_KEY, parseSentState, type SentState } from "./email-login";

const listeners = new Set<() => void>();
let memory: string | null = null;

function readRaw(): string | null {
  try {
    return window.sessionStorage.getItem(EMAIL_STORAGE_KEY);
  } catch {
    return memory;
  }
}

function emit() {
  for (const l of listeners) l();
}

export function writeSentState(s: SentState | null): void {
  const raw = s ? JSON.stringify(s) : null;
  memory = raw;
  try {
    if (raw) window.sessionStorage.setItem(EMAIL_STORAGE_KEY, raw);
    else window.sessionStorage.removeItem(EMAIL_STORAGE_KEY);
  } catch {
    // 메모리 값만 쓴다
  }
  emit();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** 저장된 원문 (문자열이라 렌더마다 같은 값) */
export function useSentRaw(): string | null {
  return useSyncExternalStore(subscribe, readRaw, () => null);
}

/** 1초마다 바뀌는 지금 시각(ms, 초 단위로 내림). 서버와 하이드레이션 중에는 0 */
const tick = (l: () => void) => {
  const id = setInterval(l, 1000);
  return () => clearInterval(id);
};
const nowSec = () => Math.floor(Date.now() / 1000) * 1000;
export function useNowTick(): number {
  return useSyncExternalStore(tick, nowSec, () => 0);
}

/** 지금 유효한 보낸 상태 (15분 지남, 모양 틀림이면 null) */
export function useSentState(): { sent: SentState | null; now: number } {
  const raw = useSentRaw();
  const now = useNowTick();
  return { sent: now ? parseSentState(raw, now) : null, now };
}
