import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.service.js';
import { CurrentUser, OptionalUser } from '../auth/current-user.decorator.js';
import { OptionalAuth } from '../auth/jwt-auth.guard.js';
import { IdParam } from '../common/id-param.js';
import { RateLimit } from '../rate-limit/rate-limit.decorator.js';
import { CreateGroupDto, JoinGroupDto, UpdateGroupDto, UpdateMeDto } from './dto/group.dto.js';
import { GroupsService } from './groups.service.js';

@Controller('groups')
export class GroupsController {
  constructor(private readonly groups: GroupsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.groups.list(user.id);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateGroupDto) {
    return this.groups.create(user.id, dto.name);
  }

  /** 이미 멤버여도 200 (멱등) 이라 201 을 쓰지 않는다 */
  @Post('join')
  @HttpCode(200)
  @RateLimit('inviteJoin')
  join(@CurrentUser() user: AuthUser, @Body() dto: JoinGroupDto) {
    return this.groups.join(user.id, dto.code);
  }

  @Get(':groupId')
  detail(@CurrentUser() user: AuthUser, @IdParam('groupId') groupId: number) {
    return this.groups.detail(user.id, groupId);
  }

  @Patch(':groupId')
  rename(@CurrentUser() user: AuthUser, @IdParam('groupId') groupId: number, @Body() dto: UpdateGroupDto) {
    return this.groups.rename(user.id, groupId, dto.name);
  }

  @Post(':groupId/invite-code')
  @HttpCode(200)
  rotateInviteCode(@CurrentUser() user: AuthUser, @IdParam('groupId') groupId: number) {
    return this.groups.rotateInviteCode(user.id, groupId);
  }

  @Patch(':groupId/me')
  updateMe(@CurrentUser() user: AuthUser, @IdParam('groupId') groupId: number, @Body() dto: UpdateMeDto) {
    return this.groups.updateMe(user.id, groupId, dto);
  }

  @Delete(':groupId/me')
  leave(@CurrentUser() user: AuthUser, @IdParam('groupId') groupId: number) {
    return this.groups.leave(user.id, groupId);
  }
}

@Controller('invites')
export class InvitesController {
  constructor(private readonly groups: GroupsService) {}

  /** (#196) 선택 인증. `by` 는 보낸 사람 표식(D-157), 토큰이 있으면 이미 멤버인지도 (D-158) */
  @OptionalAuth()
  @Get(':code')
  @RateLimit('invitePreview')
  preview(@Param('code') code: string, @Query('by') by: unknown, @OptionalUser() user: AuthUser | null) {
    return this.groups.invitePreview(code, by, user?.id ?? null);
  }
}
