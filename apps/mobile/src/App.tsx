// 셸 루트: 웹뷰 하나 + 그 위에 뜨는 네이티브 로그인 화면 (docs/설계/앱.md 1장)
import { StyleSheet, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import * as SplashScreen from "expo-splash-screen";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { WebScreen } from "./screens/WebScreen";
import { LoginScreen } from "./screens/LoginScreen";
import { configureNotifications } from "./push/notifications";
import { useAppStartup } from "./hooks/useAppStartup";
import { useDeepLinks } from "./hooks/useDeepLinks";
import { useNotificationTaps } from "./hooks/useNotificationTaps";
import { useShellNavigation } from "./hooks/useShellNavigation";
import { usePretendard } from "./ui/fonts";
import { useTheme } from "./ui/theme";

void SplashScreen.preventAutoHideAsync().catch(() => undefined);
// 포그라운드 표시 규칙과 Android 채널 (#188). 권한은 묻지 않는다 (웹의 안내 시트에서만, 8-1)
configureNotifications();

export default function App() {
  const t = useTheme();
  // 네이티브 화면(로그인) 글꼴을 미리 읽어 둔다. 웹뷰는 웹이 Pretendard 를 따로 읽는다
  usePretendard();
  // (#478) 웹뷰 주소, 로그인 화면 상태와 링크, 알림 누름 처리는 hooks/ 에 있다
  const { nav, login, onLoginRequested, openFromLink, openFromNotification, onEmail, onLoggedIn } = useShellNavigation();
  useAppStartup();
  // 유니버설 링크/앱 링크 (5.1). 링크를 열 때는 떠 있는 네이티브 로그인 화면을 닫는다 (D-178)
  useDeepLinks(openFromLink);
  // 알림 누름 (#188). 로그인 화면이 떠 있으면 로그인 후 그 경로로
  useNotificationTaps(openFromNotification);

  return (
    <SafeAreaProvider>
      <StatusBar style={t.dark ? "light" : "dark"} />
      {/* 웹뷰를 safe-area 안에 둔다. Android 웹뷰는 env(safe-area-inset-*) 가 0 으로 나와 edge-to-edge 에서 가려지므로
          셸이 띄우고, 웹의 env() 값은 0 이 된다 (iOS 도 같은 결과라 플랫폼 분기 없음) */}
      <SafeAreaView style={[styles.root, { backgroundColor: t.bg }]} edges={["top", "bottom"]}>
        <WebScreen url={nav.url} navKey={nav.key} onLoginRequested={onLoginRequested} />
      </SafeAreaView>
      {login ? (
        <View style={StyleSheet.absoluteFill}>
          <LoginScreen next={login.next} reason={login.reason} onSuccess={onLoggedIn} onEmail={onEmail} />
        </View>
      ) : null}
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({ root: { flex: 1 } });
