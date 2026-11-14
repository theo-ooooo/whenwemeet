// (#407) 소개 페이지 app/welcome/page.tsx. 화면 사진은 public/welcome
import { isAppUserAgent } from "./app-bridge";

export const WELCOME_PATH = "/welcome";

/** 맨 `/` 에 세션 쿠키 없이 온 사람이 갈 곳. 웹 방문자는 소개 페이지, 앱 셸(UA WhenwemeetApp/)은 지금처럼 로그인 화면 */
export function signedOutHome(ua: string | null | undefined): string {
  return isAppUserAgent(ua) ? "/login" : WELCOME_PATH;
}
