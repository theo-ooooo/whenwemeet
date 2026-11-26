import { Controller, Get, Query } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.service.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { IdParam } from '../common/id-param.js';
import { FreeSlotsQueryDto } from './dto/free-slots-query.dto.js';
import { FreeSlotsService } from './free-slots.service.js';

@Controller('groups/:groupId/free-slots')
export class FreeSlotsController {
  constructor(private readonly freeSlots: FreeSlotsService) {}

  @Get()
  find(
    @CurrentUser() user: AuthUser,
    @IdParam('groupId') groupId: number,
    @Query() query: FreeSlotsQueryDto,
  ) {
    return this.freeSlots.find(user.id, groupId, query);
  }
}
