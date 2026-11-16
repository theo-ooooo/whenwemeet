import { Body, Controller, HttpCode, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import type { AuthUser } from '../auth/auth.service.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { IdParam } from '../common/id-param.js';
import { RateLimit } from '../rate-limit/rate-limit.decorator.js';
import type { AssistantReply } from './assistant.types.js';
import { AssistantService } from './assistant.service.js';
import { AssistantRequestDto } from './dto/assistant-request.dto.js';

/** (#450) AI 비서 볼까 `POST /groups/:groupId/assistant/messages` (api.md 2.15). 멤버만, 사용자당 분당 10회 */
@Controller('groups/:groupId/assistant')
export class AssistantController {
  constructor(private readonly assistant: AssistantService) {}

  /** 만들지 않고 답만 하므로 200. 사용자가 화면을 닫아 연결이 끊기면 모델 호출도 끊는다 (횟수는 되돌리지 않음, 설계 7-2) */
  @Post('messages')
  @HttpCode(200)
  @RateLimit('assistant')
  send(
    @CurrentUser() user: AuthUser,
    @IdParam('groupId') groupId: number,
    @Body() dto: AssistantRequestDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AssistantReply> {
    const abort = new AbortController();
    res.on('close', () => {
      if (!res.writableFinished) abort.abort();
    });
    return this.assistant.send(user.id, groupId, dto, abort.signal);
  }
}
