// 웹뷰 (docs/설계/앱.md 4장). whenwemeet.day 만 띄우고 브리지 메시지 5종을 처리한다
import { useCallback, useEffect, useRef, useState } from "react";
import {
  AppState,
  BackHandler,
  Linking,
  Platform,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  View,
} from "react-native";
import { WebView, type WebViewMessageEvent, type WebViewNavigation } from "react-native-webview";
import type { ShouldStartLoadRequest } from "react-native-webview/lib/WebViewTypes";
import * as Haptics from "expo-haptics";
import * as Network from "expo-network";
import { flushCookies } from "../../modules/cookie-flush/src";
import { env } from "../config/env";
import { type BridgeMessage, parseBridgeMessage, shareContent } from "../bridge/messages";
import { decideNavigation } from "../links/urls";
import { clearNativeSessions } from "../auth/login";
import { OfflineScreen } from "./OfflineScreen";
import { useTheme } from "../ui/theme";

/** 웹 앱 감지용 UA 접미사 (4.1). 웹은 이 값 하나로만 판정한다 */
export const USER_AGENT_SUFFIX = `WhenwemeetApp/${env.version} (${Platform.OS})`;

type Props = {
  /** 열 주소. key 가 바뀌면 웹뷰를 새로 띄운다 (로그인 직후, 딥링크) */
  url: string;
  navKey: number;
  /** 웹이 로그인을 요청 (login 메시지, 웹 로그인 경로로의 이동) */
  onLoginRequested: (next: string, reason?: "expired") => void;
};

export function WebScreen({ url, navKey, onLoginRequested }: Props) {
  const t = useTheme();
  const ref = useRef<WebView<object>>(null);
  const canGoBack = useRef(false);
  // 실패한 navKey. 새 주소(navKey 증가)로 바뀌면 자동으로 실패 상태가 풀린다
  const [failedAt, setFailedAt] = useState<number | null>(null);
  const failed = failedAt === navKey;
  const setFailed = useCallback((v: boolean) => setFailedAt(v ? navKey : null), [navKey]);
  const [atTop, setAtTop] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
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
  }, [offline, failed, setFailed]);

  // Android 하드웨어 뒤로가기: 웹뷰 history 우선, 없으면 기본 동작(백그라운드)
  useEffect(() => {
    if (Platform.OS !== "android") return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (canGoBack.current && !failed) {
        ref.current?.goBack();
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [failed]);

  // Android: 백그라운드 진입 시 쿠키를 디스크로 (강제 종료에도 wwm_session 유지, 기획 4.5)
  useEffect(() => {
    if (Platform.OS !== "android") return;
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "background") flushCookies().catch((e: unknown) => console.warn("[cookie] flush 실패", e));
    });
    return () => sub.remove();
  }, []);

  const handleMessage = useCallback(
    (msg: BridgeMessage) => {
      switch (msg.type) {
        case "login":
          onLoginRequested(msg.next, msg.reason);
          return;
        case "logout":
          void clearNativeSessions();
          return;
        case "accountDeleted":
          void clearNativeSessions();
          onLoginRequested("/");
          return;
        case "share":
          Share.share(shareContent(msg, Platform.OS === "ios" ? "ios" : "android")).catch((e: unknown) =>
            console.warn("[share]", e),
          );
          return;
        case "haptic":
          if (msg.kind === "light") void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          else
            void Haptics.notificationAsync(
              msg.kind === "success" ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Error,
            );
          return;
      }
    },
    [onLoginRequested],
  );

  const onMessage = useCallback(
    (e: WebViewMessageEvent) => {
      const msg = parseBridgeMessage(e.nativeEvent.data, e.nativeEvent.url, env.webOrigin);
      if (msg) handleMessage(msg);
    },
    [handleMessage],
  );

  const onShouldStart = useCallback(
    (req: ShouldStartLoadRequest) => {
      // iframe 같은 하위 프레임은 판정하지 않는다 (최상위 이동만, 4.4)
      if (req.isTopFrame === false) return true;
      const d = decideNavigation(req.url, env.webOrigin);
      switch (d.kind) {
        case "allow":
          return true;
        case "nativeLogin":
          onLoginRequested(d.next);
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
  }, []);

  const retry = useCallback(() => {
    setFailed(false);
    ref.current?.reload();
  }, [setFailed]);

  const webview = (
    // react-native-webview 14 의 타입은 기본 제네릭(undefined)이 strict 에서 never 가 되어 object 를 명시한다
    <WebView<object>
      key={navKey}
      ref={ref}
      source={{ uri: url }}
      style={{ backgroundColor: t.bg }}
      containerStyle={{ backgroundColor: t.bg }}
      applicationNameForUserAgent={USER_AGENT_SUFFIX}
      originWhitelist={["https://*", "http://*", "about:*"]}
      onShouldStartLoadWithRequest={onShouldStart}
      onMessage={onMessage}
      onNavigationStateChange={onNav}
      onLoadEnd={() => setRefreshing(false)}
      onError={() => setFailed(true)}
      onHttpError={(e) => {
        // onHttpError 는 메인 프레임 응답에만 온다. 4xx(404 등)는 웹이 그린 화면을 그대로 둔다
        if (e.nativeEvent.statusCode >= 500) setFailed(true);
      }}
      onContentProcessDidTerminate={() => ref.current?.reload()}
      onRenderProcessGone={() => ref.current?.reload()}
      onScroll={(e: { nativeEvent: { contentOffset: { y: number } } }) => setAtTop(e.nativeEvent.contentOffset.y <= 0)}
      sharedCookiesEnabled
      thirdPartyCookiesEnabled={false}
      domStorageEnabled
      javaScriptCanOpenWindowsAutomatically={false}
      setSupportMultipleWindows={false}
      allowsBackForwardNavigationGestures
      pullToRefreshEnabled
      decelerationRate="normal"
      bounces
      allowsInlineMediaPlayback
      webviewDebuggingEnabled={__DEV__}
    />
  );

  return (
    <View style={[styles.root, { backgroundColor: t.bg }]}>
      {Platform.OS === "android" ? (
        // Android 웹뷰에는 당겨서 새로고침이 없어 RefreshControl 로 감싼다. 문서 최상단에서만 켠다 (4.4)
        <ScrollView
          contentContainerStyle={styles.root}
          nestedScrollEnabled
          refreshControl={
            <RefreshControl
              enabled={atTop}
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                ref.current?.reload();
              }}
            />
          }
        >
          {webview}
        </ScrollView>
      ) : (
        webview
      )}
      {failed || offline ? <OfflineScreen offline={offline} onRetry={retry} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({ root: { flex: 1 } });
