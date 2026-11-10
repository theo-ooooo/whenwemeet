import { Body, Controller, Delete, Get, Patch, Post, Query } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.service.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { IdParam } from '../common/id-param.js';
import { EventInputDto, EventPatchDto, EventRangeQueryDto } from './dto/event.dto.js';
import { EventsService } from './events.service.js';

@Controller('groups/:groupId/events')
export class EventsController {
  constructor(private readonly events: EventsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @IdParam('groupId') groupId: number, @Query() query: EventRangeQueryDto) {
    return this.events.list(user.id, groupId, query.from, query.to);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @IdParam('groupId') groupId: number, @Body() dto: EventInputDto) {
    return this.events.create(user.id, groupId, dto);
  }

  /** (#187) 반복 일정은 `?occurrence=YYYY-MM-DD` 회차. 한 번짜리는 무시 */
  @Get(':eventId')
  get(
    @CurrentUser() user: AuthUser,
    @IdParam('groupId') groupId: number,
    @IdParam('eventId') eventId: number,
    @Query('occurrence') occurrence: unknown,
  ) {
    return this.events.get(user.id, groupId, eventId, occurrence);
  }

  /** (#187) 반복 일정은 `?occurrence=YYYY-MM-DD&scope=this|following` 필수. 한 번짜리는 무시 */
  @Patch(':eventId')
  update(
    @CurrentUser() user: AuthUser,
    @IdParam('groupId') groupId: number,
    @IdParam('eventId') eventId: number,
    @Body() dto: EventPatchDto,
    @Query('occurrence') occurrence: unknown,
    @Query('scope') scope: unknown,
  ) {
    return this.events.update(user.id, groupId, eventId, dto, { occurrence, scope });
  }

  /** (#187) 반복 일정은 `?occurrence=YYYY-MM-DD&scope=this|following` 필수. 한 번짜리는 무시 */
  @Delete(':eventId')
  remove(
    @CurrentUser() user: AuthUser,
    @IdParam('groupId') groupId: number,
    @IdParam('eventId') eventId: number,
    @Query('occurrence') occurrence: unknown,
    @Query('scope') scope: unknown,
  ) {
    return this.events.remove(user.id, groupId, eventId, { occurrence, scope });
  }
}
