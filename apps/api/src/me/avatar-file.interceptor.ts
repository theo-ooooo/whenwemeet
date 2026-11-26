import {
  CallHandler,
  ExecutionContext,
  HttpException,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Observable } from 'rxjs';
import { AVATAR_MAX_BYTES, avatarInvalid } from '../avatars/avatar-image.js';

/** multipart 필드 `file` 하나, 10MB 까지 메모리로. 다른 이름의 파일이나 두 번째 파일은 거부 */
const BaseAvatarFileInterceptor = FileInterceptor('file', {
  limits: { fileSize: AVATAR_MAX_BYTES, files: 1 },
});

/**
 * multer 가 던지는 영어 오류(413 File too large, 400 Unexpected field 등) 를
 * 화면에 바로 보여 줄 수 있는 400 VALIDATION_FAILED 로 바꾼다
 */
@Injectable()
export class AvatarFileInterceptor
  extends BaseAvatarFileInterceptor
  implements NestInterceptor
{
  override async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<unknown>> {
    try {
      return await super.intercept(context, next);
    } catch (error) {
      if (error instanceof HttpException && error.getStatus() < 500)
        throw avatarInvalid();
      throw error;
    }
  }
}
