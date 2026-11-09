import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { AuthUser } from './auth.service.js';
import type { AuthenticatedRequest } from './jwt-auth.guard.js';

/** JwtAuthGuard 가 넣어 둔 사용자를 핸들러 인자로 주입 */
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthUser => {
  return ctx.switchToHttp().getRequest<AuthenticatedRequest>().user;
});
