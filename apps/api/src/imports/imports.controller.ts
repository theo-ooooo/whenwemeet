import { Body, Controller, HttpCode, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.service.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { IdParam } from '../common/id-param.js';
import { RateLimit } from '../rate-limit/rate-limit.decorator.js';
import { ImportOptionsDto } from './dto/import.dto.js';
import { IcsFileInterceptor } from './ics-file.interceptor.js';
import { ImportsService, type UploadedIcs } from './imports.service.js';

/** (#279) ICS 파일로 일정 가져오기 (api.md 2.9). 미리보기와 넣기 모두 multipart `file` + range, participants */
@Controller('groups/:groupId/imports')
export class ImportsController {
  constructor(private readonly imports: ImportsService) {}

  /** 아무것도 저장하지 않는다. 생성이 아니라 200 */
  @Post('preview')
  @HttpCode(200)
  @RateLimit('icsPreview')
  @UseInterceptors(IcsFileInterceptor)
  preview(@CurrentUser() user: AuthUser, @IdParam('groupId') groupId: number, @UploadedFile() file: UploadedIcs | undefined, @Body() options: ImportOptionsDto) {
    return this.imports.preview(user.id, groupId, file, options);
  }

  @Post()
  @RateLimit('icsImport')
  @UseInterceptors(IcsFileInterceptor)
  create(@CurrentUser() user: AuthUser, @IdParam('groupId') groupId: number, @UploadedFile() file: UploadedIcs | undefined, @Body() options: ImportOptionsDto) {
    return this.imports.import(user.id, groupId, file, options);
  }
}
