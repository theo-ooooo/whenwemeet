// (#407) 소개 페이지. 본문은 정적 HTML(public/welcome/index.html), next.config.ts rewrites 가 /welcome 을 그 파일로 잇는다
import { isAppUserAgent } from "./app-bridge";

export const WELCOME_PATH = "/welcome";

/** 맨 `/` 에 세션 쿠키 없이 온 사람이 갈 곳. 웹 방문자는 소개 페이지, 앱 셸(UA WhenwemeetApp/)은 지금처럼 로그인 화면 */
export function signedOutHome(ua: string | null | undefined): string {
  return isAppUserAgent(ua) ? "/login" : WELCOME_PATH;
}
