import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ApiException } from '../common/errors.js';
import { UsersRepository } from '../users/users.repository.js';
import type { AuthenticatedRequest } from '../auth/jwt-auth.guard.js';

/** (#515) 관리자가 아닐 때 문구 (403 FORBIDDEN) */
export const ADMIN_ONLY_MESSAGE = '관리자만 할 수 있어요';

/**
 * (#515) 관리자 판정 (D-285). 역할은 DB 의 `User.role` 만 본다. 토큰이나 요청 본문의 값은 믿지 않고 매 요청 다시 읽어
 * 역할을 바꾸면 다음 요청부터 바로 반영된다
 */
@Injectable()
export class AdminAccess {
  constructor(private readonly users: UsersRepository) {}

  async isAdmin(userId: number | null | undefined): Promise<boolean> {
    if (!userId) return false;
    return (await this.users.findRole(userId)) === 'admin';
  }
}

/**
 * (#515) 관리자 전용 핸들러 가드. 전역 JwtAuthGuard 뒤에 돈다(로그인 안 했으면 이미 401).
 * 관리자가 아니면 403 FORBIDDEN
 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly access: AdminAccess) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<Partial<AuthenticatedRequest>>();
    if (await this.access.isAdmin(request.user?.id)) return true;
    throw new ApiException('FORBIDDEN', ADMIN_ONLY_MESSAGE);
  }
}
