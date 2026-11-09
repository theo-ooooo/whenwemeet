import { CanActivate, ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { ApiException } from '../common/errors.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuthUser, USER_SELECT } from './auth.service.js';

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
    private readonly prisma: PrismaService,
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

    let sub: string;
    try {
      const payload = await this.jwt.verifyAsync<{ sub?: unknown }>(token);
      if (typeof payload.sub !== 'string' || !payload.sub) throw new Error('sub 없음');
      sub = payload.sub;
    } catch {
      throw new ApiException('UNAUTHORIZED');
    }

    const user = await this.prisma.user.findUnique({ where: { id: sub }, select: USER_SELECT });
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
