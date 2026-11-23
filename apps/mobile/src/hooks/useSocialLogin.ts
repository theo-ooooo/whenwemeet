// (#478) 네이티브 로그인 화면의 카카오, 애플 로그인 실행 상태 (docs/설계/앱.md 3.6). LoginScreen 에서 분리
import { useCallback, useEffect, useState } from "react";
import { Platform } from "react-native";
import * as AppleAuthentication from "expo-apple-authentication";
import { AuthApiError } from "../auth/api";
import { LoginCancelled, loginWithApple, loginWithKakao } from "../auth/login";

export type SocialKind = "kakao" | "apple";

/** busy: 진행 중인 버튼, error: 화면 위 오류 문구, run: 버튼 누름 (진행 중이면 무시) */
export function useSocialLogin(next: string, reason: "expired" | undefined, onSuccess: (authAppUrl: string) => void) {
  const [busy, setBusy] = useState<SocialKind | null>(null);
  const [error, setError] = useState<string | null>(reason === "expired" ? "다시 로그인해 주세요" : null);

  const run = useCallback(
    async (kind: SocialKind) => {
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
    },
    [busy, next, onSuccess],
  );

  return { busy, error, run };
}

/** 애플 버튼은 iOS 에서 기기가 Sign in with Apple 을 지원할 때만. Android 앱은 숨긴다 (#145) */
export function useAppleSignInAvailable(): boolean {
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    if (Platform.OS === "ios") AppleAuthentication.isAvailableAsync().then(setAvailable, () => setAvailable(false));
  }, []);
  return available;
}
