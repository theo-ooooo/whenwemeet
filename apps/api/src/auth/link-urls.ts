/**
 * (#198) 웹 OAuth 연결 콜백이 돌아갈 웹 주소 (D-257). 웹 `/me/link` route handler 가 세션으로 티켓을 소비하고
 * next(기본 내 정보 > 로그인 방법)로 결과를 싣고 간다. next 는 호출하는 쪽이 sanitizeNext 를 거친 값
 */
export const LINK_LANDING_PATH = '/me/link';

export function linkTicketUrl(webOrigin: string, ticket: string, next: string): string {
  return `${webOrigin}${LINK_LANDING_PATH}?${new URLSearchParams({ ticket, next }).toString()}`;
}

export function linkFailureUrl(webOrigin: string, code: string, next: string): string {
  return `${webOrigin}${LINK_LANDING_PATH}?${new URLSearchParams({ error: code, next }).toString()}`;
}
