import { CallHandler, ExecutionContext, HttpException, Injectable, NestInterceptor } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Observable } from 'rxjs';
import { ApiException } from '../common/errors.js';
import { ICS_MAX_BYTES, ICS_READ_FAILED_MESSAGE } from './ics-parse.js';

/** multipart 필드 `file` 하나, 2MB 까지 메모리로 (디스크에 남기지 않는다, D-162). 텍스트 필드는 range, participants 둘 */
const BaseIcsFileInterceptor = FileInterceptor('file', {
  limits: { fileSize: ICS_MAX_BYTES, files: 1, fields: 5, fieldSize: 100 },
});

/** multer 의 영어 오류(413 File too large 등)를 400 VALIDATION_FAILED(file) 로 바꾼다 */
@Injectable()
export class IcsFileInterceptor extends BaseIcsFileInterceptor implements NestInterceptor {
  override async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    try {
      return await super.intercept(context, next);
    } catch (error) {
      if (error instanceof HttpException && error.getStatus() < 500) {
        const tooLarge = error.getStatus() === 413;
        const message = tooLarge ? '파일이 너무 커요. 2MB 까지 올릴 수 있어요' : ICS_READ_FAILED_MESSAGE;
        throw new ApiException('VALIDATION_FAILED', message, [{ field: 'file', message }]);
      }
      throw error;
    }
  }
}
