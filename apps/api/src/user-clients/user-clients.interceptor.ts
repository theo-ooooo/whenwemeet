import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import type { Observable } from 'rxjs';
import type { AuthUser } from '../auth/auth.service.js';
import { trustedClientOf } from './client-platform.js';
import { UserClientsService } from './user-clients.service.js';

/**
 * (#532) 로그인한 요청의 접속 기종을 남긴다 (D-288). 가드 뒤에 돌아 request.user 가 정해진 뒤다.
 * 사용자는 서명을 확인한 JWT 의 sub(JwtAuthGuard), 기종은 웹 서버가 키와 함께 넘긴 UA 에서만.
 * 기다리지 않고(응답을 늦추지 않음), 실패는 서비스가 로그로 삼킨다
 */
@Injectable()
export class UserClientsInterceptor implements NestInterceptor {
  constructor(
    private readonly clients: UserClientsService,
    private readonly config: ConfigService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() === 'http') {
      const request = context.switchToHttp().getRequest<Request & { user?: AuthUser }>();
      const userId = request.user?.id;
      if (userId !== undefined) {
        const client = trustedClientOf(request, this.config.get<string>('INTERNAL_API_KEY'));
        if (client) void this.clients.record(userId, client);
      }
    }
    return next.handle();
  }
}
