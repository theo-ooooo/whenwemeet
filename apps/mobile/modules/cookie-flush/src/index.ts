// Android 전용. iOS(WKWebsiteDataStore)는 쿠키를 스스로 저장하므로 모듈이 없고 no-op
import { requireOptionalNativeModule } from "expo";

type CookieFlushModule = { flush(): Promise<void> };

const native = requireOptionalNativeModule<CookieFlushModule>("CookieFlush");

export function flushCookies(): Promise<void> {
  return native ? native.flush() : Promise.resolve();
}
