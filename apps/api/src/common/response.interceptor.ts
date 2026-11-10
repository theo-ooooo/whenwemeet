import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import type { Response } from 'express';
import { Observable, map } from 'rxjs';

/** 성공 응답 봉투 (api.md 1장, 결정기록 D-33). `status` 는 HTTP 상태 코드와 같다 */
export interface SuccessBody<T = unknown> {
  status: number;
  data: T;
  message: 'OK';
}

/**
 * 성공 응답을 `{ status, data, message: "OK" }` 로 감싼다.
 * status 는 핸들러 실행 전에 Nest 가 정한 응답 코드(POST 201, `@HttpCode` 등) 를 그대로 읽는다.
 * `@Res()` 로 직접 응답하는 리다이렉트(카카오 시작/콜백) 는 거치지 않는다
 */
@Injectable()
export class ResponseInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<SuccessBody> {
    const res = context.switchToHttp().getResponse<Response>();
    return next.handle().pipe(map((data: unknown) => ({ status: res.statusCode, data, message: 'OK' as const })));
  }
}
