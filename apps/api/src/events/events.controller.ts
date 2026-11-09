import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.service.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { EventInputDto, EventPatchDto, EventRangeQueryDto } from './dto/event.dto.js';
import { EventsService } from './events.service.js';

@Controller('groups/:groupId/events')
export class EventsController {
  constructor(private readonly events: EventsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Param('groupId') groupId: string, @Query() query: EventRangeQueryDto) {
    return this.events.list(user.id, groupId, query.from, query.to);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Param('groupId') groupId: string, @Body() dto: EventInputDto) {
    return this.events.create(user.id, groupId, dto);
  }

  @Get(':eventId')
  get(@CurrentUser() user: AuthUser, @Param('groupId') groupId: string, @Param('eventId') eventId: string) {
    return this.events.get(user.id, groupId, eventId);
  }

  @Patch(':eventId')
  update(
    @CurrentUser() user: AuthUser,
    @Param('groupId') groupId: string,
    @Param('eventId') eventId: string,
    @Body() dto: EventPatchDto,
  ) {
    return this.events.update(user.id, groupId, eventId, dto);
  }

  @Delete(':eventId')
  remove(@CurrentUser() user: AuthUser, @Param('groupId') groupId: string, @Param('eventId') eventId: string) {
    return this.events.remove(user.id, groupId, eventId);
  }
}
