// (#203) 서비스 워커 등록 판정 (D-256). 앱 셸 안에서는 등록하지 않고 이미 있으면 해제한다 (셸이 오프라인 화면을 그린다, #270).
// 브라우저 API 를 직접 부르는 부분은 components/ServiceWorkerRegister.tsx 에 두고 여기는 판정만.
import { isAppUserAgent } from "./app-bridge";

export type ServiceWorkerAction = "register" | "unregister" | "skip";

export type ServiceWorkerEnv = {
  ua: string | null | undefined;
  /** "serviceWorker" in navigator */
  supported: boolean;
  /** window.isSecureContext (https 또는 localhost) */
  secure: boolean;
  /** process.env.NODE_ENV === "production". 개발 서버(HMR)에서는 등록하지 않는다 */
  production: boolean;
};

export function serviceWorkerAction(env: ServiceWorkerEnv): ServiceWorkerAction {
  if (!env.supported) return "skip";
  // 앱 셸: 혹시 남은 등록(옛 버전, 같은 기기 브라우저와 공유되는 경우)도 지운다
  if (isAppUserAgent(env.ua)) return "unregister";
  if (!env.production || !env.secure) return "skip";
  return "register";
}

/** 등록 주소. ?v= 가 캐시 이름이 되고, 값이 바뀌면 브라우저가 새 워커를 설치한다 */
export function serviceWorkerUrl(version: string | undefined): string {
  const v = (version ?? "").replace(/[^0-9A-Za-z._-]/g, "").slice(0, 64) || "dev";
  return `/sw.js?v=${v}`;
}
