// (#478) Android 하드웨어 뒤로가기: 웹뷰 history 우선, 없으면 기본 동작(백그라운드). WebScreen 에서 분리
import { type RefObject, useEffect } from "react";
import { BackHandler, Platform } from "react-native";
import type { WebView } from "react-native-webview";

/** canGoBack 은 onNavigationStateChange 가 갱신하는 ref. 오류 화면이 떠 있으면(failed) 웹뷰로 넘기지 않는다 */
export function useAndroidBackButton(ref: RefObject<WebView<object> | null>, canGoBack: RefObject<boolean>, failed: boolean): void {
  useEffect(() => {
    if (Platform.OS !== "android") return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (canGoBack.current && !failed) {
        ref.current?.goBack();
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [failed, ref, canGoBack]);
}
