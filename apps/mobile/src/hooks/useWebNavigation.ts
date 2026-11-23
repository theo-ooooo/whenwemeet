// (#478) 웹뷰 이동 판정과 주소, 뒤로가기 가능 여부 추적 (docs/설계/앱.md 4.4). WebScreen 에서 분리
import { useCallback, useEffect, useRef } from "react";
import { Linking } from "react-native";
import type { WebViewNavigation } from "react-native-webview";
import type { ShouldStartLoadRequest } from "react-native-webview/lib/WebViewTypes";
import { env } from "../config/env";
import { decideNavigation } from "../links/urls";

export function useWebNavigation(url: string, navKey: number, onLoginRequested: (next: string, reason?: "expired") => void) {
  const canGoBack = useRef(false);
  // 지금 웹뷰 주소. 셸 → 웹 응답은 이 주소가 웹 오리진일 때만 보낸다 (2-2)
  const currentUrl = useRef(url);
  useEffect(() => {
    currentUrl.current = url;
  }, [url, navKey]);

  const onShouldStart = useCallback(
    (req: ShouldStartLoadRequest) => {
      // iframe 같은 하위 프레임은 판정하지 않는다 (최상위 이동만, 4.4)
      if (req.isTopFrame === false) return true;
      const d = decideNavigation(req.url, env.webOrigin);
      switch (d.kind) {
        case "allow":
          return true;
        case "nativeLogin":
          // /auth/kakao, /auth/apple 이동과 (D-178) /login 문서 이동. 웹 로그인 화면을 그리지 않고 네이티브 화면으로
          onLoginRequested(d.next, d.reason);
          return false;
        case "external":
          Linking.openURL(d.url).catch((err: unknown) => console.warn("[link] 열 수 없음", d.url, err));
          return false;
        default:
          return false;
      }
    },
    [onLoginRequested],
  );

  const onNav = useCallback((s: WebViewNavigation) => {
    canGoBack.current = s.canGoBack;
    if (s.url) currentUrl.current = s.url;
  }, []);

  return { canGoBack, currentUrl, onShouldStart, onNav };
}
