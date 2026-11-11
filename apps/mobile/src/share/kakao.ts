// (#195) 카카오톡 공유 (docs/설계/앱.md 4.6, D-169). 웹이 만든 피드 템플릿(bridge/messages.ts 에서 검사)을 네이티브 SDK 로 보낸다.
// 카카오톡이 없거나 10.0.0 미만이면 SDK 가 카카오 웹 공유 창을 연다(useWebBrowserIfKakaoTalkNotAvailable).
// 키 없는 빌드, SDK 오류는 throw → 호출부(WebScreen)가 OS 공유 시트로 떨어진다
import { shareFeedTemplate } from "@react-native-kakao/share";
import type { KakaoFeed } from "../bridge/messages";
import { initKakao } from "../auth/login";

export async function shareKakaoFeed(template: KakaoFeed): Promise<void> {
  if (!(await initKakao())) throw new Error("KAKAO_NOT_CONFIGURED");
  await shareFeedTemplate({ template, useWebBrowserIfKakaoTalkNotAvailable: true });
}
