// 한 번 닫으면 다시 안 보이는 안내 (#172 같이 쓰기 입구). 이 브라우저에만 남긴다 (테마와 같은 방식)
import { useSyncExternalStore } from "react";

const PREFIX = "wwm.hint.";
const EVENT = "wwm-hint";

function read(key: string): boolean {
  try {
    return localStorage.getItem(PREFIX + key) === "1";
  } catch {
    return false;
  }
}

function subscribe(cb: () => void) {
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

/** 닫은 안내인지. 서버 렌더와 첫 하이드레이션에서는 닫힘으로 보고 안 그린다 (깜빡임 대신 늦게 나타남) */
export function useHintDismissed(key: string): boolean {
  return useSyncExternalStore(
    subscribe,
    () => read(key),
    () => true,
  );
}

export function dismissHint(key: string) {
  try {
    localStorage.setItem(PREFIX + key, "1");
  } catch {}
  window.dispatchEvent(new Event(EVENT));
}
