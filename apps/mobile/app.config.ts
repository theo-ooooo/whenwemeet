// 언제볼까 앱 셸 설정 (docs/설계/앱.md 6장, #95)
// 네이티브 설정은 전부 여기와 config plugin 으로만 한다. ios/ android/ 는 CNG 로 생성되고 커밋하지 않는다.
//
// 환경 변수 (모두 앱 바이너리에 들어가는 공개값. 비밀값은 여기 두지 않는다)
//   KAKAO_NATIVE_APP_KEY     카카오 네이티브 앱 키. 없으면 카카오 플러그인을 빼고 빌드한다 (로그인 버튼은 비활성)
//   EXPO_PUBLIC_WEB_ORIGIN   웹뷰 시작 주소 (기본 https://whenwemeet.day)
//   EXPO_PUBLIC_API_ORIGIN   네이티브 로그인 API (기본 https://api.whenwemeet.day)
import type { ConfigContext, ExpoConfig } from "expo/config";

// `eas init` 이 알려주는 프로젝트 ID 를 여기에 적는다 (공개값). docs/운영/앱-빌드.md 2단계
const EAS_PROJECT_ID: string | undefined = "d62a24a6-5565-42cc-acfd-7758f42dbd43";

const VERSION = "1.0.0";
const BUNDLE_ID = "day.whenwemeet.app";
const WEB_HOST = "whenwemeet.day";

const SPLASH_LIGHT = "#F4F3F1";
const SPLASH_DARK = "#121214";
const ICON_BG = "#0F0F10";

export default ({ config }: ConfigContext): ExpoConfig => {
  const kakaoKey = process.env.KAKAO_NATIVE_APP_KEY?.trim() || undefined;
  const webOrigin = process.env.EXPO_PUBLIC_WEB_ORIGIN?.trim() || `https://${WEB_HOST}`;
  const apiOrigin = process.env.EXPO_PUBLIC_API_ORIGIN?.trim() || `https://api.${WEB_HOST}`;

  if (!kakaoKey) {
    console.warn("[app.config] KAKAO_NATIVE_APP_KEY 없음 — 카카오 SDK 플러그인 없이 설정합니다 (카카오 로그인 불가)");
  }

  const plugins: ExpoConfig["plugins"] = [
    [
      "expo-build-properties",
      { android: { extraMavenRepos: ["https://devrepo.kakao.com/nexus/content/groups/public/"] } },
    ],
    "expo-apple-authentication",
    "expo-web-browser",
    [
      "expo-splash-screen",
      {
        image: "./assets/splash-icon.png",
        imageWidth: 120,
        resizeMode: "contain",
        backgroundColor: SPLASH_LIGHT,
        dark: { image: "./assets/splash-icon.png", backgroundColor: SPLASH_DARK },
      },
    ],
  ];
  if (kakaoKey) {
    plugins.push([
      "@react-native-kakao/core",
      {
        nativeAppKey: kakaoKey,
        // Android: kakao{키}://oauth 를 받는 AuthCodeHandlerActivity. iOS: URL 스킴, LSApplicationQueriesSchemes, openURL 처리
        android: { authCodeHandlerActivity: true },
        ios: { handleKakaoOpenUrl: true },
      },
    ]);
  }

  return {
    ...config,
    name: "언제볼까",
    slug: "whenwemeet",
    scheme: "whenwemeet",
    version: VERSION,
    platforms: ["ios", "android"],
    runtimeVersion: { policy: "appVersion" },
    orientation: "portrait",
    icon: "./assets/icon.png",
    userInterfaceStyle: "automatic",
    ios: {
      bundleIdentifier: BUNDLE_ID,
      supportsTablet: false,
      usesAppleSignIn: true,
      associatedDomains: [`applinks:${WEB_HOST}`],
      infoPlist: {
        // 표준 HTTPS 외 암호화 없음 → TestFlight 수출 규정 질문 생략
        ITSAppUsesNonExemptEncryption: false,
      },
    },
    android: {
      package: BUNDLE_ID,
      adaptiveIcon: {
        foregroundImage: "./assets/adaptive-icon.png",
        monochromeImage: "./assets/adaptive-icon-monochrome.png",
        backgroundColor: ICON_BG,
      },
      predictiveBackGestureEnabled: false,
      intentFilters: [
        {
          action: "VIEW",
          autoVerify: true,
          category: ["BROWSABLE", "DEFAULT"],
          data: [
            { scheme: "https", host: WEB_HOST, pathPrefix: "/join" },
            { scheme: "https", host: WEB_HOST, pathPrefix: "/g" },
          ],
        },
      ],
    },
    plugins,
    ...(EAS_PROJECT_ID ? { updates: { url: `https://u.expo.dev/${EAS_PROJECT_ID}` } } : {}),
    extra: {
      webOrigin,
      apiOrigin,
      kakaoNativeAppKey: kakaoKey ?? null,
      ...(EAS_PROJECT_ID ? { eas: { projectId: EAS_PROJECT_ID } } : {}),
    },
  };
};
