// (#478) Android: 백그라운드 진입 시 쿠키를 디스크로 (강제 종료에도 wwm_session 유지, 기획 4.5). WebScreen 에서 분리
import { useEffect } from "react";
import { AppState, Platform } from "react-native";
import { flushCookies } from "../../modules/cookie-flush/src";

export function useAndroidCookieFlush(): void {
  useEffect(() => {
    if (Platform.OS !== "android") return;
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "background") flushCookies().catch((e: unknown) => console.warn("[cookie] flush 실패", e));
    });
    return () => sub.remove();
  }, []);
}
