import { Body, Controller, Put, Query } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.service.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { IdParam } from '../common/id-param.js';
import { ReactionDto, RsvpDto } from './dto/event-response.dto.js';
import { EventResponsesService } from './event-responses.service.js';

/** (#190) 일정 회차의 참석 여부, 반응. 반복 일정은 `?occurrence=YYYY-MM-DD` 필수, 한 번짜리는 무시 */
@Controller('groups/:groupId/events/:eventId')
export class EventResponsesController {
  constructor(private readonly responses: EventResponsesService) {}

  @Put('rsvp')
  rsvp(
    @CurrentUser() user: AuthUser,
    @IdParam('groupId') groupId: number,
    @IdParam('eventId') eventId: number,
    @Query('occurrence') occurrence: unknown,
    @Body() dto: RsvpDto,
  ) {
    return this.responses.setRsvp(
      user.id,
      groupId,
      eventId,
      occurrence,
      dto.status,
    );
  }

  @Put('reaction')
  reaction(
    @CurrentUser() user: AuthUser,
    @IdParam('groupId') groupId: number,
    @IdParam('eventId') eventId: number,
    @Query('occurrence') occurrence: unknown,
    @Body() dto: ReactionDto,
  ) {
    return this.responses.setReaction(
      user.id,
      groupId,
      eventId,
      occurrence,
      dto.reaction,
    );
  }
}
