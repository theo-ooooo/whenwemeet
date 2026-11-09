import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, map } from 'rxjs';

/** 성공 응답을 `{ data }` 봉투로 감싼다 (api.md 1장). `@Res()` 로 직접 응답하는 리다이렉트는 거치지 않는다 */
@Injectable()
export class ResponseInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(map((data: unknown) => ({ data })));
  }
}
