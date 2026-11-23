// (#478) 알림 누름 구독 (#188, 푸시-알림.md 9장): 콜드 스타트와 실행 중 모두. App 에서 분리
import { useEffect } from "react";
import { subscribeNotificationTaps } from "../push/notifications";

/** onTap 은 useCallback 으로 고정해 넘긴다 */
export function useNotificationTaps(onTap: (target: { path: string; url: string }) => void): void {
  useEffect(() => subscribeNotificationTaps(onTap), [onTap]);
}
