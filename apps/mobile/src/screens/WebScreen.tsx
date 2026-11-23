// 웹뷰 (docs/설계/앱.md 4장). whenwemeet.day 만 띄운다. 상태와 효과는 src/hooks 의 훅이 맡고 여기는 그리기만 한다 (#478)
import { useRef } from "react";
import { Platform, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { WebView } from "react-native-webview";
import { env } from "../config/env";
import { buildUserAgentSuffix } from "../links/urls";
import { kakaoAvailable } from "../auth/login";
import { useAndroidBackButton } from "../hooks/useAndroidBackButton";
import { useAndroidCookieFlush } from "../hooks/useAndroidCookieFlush";
import { useBridgeMessages } from "../hooks/useBridgeMessages";
import { usePullRefresh } from "../hooks/usePullRefresh";
import { useWebLoadState } from "../hooks/useWebLoadState";
import { useWebNavigation } from "../hooks/useWebNavigation";
import { OfflineScreen } from "./OfflineScreen";
import { useTheme } from "../ui/theme";

/** 웹 앱 감지용 UA 접미사 (4.1). 웹은 이 값 하나로만 판정한다. 버전은 app.config.ts VERSION (1.1.0 이상이면 푸시 지원, D-81).
 *  (#245) 끝의 EmailLogin/1 은 네이티브 로그인 화면에 이메일 버튼이 있다는 표시 (D-116)
 *  (#195) KakaoShare/1 은 kakaoShare 브리지를 처리한다는 표시. 카카오 키가 있는 빌드만 (D-169) */
export const USER_AGENT_SUFFIX = buildUserAgentSuffix(env.version, Platform.OS, kakaoAvailable());

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
  const { canGoBack, currentUrl, onShouldStart, onNav } = useWebNavigation(url, navKey, onLoginRequested);
  const { failed, setFailed, offline, retry } = useWebLoadState(ref, navKey);
  const pull = usePullRefresh(ref);
  const onMessage = useBridgeMessages({ ref, currentUrl, onLoginRequested, onPullRefreshAllow: pull.onWebAllow });
  useAndroidBackButton(ref, canGoBack, failed);
  useAndroidCookieFlush();

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
      onLoadEnd={pull.onLoadEnd}
      onError={() => setFailed(true)}
      onHttpError={(e) => {
        // onHttpError 는 메인 프레임 응답에만 온다. 4xx(404 등)는 웹이 그린 화면을 그대로 둔다
        if (e.nativeEvent.statusCode >= 500) setFailed(true);
      }}
      onContentProcessDidTerminate={() => ref.current?.reload()}
      onRenderProcessGone={() => ref.current?.reload()}
      onScroll={(e: { nativeEvent: { contentOffset: { y: number } } }) => pull.onScroll(e.nativeEvent.contentOffset.y)}
      sharedCookiesEnabled
      thirdPartyCookiesEnabled={false}
      domStorageEnabled
      javaScriptCanOpenWindowsAutomatically={false}
      setSupportMultipleWindows={false}
      allowsBackForwardNavigationGestures
      pullToRefreshEnabled={pull.enabled}
      // iOS 전용. Android 네이티브 정의는 Double 인데 "normal" 문자열을 그대로 넘겨 실행 직후 강제 종료됐다 (ClassCastException)
      {...(Platform.OS === "ios" ? { decelerationRate: "normal" as const } : {})}
      bounces
      allowsInlineMediaPlayback
      webviewDebuggingEnabled={__DEV__}
    />
  );

  return (
    <View style={[styles.root, { backgroundColor: t.bg }]} onTouchStart={pull.onTouchStart}>
      {Platform.OS === "android" ? (
        // Android 웹뷰에는 당겨서 새로고침이 없어 RefreshControl 로 감싼다. 손짓을 맨 위에서 시작했을 때만 켠다 (4.4, #415)
        <ScrollView
          contentContainerStyle={styles.root}
          nestedScrollEnabled
          refreshControl={
            <RefreshControl enabled={pull.enabled} refreshing={pull.refreshing} onRefresh={pull.onRefresh} />
          }
        >
          {webview}
        </ScrollView>
      ) : (
        webview
      )}
      {/* OS 연결 신호(expo-network)만으로는 덮지 않는다. iOS 에서 isInternetReachable 이 잘못 false 로 남아
          웹이 정상인데도 오프라인 화면만 보이는 일이 있었다(1.1 TestFlight). 실제 로드 실패일 때만, 문구에만 신호를 쓴다 */}
      {failed ? <OfflineScreen offline={offline} onRetry={retry} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({ root: { flex: 1 } });
