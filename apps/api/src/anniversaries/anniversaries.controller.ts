import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.service.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { AnniversariesService } from './anniversaries.service.js';
import { CreateAnniversaryDto, UpdateAnniversaryDto } from './dto/anniversary.dto.js';

@Controller('groups/:groupId/anniversaries')
export class AnniversariesController {
  constructor(private readonly anniversaries: AnniversariesService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Param('groupId') groupId: string) {
    return this.anniversaries.list(user.id, groupId);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Param('groupId') groupId: string, @Body() dto: CreateAnniversaryDto) {
    return this.anniversaries.create(user.id, groupId, dto);
  }

  @Patch(':anniversaryId')
  update(
    @CurrentUser() user: AuthUser,
    @Param('groupId') groupId: string,
    @Param('anniversaryId') anniversaryId: string,
    @Body() dto: UpdateAnniversaryDto,
  ) {
    return this.anniversaries.update(user.id, groupId, anniversaryId, dto);
  }

  @Delete(':anniversaryId')
  remove(
    @CurrentUser() user: AuthUser,
    @Param('groupId') groupId: string,
    @Param('anniversaryId') anniversaryId: string,
  ) {
    return this.anniversaries.remove(user.id, groupId, anniversaryId);
  }
}
