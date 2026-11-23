// (#478) 유니버설 링크, 앱 링크 (docs/설계/앱.md 5.1). App 에서 분리
// 콜드 스타트의 초기 링크와 실행 중 수신 모두 웹 주소로 바꿔 넘긴다.
// (#271) 메일 로그인 링크 /auth/email?token= 도 같은 길: 웹뷰가 확인 화면(D-113)을 열고 [로그인 계속하기] 가 웹뷰 세션을 만든다
import { useEffect, useRef } from "react";
import * as Linking from "expo-linking";
import { env } from "../config/env";
import { deepLinkToWebUrl } from "../links/urls";

/** onLink 는 웹 주소로 바꿀 수 있는 링크에만 불린다. useCallback 으로 고정해 넘긴다 */
export function useDeepLinks(onLink: (webUrl: string) => void): void {
  const handledInitial = useRef(false);
  useEffect(() => {
    if (!handledInitial.current) {
      handledInitial.current = true;
      Linking.getInitialURL().then((u) => {
        const target = u ? deepLinkToWebUrl(u, env.webOrigin) : null;
        if (target) onLink(target);
      });
    }
    const sub = Linking.addEventListener("url", ({ url }) => {
      const target = deepLinkToWebUrl(url, env.webOrigin);
      if (target) onLink(target);
    });
    return () => sub.remove();
  }, [onLink]);
}
