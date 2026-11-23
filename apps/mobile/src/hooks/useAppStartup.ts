// (#478) 앱 시작 때 한 번: 카카오 SDK 초기화, 스플래시 닫기. App 에서 분리
import { useEffect } from "react";
import * as SplashScreen from "expo-splash-screen";
import { initKakao } from "../auth/login";

export function useAppStartup(): void {
  useEffect(() => {
    void initKakao();
    // 웹이 그려질 때까지 기다리지 않는다. 첫 로드 동안은 웹뷰 배경색(스플래시와 같은 색)이 보인다
    const id = setTimeout(() => void SplashScreen.hideAsync().catch(() => undefined), 300);
    return () => clearTimeout(id);
  }, []);
}
