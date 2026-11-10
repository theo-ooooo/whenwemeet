// 네이티브 로그인 → handoff → /auth/app 주소 (docs/설계/앱.md 1장, 3장)
// 셸은 세션 JWT 를 받지 않는다. 손에 쥐는 것은 60초 handoff 와 메모리의 verifier 뿐 (D-44, D-49)
import { Platform } from "react-native";
import * as AppleAuthentication from "expo-apple-authentication";
import { initializeKakaoSDK } from "@react-native-kakao/core";
import * as KakaoUser from "@react-native-kakao/user";
import { env } from "../config/env";
import { buildAuthAppUrl } from "../links/urls";
import { AuthApiError, requestHandoff } from "./api";
import { randomBytes, sha256 } from "./crypto";
import { appleNickname, codeChallenge, createAppleNonce, createVerifier } from "./pkce";

/** 사용자가 취소한 로그인 — 화면에 오류를 띄우지 않는다 */
export class LoginCancelled extends Error {
  constructor() {
    super("cancelled");
    this.name = "LoginCancelled";
  }
}

let kakaoReady: Promise<boolean> | null = null;

/** 카카오 SDK 초기화 (앱 시작 시 1회). 키가 없는 빌드면 false */
export function initKakao(): Promise<boolean> {
  if (!kakaoReady) {
    const key = env.kakaoNativeAppKey;
    kakaoReady = key
      ? initializeKakaoSDK(key).then(
          () => true,
          (e) => {
            console.warn("[kakao] 초기화 실패", e);
            return false;
          },
        )
      : Promise.resolve(false);
  }
  return kakaoReady;
}

export const kakaoAvailable = (): boolean => Boolean(env.kakaoNativeAppKey);

async function newVerifier(): Promise<{ verifier: string; challenge: string }> {
  const verifier = createVerifier(randomBytes);
  return { verifier, challenge: await codeChallenge(verifier, sha256) };
}

function isCancel(e: unknown): boolean {
  const code = (e as { code?: unknown })?.code;
  const msg = String((e as { message?: unknown })?.message ?? "").toLowerCase();
  return code === "ERR_REQUEST_CANCELED" || code === "ERR_CANCELED" || msg.includes("cancel");
}

/** 카카오톡 앱 로그인 (없으면 SDK 가 카카오계정 로그인으로 폴백) → /auth/app 주소 */
export async function loginWithKakao(next: string): Promise<string> {
  if (!(await initKakao())) throw new AuthApiError("KAKAO_NOT_CONFIGURED", "카카오 로그인을 쓸 수 없는 빌드예요", 0);
  let accessToken: string;
  try {
    accessToken = (await KakaoUser.login()).accessToken;
  } catch (e) {
    if (isCancel(e)) throw new LoginCancelled();
    throw new AuthApiError("KAKAO_SDK", "카카오 로그인에 실패했어요", 0);
  }
  const { verifier, challenge } = await newVerifier();
  const handoff = await requestHandoff(env.apiOrigin, "/v1/auth/kakao/native", {
    accessToken,
    codeChallenge: challenge,
  });
  return buildAuthAppUrl(env.webOrigin, handoff, verifier, next);
}

/** 애플 로그인은 iOS 네이티브만 (3.3). Android 앱은 애플 로그인을 쓰지 않는다 (#145, 버튼도 없음) */
export async function loginWithApple(next: string): Promise<string> {
  if (Platform.OS !== "ios") throw new AuthApiError("APPLE_UNSUPPORTED", "Apple 로그인은 iPhone 에서만 쓸 수 있어요", 0);
  const { verifier, challenge } = await newVerifier();
  const nonce = await createAppleNonce(randomBytes, sha256);
  let cred: AppleAuthentication.AppleAuthenticationCredential;
  try {
    cred = await AppleAuthentication.signInAsync({
      requestedScopes: [AppleAuthentication.AppleAuthenticationScope.FULL_NAME],
      nonce: nonce.hashed,
    });
  } catch (e) {
    if (isCancel(e)) throw new LoginCancelled();
    throw new AuthApiError("APPLE_SDK", "Apple 로그인에 실패했어요", 0);
  }
  if (!cred.identityToken || !cred.authorizationCode) {
    throw new AuthApiError("APPLE_SDK", "Apple 로그인에 실패했어요", 0);
  }
  const handoff = await requestHandoff(env.apiOrigin, "/v1/auth/apple/native", {
    identityToken: cred.identityToken,
    authorizationCode: cred.authorizationCode,
    nonce: nonce.raw,
    nickname: appleNickname(cred.fullName),
    codeChallenge: challenge,
  });
  return buildAuthAppUrl(env.webOrigin, handoff, verifier, next);
}

/** 로그아웃, 탈퇴 시 카카오 SDK 토큰 정리. 실패해도 웹 흐름은 계속 (토큰이 없을 수도 있다) */
export async function clearNativeSessions(): Promise<void> {
  if (!(await initKakao())) return;
  try {
    if (await KakaoUser.isLogined()) await KakaoUser.logout();
  } catch (e) {
    console.warn("[kakao] logout 실패 (무시)", e);
  }
}
