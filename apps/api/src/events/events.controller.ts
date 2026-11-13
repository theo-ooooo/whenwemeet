import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
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

/** (#375) 일정 삭제 되돌리기 (D-251). DELETE 응답의 deletionId 로. 팀원 누구나, 7일 안 */
@Controller('groups/:groupId/event-deletions')
export class EventDeletionsController {
  constructor(private readonly events: EventsService) {}

  @Post(':deletionId/restore')
  @HttpCode(200)
  restore(@CurrentUser() user: AuthUser, @IdParam('groupId') groupId: number, @IdParam('deletionId') deletionId: number) {
    return this.events.restore(user.id, groupId, deletionId);
  }
}

/** (#311) 공개 코드로 일정 조회 `GET /events/:code?occurrence=` (api.md 2.3). 멤버가 아니면 404 */
@Controller('events')
export class EventLookupController {
  constructor(private readonly events: EventsService) {}

  /** (#199) 일정 검색 `GET /events/search?q=&groupId=&limit=` (api.md 2.3). ':code' 보다 먼저 등록한다 */
  @Get('search')
  search(@CurrentUser() user: AuthUser, @Query('q') q: unknown, @Query('groupId') groupId: unknown, @Query('limit') limit: unknown) {
    return this.events.search(user.id, { q, groupId, limit });
  }

  @Get(':code')
  getByCode(@CurrentUser() user: AuthUser, @Param('code') code: string, @Query('occurrence') occurrence: unknown) {
    return this.events.getByCode(user.id, code, occurrence);
  }
}
