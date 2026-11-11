// 언제볼까 앱 셸 설정 (docs/설계/앱.md 6장, #95)
// 네이티브 설정은 전부 여기와 config plugin 으로만 한다. ios/ android/ 는 CNG 로 생성되고 커밋하지 않는다.
//
// 환경 변수 (모두 앱 바이너리에 들어가는 공개값. 비밀값은 여기 두지 않는다)
//   KAKAO_NATIVE_APP_KEY     카카오 네이티브 앱 키. 없으면 카카오 플러그인을 빼고 빌드한다 (로그인 버튼은 비활성)
//   EXPO_PUBLIC_WEB_ORIGIN   웹뷰 시작 주소 (기본 https://whenwemeet.day)
//   EXPO_PUBLIC_API_ORIGIN   네이티브 로그인 API (기본 https://api.whenwemeet.day)
//   GOOGLE_SERVICES_JSON     (#188) Android FCM 설정 파일 경로. EAS 파일 환경 변수가 빌드 때 넣는다 (D-96).
//                            없으면 ./google-services.json, 그것도 없으면 빼고 설정한다 (Android 푸시 토큰 불가)
//   EAS_BUILD_PROFILE        EAS 가 넣는다. development 빌드만 APNs 개발 환경
import { existsSync } from "node:fs";
import path from "node:path";
import type { ConfigContext, ExpoConfig } from "expo/config";

// `eas init` 이 알려주는 프로젝트 ID 를 여기에 적는다 (공개값). docs/운영/앱-빌드.md 2단계
const EAS_PROJECT_ID: string | undefined = "d62a24a6-5565-42cc-acfd-7758f42dbd43";

// 1.1.0: 푸시 알림 (#188). 웹은 UA 버전 >= 1.1.0 일 때만 푸시 메시지를 보낸다 (D-81).
// 빌드 번호는 eas.json appVersionSource=remote + autoIncrement 로 EAS 가 올린다
const VERSION = "1.1.0";
const BUNDLE_ID = "day.whenwemeet.app";
const WEB_HOST = "whenwemeet.day";

const SPLASH_LIGHT = "#F4F3F1";
const SPLASH_DARK = "#121214";
const ICON_BG = "#0F0F10";
/** 알림 아이콘 색 (Android 알림 목록에서 아이콘을 칠한다) */
const NOTIFICATION_COLOR = "#E0533D";

/** Android FCM 설정 파일 (D-96). 커밋하지 않는다(.gitignore). 없으면 undefined */
function googleServicesFile(): string | undefined {
  const fromEnv = process.env.GOOGLE_SERVICES_JSON?.trim();
  if (fromEnv) return fromEnv;
  const local = "./google-services.json";
  if (existsSync(path.join(__dirname, local))) return local;
  return undefined;
}

export default ({ config }: ConfigContext): ExpoConfig => {
  const kakaoKey = process.env.KAKAO_NATIVE_APP_KEY?.trim() || undefined;
  const webOrigin = process.env.EXPO_PUBLIC_WEB_ORIGIN?.trim() || `https://${WEB_HOST}`;
  const apiOrigin = process.env.EXPO_PUBLIC_API_ORIGIN?.trim() || `https://api.${WEB_HOST}`;

  if (!kakaoKey) {
    console.warn("[app.config] KAKAO_NATIVE_APP_KEY 없음 — 카카오 SDK 플러그인 없이 설정합니다 (카카오 로그인 불가)");
  }
  const googleServices = googleServicesFile();
  if (!googleServices) {
    console.warn("[app.config] GOOGLE_SERVICES_JSON 없음 — Android FCM 없이 설정합니다 (Android 푸시 토큰 불가)");
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
    // (#188) 푸시 알림. iOS aps-environment 권한, Android 알림 아이콘/색/FCM 기본 채널을 넣는다.
    // 채널 'default' 자체는 앱이 기동 때 만든다 (src/push/notifications.ts). API 발송의 channelId 와 같은 값
    [
      "expo-notifications",
      {
        icon: "./assets/notification-icon.png",
        color: NOTIFICATION_COLOR,
        defaultChannel: "default",
        // 스토어/내부 배포(ad hoc) 빌드는 APNs 운영 환경. development 클라이언트만 개발 환경
        mode: process.env.EAS_BUILD_PROFILE === "development" ? "development" : "production",
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
        // App Store 의 "언어" 는 빌드의 언어 선언으로 정해진다. 기본값(en) 이면 English 로 표시된다 → 한국어만 선언
        CFBundleDevelopmentRegion: "ko",
        CFBundleLocalizations: ["ko"],
        // 웹의 사진 선택(input type=file accept=image/*)이 iOS 에서 "사진 찍기", "사진 보관함" 을 띄운다.
        // 설명이 없으면 카메라를 고르는 순간 강제 종료된다 (#149)
        NSCameraUsageDescription: "프로필 사진을 찍을 때 카메라를 사용해요",
        NSPhotoLibraryUsageDescription: "프로필 사진을 고를 때 사진 보관함을 사용해요",
      },
    },
    android: {
      package: BUNDLE_ID,
      ...(googleServices ? { googleServicesFile: googleServices } : {}),
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
