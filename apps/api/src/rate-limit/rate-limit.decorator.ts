import { SetMetadata } from '@nestjs/common';
import type { RateLimitPolicy } from './rate-limit.policies.js';

export const RATE_LIMIT_KEY = 'rateLimit';
export const SKIP_RATE_LIMIT_KEY = 'skipRateLimit';

export interface RateLimitMeta {
  policy: RateLimitPolicy;
  /** 브라우저가 직접 여는 경로. 넘으면 JSON 대신 `{WEB_ORIGIN}/login?error=RATE_LIMITED` 로 302 */
  redirectToLogin?: boolean;
}

/** (#186) 기본 한도에 더해 경로별 한도를 건다 (rate-limit.policies.ts) */
export const RateLimit = (policy: RateLimitPolicy, options: { redirectToLogin?: boolean } = {}): MethodDecorator & ClassDecorator =>
  SetMetadata(RATE_LIMIT_KEY, { policy, ...options } satisfies RateLimitMeta);

/** (#186) 요청 제한에서 뺀다. 배포 healthcheck 처럼 막히면 운영이 깨지는 경로만 */
export const SkipRateLimit = (): MethodDecorator & ClassDecorator => SetMetadata(SKIP_RATE_LIMIT_KEY, true);
