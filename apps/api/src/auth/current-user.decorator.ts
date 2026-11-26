import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { AuthUser } from './auth.service.js';
import type { AuthenticatedRequest } from './jwt-auth.guard.js';

/** JwtAuthGuard 가 넣어 둔 사용자를 핸들러 인자로 주입 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => {
    return ctx.switchToHttp().getRequest<AuthenticatedRequest>().user;
  },
);

/** (#196) `@OptionalAuth()` 핸들러용. 익명이면 null */
export const OptionalUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser | null => {
    return (
      ctx.switchToHttp().getRequest<Partial<AuthenticatedRequest>>().user ??
      null
    );
  },
);

/** (#198) 세션 JWT 의 iat(초). 없으면 null. 최근 로그인 검사(D-257)에 쓴다 */
export const SessionIssuedAt = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): number | null => {
    return (
      ctx.switchToHttp().getRequest<Partial<AuthenticatedRequest>>()
        .sessionIssuedAt ?? null
    );
  },
);
