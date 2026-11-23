// (#478) 셸 루트의 웹뷰 주소와 네이티브 로그인 화면 상태 (docs/설계/앱.md 1장). App 에서 분리
import { useCallback, useEffect, useRef, useState } from "react";
import { env } from "../config/env";
import { buildEmailLoginUrl } from "../links/urls";

export type LoginState = { next: string; reason?: "expired" } | null;

export function useShellNavigation() {
  // key 가 바뀌면 웹뷰를 새로 띄운다
  const [nav, setNav] = useState({ url: `${env.webOrigin}/`, key: 0 });
  const [login, setLogin] = useState<LoginState>(null);
  const loginRef = useRef<LoginState>(null);
  useEffect(() => {
    loginRef.current = login;
  }, [login]);

  const open = useCallback((url: string) => setNav((n) => ({ url, key: n.key + 1 })), []);

  /** 웹이 로그인을 요청 → 네이티브 로그인 화면 */
  const onLoginRequested = useCallback((next: string, reason?: "expired") => setLogin({ next, reason }), []);

  /** 유니버설 링크, 앱 링크: 떠 있는 로그인 화면을 닫고 링크 화면을 연다 (D-178) */
  const openFromLink = useCallback(
    (webUrl: string) => {
      setLogin(null);
      open(webUrl);
    },
    [open],
  );

  /** 알림 누름 (#188, 푸시-알림.md 9장): 로그인 화면이 떠 있으면 로그인 후 그 경로로 */
  const openFromNotification = useCallback(
    ({ path, url }: { path: string; url: string }) => {
      const l = loginRef.current;
      if (l) setLogin({ ...l, next: path });
      else open(url);
    },
    [open],
  );

  /** (#245) 로그인 화면의 [이메일로 계속하기]: 화면을 닫고 웹뷰가 이메일 로그인 화면을 연다 (D-116) */
  const onEmail = useCallback(() => {
    const l = loginRef.current;
    setLogin(null);
    open(buildEmailLoginUrl(env.webOrigin, l?.next ?? "/"));
  }, [open]);

  /** 네이티브 로그인 성공 → 웹뷰가 /auth/app 주소로 세션을 만든다 */
  const onLoggedIn = useCallback(
    (authAppUrl: string) => {
      setLogin(null);
      open(authAppUrl);
    },
    [open],
  );

  return { nav, login, onLoginRequested, openFromLink, openFromNotification, onEmail, onLoggedIn };
}
