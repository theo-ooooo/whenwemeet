// (#197) iOS 위젯 글루: expo-widgets 타임라인 (App Group). 셸에 따로 저장하지 않는다
import { publishTimeline } from "./store";
import type { WidgetSnapshot } from "./snapshot";
import { todayWidget } from "./TodayWidget.ios";

export function publishWidgetSnapshot(s: WidgetSnapshot): void {
  try {
    publishTimeline(todayWidget, s, Date.now());
  } catch (e) {
    console.warn("[widget] 타임라인 갱신 실패", e);
  }
}

export function clearWidget(): void {
  try {
    publishTimeline(todayWidget, null, Date.now());
  } catch (e) {
    console.warn("[widget] 비우기 실패", e);
  }
}
