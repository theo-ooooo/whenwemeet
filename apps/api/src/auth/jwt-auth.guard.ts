import {
  CanActivate,
  ExecutionContext,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { ApiException } from '../common/errors.js';
import { UsersRepository } from '../users/users.repository.js';
import type { AuthUser } from './auth.service.js';

export const IS_PUBLIC_KEY = 'isPublic';

/** 인증 없이 열리는 엔드포인트 표시 (health, 카카오 OAuth). 토큰을 아예 읽지 않는다 */
export const Public = (): MethodDecorator & ClassDecorator =>
  SetMetadata(IS_PUBLIC_KEY, true);

export const IS_OPTIONAL_AUTH_KEY = 'isOptionalAuth';

/**
 * (#196) 선택 인증 (D-158). 토큰이 유효하면 request.user 를 채우고, 없거나 틀리거나 만료면 익명으로 통과 (401 없음).
 * 핸들러는 `@OptionalUser()` 로 받는다
 */
export const OptionalAuth = (): MethodDecorator & ClassDecorator =>
  SetMetadata(IS_OPTIONAL_AUTH_KEY, true);

/** (#198) sessionIssuedAt: 세션 JWT 의 iat(초). 최근 로그인 검사(로그인 방법 연결, D-257)에 쓴다 */
export type AuthenticatedRequest = Request & {
  user: AuthUser;
  sessionIssuedAt?: number | null;
};

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
    const user = await this.resolveUser(request);
    if (user) {
      request.user = user;
      return true;
    }
    const isOptional = this.reflector.getAllAndOverride<boolean>(
      IS_OPTIONAL_AUTH_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (isOptional) return true;
    throw new ApiException('UNAUTHORIZED');
  }

  /** Bearer → 서명, 만료 확인 → 사용자 조회. 어디서든 실패하면 null */
  private async resolveUser(
    request: AuthenticatedRequest,
  ): Promise<AuthUser | null> {
    const token = extractBearer(request.headers.authorization);
    if (!token) return null;
    const claims = await verifySessionClaims(this.jwt, token);
    if (claims === null) return null;
    request.sessionIssuedAt = claims.iat;
    return this.users.findById(claims.sub);
  }
}

/**
 * 세션 JWT 의 서명과 만료를 확인하고 sub(사용자 id) 를 돌려준다. 실패면 null.
 * sub 는 양의 정수 문자열. 예전 cuid 토큰도 여기서 null 이 된다. 요청 제한 가드(#186)도 같은 판정을 쓴다
 */
export async function verifySessionSub(
  jwt: JwtService,
  token: string,
): Promise<number | null> {
  return (await verifySessionClaims(jwt, token))?.sub ?? null;
}

/** (#198) 세션 JWT 의 sub 와 iat(초, 없으면 null). 판정은 verifySessionSub 와 같다 */
export async function verifySessionClaims(
  jwt: JwtService,
  token: string,
): Promise<{ sub: number; iat: number | null } | null> {
  try {
    const payload = await jwt.verifyAsync<{ sub?: unknown; iat?: unknown }>(
      token,
    );
    if (typeof payload.sub !== 'string' || !/^[1-9]\d{0,9}$/.test(payload.sub))
      return null;
    const iat =
      typeof payload.iat === 'number' && Number.isFinite(payload.iat)
        ? payload.iat
        : null;
    return { sub: Number(payload.sub), iat };
  } catch {
    return null;
  }
}

export function extractBearer(header: string | undefined): string | null {
  if (!header) return null;
  const [scheme, token] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) return null;
  return token;
}
