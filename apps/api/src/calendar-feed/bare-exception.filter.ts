import { ArgumentsHost, Catch, ExceptionFilter, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { RateLimitedException } from '../common/errors.js';
import { HttpExceptionFilter } from '../common/http-exception.filter.js';
import { reportError, shouldReport } from '../monitoring/sentry.js';

/**
 * (#193) 공개 피드 전용: 실패를 본문 없이 상태 코드만으로 (api.md 1장 봉투의 예외, D-220).
 * 외부 캘린더가 읽는 주소라 JSON 봉투가 쓸모없고, 404 본문으로 토큰 존재 여부를 흘리지 않는다.
 * 상태 판정, 5xx 로그와 Sentry, 429 의 Retry-After 는 전역 필터와 같다
 */
@Catch()
export class BareExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(BareExceptionFilter.name);
  private readonly translator = new HttpExceptionFilter();

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const { status } = this.translator.translate(exception);
    if (status >= 500)
      this.logger.error(
        exception instanceof Error
          ? (exception.stack ?? exception.message)
          : String(exception),
      );
    if (shouldReport(exception, status)) reportError(exception);
    if (exception instanceof RateLimitedException)
      res.setHeader('Retry-After', String(exception.retryAfterSec));
    res.setHeader('Cache-Control', 'no-store');
    res.status(status).end();
  }
}
