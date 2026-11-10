import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { ApiException, DEFAULT_MESSAGE, ErrorBody, ErrorCode } from './errors.js';

/** Nest 기본 예외(라우터 404, 파이프 400 등) 를 api.md 오류 코드로 옮기는 표 */
const STATUS_TO_CODE: Record<number, ErrorCode> = {
  [HttpStatus.BAD_REQUEST]: 'VALIDATION_FAILED',
  [HttpStatus.UNAUTHORIZED]: 'UNAUTHORIZED',
  [HttpStatus.FORBIDDEN]: 'FORBIDDEN',
  [HttpStatus.NOT_FOUND]: 'NOT_FOUND',
  [HttpStatus.PAYLOAD_TOO_LARGE]: 'PAYLOAD_TOO_LARGE',
};

/**
 * 우리 코드가 아닌 곳(body-parser 의 잘못된 JSON, 잘못된 경로 인코딩 등) 에서 온 4xx 의 문구.
 * 프레임워크 원문은 영어라 사용자에게 그대로 보이면 안 된다 (#60)
 */
export const MALFORMED_REQUEST_MESSAGE = '요청 형식이 올바르지 않아요';

/** 모든 실패 응답을 `{ status, data: null, message, error: { code, details? } }` 한 가지 모양으로 만든다 (결정기록 D-33) */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const { status, body } = this.translate(exception);
    if (status >= 500) {
      this.logger.error(exception instanceof Error ? (exception.stack ?? exception.message) : String(exception));
    }
    res.status(status).json(body);
  }

  translate(exception: unknown): { status: number; body: ErrorBody } {
    const api = toApiException(exception);
    return { status: api.getStatus(), body: api.toBody() };
  }
}

/**
 * 어떤 예외든 ApiException 하나로 모은다. 5xx 와 알 수 없는 예외는 내부 사정을 숨기고 INTERNAL.
 * 우리 코드는 4xx 를 모두 ApiException 으로 던지므로, 그 밖의 4xx 는 프레임워크 원문 대신 고정 문구를 쓴다
 */
function toApiException(exception: unknown): ApiException {
  if (exception instanceof ApiException) return exception;
  if (exception instanceof HttpException && exception.getStatus() < 500) {
    const code = STATUS_TO_CODE[exception.getStatus()] ?? 'VALIDATION_FAILED';
    return new ApiException(code, code === 'VALIDATION_FAILED' ? MALFORMED_REQUEST_MESSAGE : DEFAULT_MESSAGE[code]);
  }
  return new ApiException('INTERNAL');
}
