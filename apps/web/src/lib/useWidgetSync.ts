"use client";
// (#197) 홈 화면 위젯 스냅샷 보내기 (docs/설계/앱.md 4.7). 로그인된 화면(AppShell)에서만 쓴다.
// 위젯을 아는 셸(UA 에 Widget/1)이 아니면 아무것도 하지 않는다 (옛 앱은 모르는 메시지를 버리지만 요청 비용을 아낀다).
// 보내는 때: 첫 화면, 팀/일정/기념일 변경 성공 뒤(2초 모아서), 앱이 다시 앞으로 올 때(마지막 전송 10분 뒤부터, 날이 바뀌면 바로)
import { useEffect } from "react";
import { useWidgetAgenda } from "@/hooks";
import { WIDGET_DIRTY_EVENT } from "./api";
import { appSupportsWidget, isInApp, postToApp } from "./app-bridge";
import { dateKeyOf } from "./date";
import { buildWidgetSnapshot, fitWidgetSnapshot } from "./widget-snapshot";

/** 연속 변경을 모으는 시간 */
export const WIDGET_DEBOUNCE_MS = 2_000;
/** 화면이 다시 앞으로 올 때 이보다 최근에 보냈으면 건너뛴다 */
export const WIDGET_REFRESH_MS = 10 * 60 * 1000;

/** 다시 보낼 때인가: 보낸 적 없음, 10분 지남, KST 날이 바뀜 */
export function widgetRefreshDue(lastSentAt: number | null, now: number): boolean {
  if (lastSentAt === null) return true;
  return now - lastSentAt >= WIDGET_REFRESH_MS || dateKeyOf(lastSentAt) !== dateKeyOf(now);
}

// 화면(팀)이 바뀌어 AppShell 이 다시 마운트돼도 이어지게 모듈에 둔다
let lastSentAt: number | null = null;
/** 변경 뒤 보내기 전에 화면이 사라졌다 (팀 나가기 → 다른 팀으로 이동). 다음 마운트에서 바로 보낸다 */
let pendingDirty = false;

export function useWidgetSync(): void {
  const load = useWidgetAgenda();

  useEffect(() => {
    if (!isInApp() || !appSupportsWidget(navigator.userAgent)) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let ctrl: AbortController | null = null;

    const run = async () => {
      timer = null;
      ctrl?.abort();
      const c = new AbortController();
      ctrl = c;
      try {
        const src = await load(Date.now(), c.signal);
        if (c.signal.aborted) return;
        const now = Date.now();
        if (src.groups.length === 0) {
          postToApp({ type: "widgetClear" });
        } else {
          const snapshot = fitWidgetSnapshot(buildWidgetSnapshot(src, now));
          if (snapshot) postToApp({ type: "widgetSnapshot", snapshot });
        }
        lastSentAt = now;
        pendingDirty = false;
      } catch {
        // 네트워크, 권한 오류: 위젯은 이전 스냅샷 그대로 (다음 기회에 다시)
      }
    };
    const schedule = () => {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => void run(), WIDGET_DEBOUNCE_MS);
    };
    const onDirty = () => {
      pendingDirty = true;
      schedule();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible" && widgetRefreshDue(lastSentAt, Date.now())) schedule();
    };

    // 첫 화면: 화면 데이터 요청과 겹치지 않게 2초 뒤
    if (pendingDirty || widgetRefreshDue(lastSentAt, Date.now())) schedule();
    window.addEventListener(WIDGET_DIRTY_EVENT, onDirty);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      if (timer !== null) clearTimeout(timer);
      ctrl?.abort();
      window.removeEventListener(WIDGET_DIRTY_EVENT, onDirty);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);
}
