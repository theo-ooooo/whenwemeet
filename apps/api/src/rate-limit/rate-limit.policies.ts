/** (#186) 요청 제한 한도. 표는 docs/설계/api.md 1장 "요청 제한" 과 같아야 한다 (D-143) */

/**
 * 한도 하나. scope 가 user 인데 로그인하지 않은 요청이면 그 한도는 건너뛴다 (인증 가드가 401 로 끝낸다).
 * (#193) token 은 경로의 `:token` 값 기준 (구독 피드 주소 하나)
 */
export interface RateLimitRule {
  scope: 'ip' | 'user' | 'token';
  limit: number;
  windowSec: number;
}

/** 경로별 한도 이름. 같은 이름의 경로끼리는 카운터를 함께 쓴다 (로그인 경로 7개가 한 묶음) */
export type RateLimitPolicy =
  | 'login'
  | 'invitePreview'
  | 'inviteJoin'
  | 'avatarUpload'
  | 'icsPreview'
  | 'icsImport'
  | 'eventSharePreview'
  | 'eventShareCreate'
  | 'icsFeed';

export const RATE_LIMIT_POLICIES: Record<RateLimitPolicy, readonly RateLimitRule[]> = {
  login: [{ scope: 'ip', limit: 20, windowSec: 60 }],
  invitePreview: [{ scope: 'ip', limit: 30, windowSec: 60 }],
  // 6자리 코드 추측 방지: 계정을 여러 개 만들어도 IP 한도에, IP 를 바꿔도 계정 한도에 걸린다.
  // (#274) 일정 링크 합류(POST /event-shares/:token/join)도 이 묶음을 같이 쓴다. 두 길을 번갈아 써서 한도를 두 배로 받지 못하게 (D-185)
  inviteJoin: [
    { scope: 'user', limit: 10, windowSec: 600 },
    { scope: 'ip', limit: 30, windowSec: 600 },
  ],
  avatarUpload: [{ scope: 'user', limit: 20, windowSec: 3600 }],
  // (#279) ICS 가져오기. 미리보기는 팀, 기간을 바꿀 때마다 다시 부르므로 넉넉히, 넣기는 시간당 10회 (기획 3장)
  icsPreview: [{ scope: 'user', limit: 30, windowSec: 3600 }],
  icsImport: [{ scope: 'user', limit: 10, windowSec: 3600 }],
  // (#274) 일정 링크 미리보기는 초대 미리보기와 같은 값, 다른 묶음. 링크 만들기는 사용자당 시간 30회
  eventSharePreview: [{ scope: 'ip', limit: 30, windowSec: 60 }],
  eventShareCreate: [{ scope: 'user', limit: 30, windowSec: 3600 }],
  // (#193) 외부 캘린더 구독 피드. 주소 하나가 분당 10회, IP 하나가 분당 60회 (D-219)
  icsFeed: [
    { scope: 'token', limit: 10, windowSec: 60 },
    { scope: 'ip', limit: 60, windowSec: 60 },
  ],
};

/** 모든 요청의 기본 한도. 유효한 JWT 면 사용자 기준, 아니면 IP 기준 (같은 IP 의 여러 사용자가 한도를 나눠 쓰지 않게) */
export const DEFAULT_USER_RULE: RateLimitRule = { scope: 'user', limit: 300, windowSec: 60 };
export const DEFAULT_IP_RULE: RateLimitRule = { scope: 'ip', limit: 600, windowSec: 60 };
