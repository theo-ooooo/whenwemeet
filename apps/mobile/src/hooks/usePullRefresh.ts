// (#478) 당겨서 새로고침 상태 (#415, 상태 규칙은 screens/pull-refresh.ts). WebScreen 에서 분리
// 손가락을 댈 때 이미 맨 위였을 때만 켠다. 웹이 모달 등으로 막으면(pullRefresh 브리지) 끈다
import { type RefObject, useCallback, useState } from "react";
import type { WebView } from "react-native-webview";
import { PULL_REFRESH_INITIAL, pullEnabled, pullOnScroll, pullOnTouchStart, pullOnWebAllow, type PullRefresh } from "../screens/pull-refresh";

export type PullRefreshControls = {
  /** 웹뷰 pullToRefreshEnabled (iOS), RefreshControl enabled (Android) */
  enabled: boolean;
  /** Android RefreshControl 의 돌아가는 표시 */
  refreshing: boolean;
  /** 감싸는 View 의 onTouchStart */
  onTouchStart: () => void;
  /** 웹뷰 onScroll */
  onScroll: (y: number) => void;
  /** 웹 pullRefresh 브리지 메시지 */
  onWebAllow: (allow: boolean) => void;
  /** Android RefreshControl onRefresh */
  onRefresh: () => void;
  /** 웹뷰 onLoadEnd */
  onLoadEnd: () => void;
};

export function usePullRefresh(ref: RefObject<WebView<object> | null>): PullRefreshControls {
  const [pull, setPull] = useState<PullRefresh>(PULL_REFRESH_INITIAL);
  const [refreshing, setRefreshing] = useState(false);

  const onTouchStart = useCallback(() => setPull(pullOnTouchStart), []);
  const onScroll = useCallback((y: number) => setPull((s) => pullOnScroll(s, y)), []);
  const onWebAllow = useCallback((allow: boolean) => setPull((p) => pullOnWebAllow(p, allow)), []);
  const onRefresh = useCallback(() => {
    setRefreshing(true);
    ref.current?.reload();
  }, [ref]);
  const onLoadEnd = useCallback(() => setRefreshing(false), []);

  return { enabled: pullEnabled(pull), refreshing, onTouchStart, onScroll, onWebAllow, onRefresh, onLoadEnd };
}
