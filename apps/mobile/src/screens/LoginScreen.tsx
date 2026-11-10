// 네이티브 로그인 화면 (docs/설계/앱.md 1장). 웹뷰가 아닌 화면 (심사 4.2, 4.8)
import { useEffect, useState } from "react";
import { ActivityIndicator, Image, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import * as AppleAuthentication from "expo-apple-authentication";
import { SafeAreaView } from "react-native-safe-area-context";
import { AuthApiError } from "../auth/api";
import { LoginCancelled, kakaoAvailable, loginWithApple, loginWithKakao } from "../auth/login";
import { useTheme } from "../ui/theme";

type Props = {
  next: string;
  reason?: "expired";
  /** 로그인 성공 — 웹뷰에 열 /auth/app 주소 */
  onSuccess: (authAppUrl: string) => void;
};

export function LoginScreen({ next, reason, onSuccess }: Props) {
  const t = useTheme();
  const [busy, setBusy] = useState<"kakao" | "apple" | null>(null);
  const [error, setError] = useState<string | null>(reason === "expired" ? "다시 로그인해 주세요" : null);
  const [appleNative, setAppleNative] = useState(false);

  useEffect(() => {
    if (Platform.OS === "ios") AppleAuthentication.isAvailableAsync().then(setAppleNative, () => setAppleNative(false));
  }, []);

  async function run(kind: "kakao" | "apple") {
    if (busy) return;
    setBusy(kind);
    setError(null);
    try {
      const url = kind === "kakao" ? await loginWithKakao(next) : await loginWithApple(next);
      onSuccess(url);
    } catch (e) {
      if (!(e instanceof LoginCancelled)) {
        setError(e instanceof AuthApiError ? e.message : "로그인하지 못했어요. 잠시 후 다시 시도해 주세요");
        console.warn("[login]", kind, e);
      }
    } finally {
      setBusy(null);
    }
  }

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: t.bg }]}>
      <View style={styles.hero}>
        <Image source={require("../../assets/splash-icon.png")} style={styles.logo} accessibilityIgnoresInvertColors />
        <Text style={[styles.title, { color: t.text }]}>언제볼까</Text>
        <Text style={[styles.sub, { color: t.sub }]}>같이 쓰는 달력</Text>
      </View>

      <View style={styles.actions}>
        {error ? <Text style={[styles.error, { color: t.error }]}>{error}</Text> : null}

        <Pressable
          accessibilityRole="button"
          disabled={!kakaoAvailable() || busy !== null}
          onPress={() => run("kakao")}
          style={({ pressed }) => [styles.btn, styles.kakao, (pressed || !kakaoAvailable()) && styles.dim]}
        >
          {busy === "kakao" ? <ActivityIndicator color="#191919" /> : <Text style={styles.kakaoText}>카카오로 시작하기</Text>}
        </Pressable>

        {appleNative ? (
          <AppleAuthentication.AppleAuthenticationButton
            buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
            buttonStyle={
              t.dark
                ? AppleAuthentication.AppleAuthenticationButtonStyle.WHITE
                : AppleAuthentication.AppleAuthenticationButtonStyle.BLACK
            }
            cornerRadius={12}
            style={[styles.btn, busy !== null && styles.dim]}
            onPress={() => run("apple")}
          />
        ) : Platform.OS === "android" ? (
          <Pressable
            accessibilityRole="button"
            disabled={busy !== null}
            onPress={() => run("apple")}
            style={({ pressed }) => [styles.btn, t.dark ? styles.appleLight : styles.appleDark, pressed && styles.dim]}
          >
            {busy === "apple" ? (
              <ActivityIndicator color={t.dark ? "#000" : "#fff"} />
            ) : (
              <Text style={[styles.appleText, { color: t.dark ? "#000" : "#fff" }]}>Apple로 계속하기</Text>
            )}
          </Pressable>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 24 },
  hero: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8 },
  logo: { width: 96, height: 96, marginBottom: 12 },
  title: { fontSize: 28, fontWeight: "800" },
  sub: { fontSize: 15 },
  actions: { gap: 12, paddingBottom: 24 },
  btn: { height: 52, borderRadius: 12, alignItems: "center", justifyContent: "center", width: "100%" },
  kakao: { backgroundColor: "#FEE500" },
  kakaoText: { color: "#191919", fontSize: 16, fontWeight: "600" },
  appleDark: { backgroundColor: "#000" },
  appleLight: { backgroundColor: "#fff" },
  appleText: { fontSize: 16, fontWeight: "600" },
  dim: { opacity: 0.6 },
  error: { textAlign: "center", fontSize: 14, marginBottom: 4 },
});
