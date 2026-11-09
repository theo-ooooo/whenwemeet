import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { ApiException, DEFAULT_MESSAGE, ERROR_STATUS, ErrorBody, ErrorCode } from './errors.js';

/** Nest 기본 예외(라우터 404, 파이프 400 등) 를 api.md 오류 코드로 옮기는 표 */
const STATUS_TO_CODE: Record<number, ErrorCode> = {
  [HttpStatus.BAD_REQUEST]: 'VALIDATION_FAILED',
  [HttpStatus.UNAUTHORIZED]: 'UNAUTHORIZED',
  [HttpStatus.FORBIDDEN]: 'FORBIDDEN',
  [HttpStatus.NOT_FOUND]: 'NOT_FOUND',
};

/** 모든 실패 응답을 `{ error: { code, message } }` 한 가지 모양으로 만든다 */
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
    if (exception instanceof ApiException) {
      return { status: exception.getStatus(), body: exception.getResponse() as ErrorBody };
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      if (status >= 500) {
        return { status: 500, body: { error: { code: 'INTERNAL', message: DEFAULT_MESSAGE.INTERNAL } } };
      }
      const code = STATUS_TO_CODE[status] ?? 'VALIDATION_FAILED';
      const message = code === 'VALIDATION_FAILED' ? extractMessage(exception.getResponse()) : DEFAULT_MESSAGE[code];
      return { status: ERROR_STATUS[code], body: { error: { code, message } } };
    }
    return { status: 500, body: { error: { code: 'INTERNAL', message: DEFAULT_MESSAGE.INTERNAL } } };
  }
}

/** Nest 예외 응답(`{ message: string | string[] }`) 에서 첫 문장만 꺼낸다 */
function extractMessage(response: string | object): string {
  if (typeof response === 'string') return response;
  const message = (response as { message?: unknown }).message;
  if (Array.isArray(message) && message.length > 0) return String(message[0]);
  if (typeof message === 'string' && message) return message;
  return DEFAULT_MESSAGE.VALIDATION_FAILED;
}
