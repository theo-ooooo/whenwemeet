import { CanActivate, ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { ApiException } from '../common/errors.js';
import { UsersRepository } from '../users/users.repository.js';
import type { AuthUser } from './auth.service.js';

export const IS_PUBLIC_KEY = 'isPublic';

/** 인증 없이 열리는 엔드포인트 표시 (health, 카카오 OAuth, 초대 미리보기) */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC_KEY, true);

export type AuthenticatedRequest = Request & { user: AuthUser };

/** Bearer JWT 검증 → sub 사용자 조회 → request.user. 없으면 401 UNAUTHORIZED (인증흐름.md 3장) */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly users: UsersRepository,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = extractBearer(request.headers.authorization);
    if (!token) throw new ApiException('UNAUTHORIZED');

    let sub: number;
    try {
      const payload = await this.jwt.verifyAsync<{ sub?: unknown }>(token);
      // sub 는 양의 정수 문자열. 예전 cuid 토큰도 여기서 401 이 된다
      if (typeof payload.sub !== 'string' || !/^[1-9]\d{0,9}$/.test(payload.sub)) throw new Error('sub 형식 아님');
      sub = Number(payload.sub);
    } catch {
      throw new ApiException('UNAUTHORIZED');
    }

    const user = await this.users.findById(sub);
    if (!user) throw new ApiException('UNAUTHORIZED');
    request.user = user;
    return true;
  }
}

function extractBearer(header: string | undefined): string | null {
  if (!header) return null;
  const [scheme, token] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) return null;
  return token;
}
