// (#478) 웹뷰 로드 실패와 오프라인 복구 (docs/설계/앱.md 4장). WebScreen 에서 분리
import { type RefObject, useCallback, useEffect, useRef, useState } from "react";
import type { WebView } from "react-native-webview";
import * as Network from "expo-network";

export type WebLoadState = {
  /** 지금 navKey 의 로드가 실패했는가 (오류 화면을 덮는다) */
  failed: boolean;
  setFailed: (v: boolean) => void;
  /** OS 연결 신호. 오류 화면 문구에만 쓴다 (iOS 에서 잘못 false 로 남는 일이 있어 덮는 기준으로는 쓰지 않는다) */
  offline: boolean;
  /** 오류 화면의 [다시 시도] */
  retry: () => void;
};

export function useWebLoadState(ref: RefObject<WebView<object> | null>, navKey: number): WebLoadState {
  // 실패한 navKey. 새 주소(navKey 증가)로 바뀌면 자동으로 실패 상태가 풀린다
  const [failedAt, setFailedAt] = useState<number | null>(null);
  const failed = failedAt === navKey;
  const setFailed = useCallback((v: boolean) => setFailedAt(v ? navKey : null), [navKey]);
  const net = Network.useNetworkState();
  const offline = net.isConnected === false || net.isInternetReachable === false;

  // 연결이 돌아오면 오류 화면에서 자동 복구
  const wasOffline = useRef(offline);
  useEffect(() => {
    if (wasOffline.current && !offline && failed) {
      setFailed(false);
      ref.current?.reload();
    }
    wasOffline.current = offline;
  }, [offline, failed, setFailed, ref]);

  const retry = useCallback(() => {
    setFailed(false);
    ref.current?.reload();
  }, [setFailed, ref]);

  return { failed, setFailed, offline, retry };
}
