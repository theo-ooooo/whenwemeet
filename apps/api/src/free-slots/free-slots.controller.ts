import { Controller, Get, Param, Query } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.service.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { FreeSlotsQueryDto } from './dto/free-slots-query.dto.js';
import { FreeSlotsService } from './free-slots.service.js';

@Controller('groups/:groupId/free-slots')
export class FreeSlotsController {
  constructor(private readonly freeSlots: FreeSlotsService) {}

  @Get()
  find(@CurrentUser() user: AuthUser, @Param('groupId') groupId: string, @Query() query: FreeSlotsQueryDto) {
    return this.freeSlots.find(user.id, groupId, query);
  }
}
