// 셸 루트: 웹뷰 하나 + 그 위에 뜨는 네이티브 로그인 화면 (docs/설계/앱.md 1장)
import { useCallback, useEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import * as Linking from "expo-linking";
import * as SplashScreen from "expo-splash-screen";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { env } from "./config/env";
import { buildEmailLoginUrl, deepLinkToWebUrl } from "./links/urls";
import { initKakao } from "./auth/login";
import { WebScreen } from "./screens/WebScreen";
import { LoginScreen } from "./screens/LoginScreen";
import { configureNotifications, subscribeNotificationTaps } from "./push/notifications";
import { usePretendard } from "./ui/fonts";
import { useTheme } from "./ui/theme";

void SplashScreen.preventAutoHideAsync().catch(() => undefined);
// 포그라운드 표시 규칙과 Android 채널 (#188). 권한은 묻지 않는다 (웹의 안내 시트에서만, 8-1)
configureNotifications();

type LoginState = { next: string; reason?: "expired" } | null;

export default function App() {
  const t = useTheme();
  // 네이티브 화면(로그인) 글꼴을 미리 읽어 둔다. 웹뷰는 웹이 Pretendard 를 따로 읽는다
  usePretendard();
  const [nav, setNav] = useState({ url: `${env.webOrigin}/`, key: 0 });
  const [login, setLogin] = useState<LoginState>(null);
  const handledInitial = useRef(false);
  const loginRef = useRef<LoginState>(null);
  useEffect(() => {
    loginRef.current = login;
  }, [login]);

  const open = useCallback((url: string) => setNav((n) => ({ url, key: n.key + 1 })), []);

  useEffect(() => {
    void initKakao();
    // 웹이 그려질 때까지 기다리지 않는다. 첫 로드 동안은 웹뷰 배경색(스플래시와 같은 색)이 보인다
    const id = setTimeout(() => void SplashScreen.hideAsync().catch(() => undefined), 300);
    return () => clearTimeout(id);
  }, []);

  // 유니버설 링크/앱 링크 (5.1): 콜드 스타트의 초기 링크와 실행 중 수신 모두 웹뷰로.
  // (#271) 메일 로그인 링크 /auth/email?token= 도 같은 길: 웹뷰가 확인 화면(D-113)을 열고 [로그인 계속하기] 가 웹뷰 세션을 만든다.
  // 링크를 열 때는 떠 있는 네이티브 로그인 화면을 닫는다. 콜드 스타트에 첫 주소(/)가 /login 으로 가 로그인 화면이 먼저 떴어도 (D-178)
  // 링크 화면이 보이게
  useEffect(() => {
    if (!handledInitial.current) {
      handledInitial.current = true;
      Linking.getInitialURL().then((u) => {
        const target = u ? deepLinkToWebUrl(u, env.webOrigin) : null;
        if (target) {
          setLogin(null);
          open(target);
        }
      });
    }
    const sub = Linking.addEventListener("url", ({ url }) => {
      const target = deepLinkToWebUrl(url, env.webOrigin);
      if (target) {
        setLogin(null);
        open(target);
      }
    });
    return () => sub.remove();
  }, [open]);

  // 알림 누름 (#188, 푸시-알림.md 9장): 콜드 스타트와 실행 중 모두. 로그인 화면이 떠 있으면 로그인 후 그 경로로
  useEffect(
    () =>
      subscribeNotificationTaps(({ path, url }) => {
        const l = loginRef.current;
        if (l) setLogin({ ...l, next: path });
        else open(url);
      }),
    [open],
  );

  const onLoginRequested = useCallback((next: string, reason?: "expired") => setLogin({ next, reason }), []);

  // (#245) 네이티브 로그인 화면의 [이메일로 계속하기]: 화면을 닫고 웹뷰가 이메일 로그인 화면을 연다 (D-116)
  const onEmail = useCallback(() => {
    const l = loginRef.current;
    setLogin(null);
    open(buildEmailLoginUrl(env.webOrigin, l?.next ?? "/"));
  }, [open]);

  const onLoggedIn = useCallback(
    (authAppUrl: string) => {
      setLogin(null);
      open(authAppUrl);
    },
    [open],
  );

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
