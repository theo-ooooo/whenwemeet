// 네이티브 로그인 화면 (docs/설계/앱.md 1장, 3.6). 웹뷰가 아닌 화면 (심사 4.2, 4.8)
// 모양은 웹 /login (apps/web/src/app/login/page.tsx, SocialLoginButton) 과 같게 그린다 (#145): 왼쪽 위 심볼, 칩,
// "언제 / 볼까?" 제목, 설명, 버튼(높이 48, 모서리 12, 15/700, 아이콘 20 칸, 간격 8), 약관 안내. 값을 바꾸면 웹도 같이 바꾼다
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Image,
  type ImageSourcePropType,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  type TextStyle,
  View,
} from "react-native";
import * as AppleAuthentication from "expo-apple-authentication";
import * as WebBrowser from "expo-web-browser";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AuthApiError } from "../auth/api";
import { LoginCancelled, kakaoAvailable, loginWithApple, loginWithKakao } from "../auth/login";
import { env } from "../config/env";
import { fontStyle, usePretendard } from "../ui/fonts";
import { useTheme } from "../ui/theme";

type Props = {
  next: string;
  reason?: "expired";
  /** 로그인 성공 — 웹뷰에 열 /auth/app 주소 */
  onSuccess: (authAppUrl: string) => void;
};

const PURPOSES = ["커플", "가족", "친구 모임", "스터디"];

const KAKAO_ICON = require("../../assets/login/kakao.png") as ImageSourcePropType;
const APPLE_ICON = require("../../assets/login/apple.png") as ImageSourcePropType;

export function LoginScreen({ next, reason, onSuccess }: Props) {
  const t = useTheme();
  const c = t.login;
  const fonts = usePretendard();
  const f = (w: 400 | 500 | 700) => fontStyle(w, fonts);
  const insets = useSafeAreaInsets();
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
      // 애플은 iOS expo-apple-authentication signInAsync (auth/login.ts)
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

  function openWeb(path: "/terms" | "/privacy") {
    WebBrowser.openBrowserAsync(`${env.webOrigin}${path}`).catch((e: unknown) => console.warn("[login] 약관 열기 실패", e));
  }

  // 애플 버튼은 iOS 에서 기기가 Sign in with Apple 을 지원할 때만. Android 앱은 숨긴다 (#145)
  const showApple = appleNative;

  return (
    <View
      style={[
        styles.root,
        // 웹: pt max(60px, safe-area-top), pb 34px + safe-area-bottom
        { backgroundColor: c.loginBg, paddingTop: Math.max(60, insets.top), paddingBottom: 34 + insets.bottom },
      ]}
    >
      <BrandSymbol size={40} />

      <View style={styles.bottom}>
        <View accessibilityLabel="이런 모임이 함께 써요" style={styles.chips}>
          {PURPOSES.map((p) => (
            <View key={p} style={[styles.chip, { borderColor: c.line }]}>
              <Text style={[styles.chipText, f(500), { color: c.soft }]}>{p}</Text>
            </View>
          ))}
        </View>

        <Text accessibilityRole="header" style={[styles.title, f(700), { color: c.ink }]}>
          {"언제\n볼까"}
          <Text style={{ color: c.accInk }}>?</Text>
        </Text>
        <Text style={[styles.tagline, f(400), { color: c.soft }]}>
          카톡으로 캡처 주고받기 그만. 달력 하나 같이 보고, 다 되는 시간 바로 찾기.
        </Text>

        <View style={styles.actions}>
          {error ? (
            <Text accessibilityRole="alert" style={[styles.error, f(400), { backgroundColor: c.surface, color: c.danger }]}>
              {error}
            </Text>
          ) : null}

          <View style={styles.buttons}>
            <SocialButton
              label="카카오로 계속하기"
              icon={KAKAO_ICON}
              iconSize={{ width: 20, height: 20 }}
              // 카카오 가이드: 바탕 #FEE500, 심볼 #000000, 글자 #000000 85%
              bg="#FEE500"
              fg="rgba(0,0,0,0.85)"
              iconColor="#000000"
              busy={busy === "kakao"}
              disabled={!kakaoAvailable() || busy !== null}
              fontFamily={f(700)}
              onPress={() => run("kakao")}
            />
            {showApple ? (
              <SocialButton
                label="Apple로 계속하기"
                icon={APPLE_ICON}
                iconSize={{ width: 17, height: 20 }}
                // 웹과 같은 먹(ink) 바탕 + 바탕색 글자. 다크 모드에서 흰 바탕 + 검정 글자로 뒤집힌다 (Apple HIG 흑/백)
                bg={c.ink}
                fg={t.bg}
                iconColor={t.bg}
                busy={busy === "apple"}
                disabled={busy !== null}
                fontFamily={f(700)}
                onPress={() => run("apple")}
              />
            ) : null}
          </View>

          <Text style={[styles.terms, f(400), { color: c.mute }]}>
            계속하면{" "}
            <Text accessibilityRole="link" style={styles.link} onPress={() => openWeb("/terms")} suppressHighlighting={false}>
              이용약관
            </Text>
            과{" "}
            <Text accessibilityRole="link" style={styles.link} onPress={() => openWeb("/privacy")} suppressHighlighting={false}>
              개인정보처리방침
            </Text>
            에 동의한 것으로 봐요
          </Text>
        </View>
      </View>
    </View>
  );
}

/** 웹 SocialLoginButton 과 같은 틀. 색만 버튼마다 넘긴다 */
function SocialButton(props: {
  label: string;
  icon: ImageSourcePropType;
  iconSize: { width: number; height: number };
  bg: string;
  fg: string;
  iconColor: string;
  busy: boolean;
  disabled: boolean;
  fontFamily: TextStyle;
  onPress: () => void;
}) {
  const { label, icon, iconSize, bg, fg, iconColor, busy, disabled, fontFamily, onPress } = props;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled, busy }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.btn, { backgroundColor: bg }, (disabled || busy) && styles.dim, pressed && styles.pressed]}
    >
      <View style={styles.iconBox}>
        {busy ? (
          <ActivityIndicator size="small" color={iconColor} />
        ) : (
          <Image source={icon} style={[iconSize, { tintColor: iconColor }]} accessibilityIgnoresInvertColors />
        )}
      </View>
      <Text numberOfLines={1} style={[styles.btnText, fontFamily, { color: fg }]}>
        {label}
      </Text>
    </Pressable>
  );
}

/** 웹 components/Logo.tsx 의 Symbol 과 같은 치수 (레드, 블루 두 장이 겹친 자리에 보라). 브랜드 고정색 */
function BrandSymbol({ size }: { size: number }) {
  const k = size / 40;
  const sq = 23 * k;
  return (
    <View accessible={false} style={{ width: size, height: size }}>
      <View style={[styles.abs, { left: 3 * k, top: 3 * k, width: sq, height: sq, borderRadius: 8 * k, backgroundColor: "#FF3D1F" }]} />
      <View style={[styles.abs, { left: 14 * k, top: 14 * k, width: sq, height: sq, borderRadius: 8 * k, backgroundColor: "#1F5BFF" }]} />
      <View
        style={[
          styles.abs,
          { left: 14 * k, top: 14 * k, width: 12 * k, height: 12 * k, borderBottomRightRadius: 8 * k, backgroundColor: "#9A1DFF" },
        ]}
      />
    </View>
  );
}

// 웹 Tailwind 값 → pt. 글자 줄높이는 웹 기본(1.5) 또는 지정값
const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 24 },
  bottom: { flex: 1, justifyContent: "flex-end", paddingTop: 64 },
  // ul: mb-4, gap-1.5 / li: rounded-sm(10) border px-2.5 py-1 text-12 medium
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 16 },
  chip: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 4 },
  chipText: { fontSize: 12, lineHeight: 18 },
  // h1: 44, leading-none, tracking -0.04em
  title: { fontSize: 44, lineHeight: 44, letterSpacing: -1.76 },
  // p: mt-3, 15/22
  tagline: { marginTop: 12, fontSize: 15, lineHeight: 22 },
  actions: { marginTop: 32 },
  // 오류: mb-3 rounded-sm px-3.5 py-2.5 text-13
  error: { marginBottom: 12, borderRadius: 10, overflow: "hidden", paddingHorizontal: 14, paddingVertical: 10, fontSize: 13, lineHeight: 19.5 },
  buttons: { gap: 8 },
  // SocialLoginButton: h-12 rounded-md(12) px-4 gap-2, 15/700 leading-5
  btn: {
    height: 48,
    borderRadius: 12,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    width: "100%",
  },
  iconBox: { width: 20, height: 20, alignItems: "center", justifyContent: "center" },
  btnText: { fontSize: 15, lineHeight: 20, flexShrink: 1 },
  dim: { opacity: 0.7 },
  pressed: { opacity: 0.9 },
  // 약관: mt-3 text-12 center
  terms: { marginTop: 12, fontSize: 12, lineHeight: 18, textAlign: "center" },
  link: { textDecorationLine: "underline" },
  abs: { position: "absolute" },
});
