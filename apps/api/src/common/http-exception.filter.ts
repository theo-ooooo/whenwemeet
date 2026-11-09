import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { ApiException, DEFAULT_MESSAGE, ErrorBody, ErrorCode } from './errors.js';

/** Nest 기본 예외(라우터 404, 파이프 400 등) 를 api.md 오류 코드로 옮기는 표 */
const STATUS_TO_CODE: Record<number, ErrorCode> = {
  [HttpStatus.BAD_REQUEST]: 'VALIDATION_FAILED',
  [HttpStatus.UNAUTHORIZED]: 'UNAUTHORIZED',
  [HttpStatus.FORBIDDEN]: 'FORBIDDEN',
  [HttpStatus.NOT_FOUND]: 'NOT_FOUND',
};

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

/** 어떤 예외든 ApiException 하나로 모은다. 5xx 와 알 수 없는 예외는 내부 사정을 숨기고 INTERNAL */
function toApiException(exception: unknown): ApiException {
  if (exception instanceof ApiException) return exception;
  if (exception instanceof HttpException && exception.getStatus() < 500) {
    const code = STATUS_TO_CODE[exception.getStatus()] ?? 'VALIDATION_FAILED';
    const message = code === 'VALIDATION_FAILED' ? extractMessage(exception.getResponse()) : DEFAULT_MESSAGE[code];
    return new ApiException(code, message);
  }
  return new ApiException('INTERNAL');
}

/** Nest 예외 응답(`{ message: string | string[] }`) 에서 첫 문장만 꺼낸다 */
function extractMessage(response: string | object): string {
  if (typeof response === 'string') return response;
  const message = (response as { message?: unknown }).message;
  if (Array.isArray(message) && message.length > 0) return String(message[0]);
  if (typeof message === 'string' && message) return message;
  return DEFAULT_MESSAGE.VALIDATION_FAILED;
}
